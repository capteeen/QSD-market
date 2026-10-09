import { buildProofBundle } from './bundle.js';
import { QuantumConfigError } from './errors.js';
import { QuantumEventBus } from './events.js';
import { nowIso } from './encoding.js';
import type {
  Draw,
  JsonValue,
  Outcome,
  OutcomeResolver,
  ProofBundle,
  QrngProvider,
  QuantumListener,
} from './types.js';

export interface QrngClientOptions {
  provider: QrngProvider;
  /** Share an existing bus (e.g. with the scene). A new one is created if omitted. */
  bus?: QuantumEventBus;
}

export interface MeasureResult<I extends JsonValue> {
  draw: Draw;
  outcome: Outcome;
  bundle: ProofBundle<I>;
}

export interface QrngClient {
  readonly providerId: string;
  readonly bus: QuantumEventBus;
  subscribe(listener: QuantumListener): () => void;
  /** Draw `nBytes` with full event emission. Throws MeasurementUnavailableError if the source is down. */
  draw(nBytes: number): Promise<Draw>;
  /**
   * Draw `nBytes`, apply `resolver` to (bytes, inputs), emit outcomeResolved,
   * and return a proof bundle that verifyBundle() will accept.
   */
  measure<I extends JsonValue>(
    inputs: I,
    resolver: OutcomeResolver<I>,
    opts?: { nBytes?: number },
  ): Promise<MeasureResult<I>>;
}

export const DEFAULT_DRAW_BYTES = 32;

export function createQrngClient(options: QrngClientOptions): QrngClient {
  const { provider } = options;
  if (!provider || typeof provider.draw !== 'function' || !provider.id) {
    throw new QuantumConfigError('createQrngClient: a QrngProvider with an id and draw() is required');
  }
  const bus = options.bus ?? new QuantumEventBus();

  async function draw(nBytes: number): Promise<Draw> {
    if (!Number.isInteger(nBytes) || nBytes <= 0) {
      throw new QuantumConfigError(`draw: nBytes must be a positive integer, got ${String(nBytes)}`);
    }
    // Providers emit entropyRequested / entropyArrived / commitmentComputed
    // themselves at the exact moment each happens.
    const d = await provider.draw(nBytes, bus);
    if (!d.attestation) {
      // Belt and braces: the type forbids this, but a provider written in JS could try.
      throw new QuantumConfigError(`provider ${provider.id} returned a draw without an attestation`);
    }
    return d;
  }

  async function measure<I extends JsonValue>(
    inputs: I,
    resolver: OutcomeResolver<I>,
    opts: { nBytes?: number } = {},
  ): Promise<MeasureResult<I>> {
    if (!resolver || typeof resolver.resolve !== 'function' || !resolver.id) {
      throw new QuantumConfigError('measure: an OutcomeResolver with an id and resolve() is required');
    }
    const d = await draw(opts.nBytes ?? DEFAULT_DRAW_BYTES);
    const { bundle, outcome } = buildProofBundle({ draw: d, inputs, resolver, resolvedAt: nowIso() });
    bus.emit({ type: 'outcomeResolved', value: outcome.value, outcomeLabel: outcome.label });
    return { draw: d, outcome, bundle };
  }

  return {
    providerId: provider.id,
    bus,
    subscribe: (l) => bus.subscribe(l),
    draw,
    measure,
  };
}
