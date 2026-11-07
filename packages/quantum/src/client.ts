import { buildProofBundle } from './bundle.js';
import { hashJson, nowIso, sha256Hex, utf8 } from './encoding.js';
import { QuantumConfigError } from './errors.js';
import { QuantumEventBus } from './events.js';
import type {
  Draw,
  DrawBinding,
  Hex,
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

export interface MeasureOptions {
  /** Bytes to draw. Default DEFAULT_DRAW_BYTES. */
  nBytes?: number;
  /**
   * Per-measurement nonce, hex. Supply the protocol's measurement id so the
   * anchor and the bundle name the same measurement. Derived (not random)
   * from the inputs hash, the clock and a counter when omitted.
   */
  nonce?: Hex;
  /**
   * Called with the binding BEFORE the draw is requested. The chain package
   * anchors (inputsHash, nonce) here; if it throws, no draw is made.
   */
  beforeDraw?: (binding: DrawBinding) => void | Promise<void>;
}

export interface MeasureResult<I extends JsonValue> {
  draw: Draw;
  outcome: Outcome;
  bundle: ProofBundle<I>;
  /** What was (or should have been) anchored before the draw. */
  binding: DrawBinding;
}

export interface QrngClient {
  readonly providerId: string;
  readonly bus: QuantumEventBus;
  subscribe(listener: QuantumListener): () => void;
  /** Draw `nBytes` with full event emission. Throws MeasurementUnavailableError if the source is down. */
  draw(nBytes: number, binding?: DrawBinding): Promise<Draw>;
  /**
   * Compute the inputs hash and nonce, call `beforeDraw`, draw `nBytes` bound
   * to them, apply `resolver` to (bytes, inputs), emit outcomeResolved, and
   * return a proof bundle that verifyBundle() accepts.
   */
  measure<I extends JsonValue>(
    inputs: I,
    resolver: OutcomeResolver<I>,
    opts?: MeasureOptions,
  ): Promise<MeasureResult<I>>;
}

export const DEFAULT_DRAW_BYTES = 32;
const NONCE_DOMAIN = 'qsd.market/quantum/nonce/v1';
const HEX_RE = /^[0-9a-f]+$/;

export function createQrngClient(options: QrngClientOptions): QrngClient {
  const { provider } = options;
  if (!provider || typeof provider.draw !== 'function' || !provider.id) {
    throw new QuantumConfigError('createQrngClient: a QrngProvider with an id and draw() is required');
  }
  const bus = options.bus ?? new QuantumEventBus();
  let nonceCounter = 0;

  async function draw(nBytes: number, binding?: DrawBinding): Promise<Draw> {
    if (!Number.isInteger(nBytes) || nBytes <= 0) {
      throw new QuantumConfigError(`draw: nBytes must be a positive integer, got ${String(nBytes)}`);
    }
    // Providers emit entropyRequested / entropyArrived / commitmentComputed
    // themselves at the exact moment each happens.
    const d = await provider.draw(nBytes, bus, binding);
    if (!d || !d.attestation) {
      // Belt and braces: the type forbids this, but a provider written in JS could try.
      throw new QuantumConfigError(`provider ${provider.id} returned a draw without an attestation`);
    }
    // A provider that echoes a binding must echo the one we asked for. A
    // provider that carries none (binding-unaware, or UNSAFE_DEV_RANDOM whose
    // attestation has no evidential value) yields an unbound draw; a
    // production verifier rejects those with `requireInputBinding: true`.
    if (binding && d.attestation.inputsHash !== undefined) {
      if (d.attestation.inputsHash !== binding.inputsHash || d.attestation.nonce !== binding.nonce) {
        throw new QuantumConfigError(
          `provider ${provider.id} returned a draw bound to a different (inputsHash, nonce) than requested`,
        );
      }
    }
    return d;
  }

  async function measure<I extends JsonValue>(
    inputs: I,
    resolver: OutcomeResolver<I>,
    opts: MeasureOptions = {},
  ): Promise<MeasureResult<I>> {
    if (!resolver || typeof resolver.resolve !== 'function' || !resolver.id) {
      throw new QuantumConfigError('measure: an OutcomeResolver with an id and resolve() is required');
    }
    const inputsHash = hashJson(inputs); // throws on non-JSON inputs, before any draw
    let nonce = opts.nonce;
    if (nonce === undefined) {
      nonce = sha256Hex(utf8(`${NONCE_DOMAIN}\n${inputsHash}\n${nowIso()}\n${nonceCounter++}`));
    } else if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length % 2 !== 0 || !HEX_RE.test(nonce)) {
      throw new QuantumConfigError('measure: nonce must be a non-empty even-length lowercase hex string');
    }
    const binding: DrawBinding = { inputsHash, nonce };
    if (opts.beforeDraw) await opts.beforeDraw(binding);

    const d = await draw(opts.nBytes ?? DEFAULT_DRAW_BYTES, binding);
    const { bundle, outcome } = buildProofBundle({ draw: d, inputs, resolver, resolvedAt: nowIso() });
    bus.emit({ type: 'outcomeResolved', value: outcome.value, outcomeLabel: outcome.label });
    return { draw: d, outcome, bundle, binding };
  }

  return {
    providerId: provider.id,
    bus,
    subscribe: (l) => bus.subscribe(l),
    draw,
    measure,
  };
}
