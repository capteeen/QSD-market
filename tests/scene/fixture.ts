/**
 * Agent H's OWN recorded event stream for @qsd/scene — independent of the
 * package's test/fixtures/generate.ts (different seed, different message,
 * different resolver label format, different superposition / lineage / chain
 * inputs). Recorded live from @qsd/crypto (`createIdentity` + `sign`, REDACTED)
 * and @qsd/quantum's dev provider (NODE_ENV=test, as vitest sets it).
 *
 * The outcome label deliberately follows the protocol package's real format
 * (`collapse:<channelId>` / `survive`, see packages/protocol/src/resolver.ts
 * `outcomeLabel`) rather than the bare `collapse` the package fixture uses.
 */
import { createIdentity, recordEvents, sha256, sign, toHex, type CryptoEvent } from '@qsd/crypto';
import {
  QuantumEventBus,
  UnsafeDevRandomProvider,
  createQrngClient,
  recordEvents as recordQuantumEvents,
  type QuantumEvent,
} from '@qsd/quantum';
import type { ChainEvent, LineageInput, SuperpositionInput } from '@qsd/scene';

export const H_SEED_LABEL = 'agent-h scene verify — public throwaway seed, 2026-10-09, not an identity';
export const H_MESSAGE = new TextEncoder().encode('agent-h: scene verification message (not a launch)');

export const H_SUPERPOSITION: SuperpositionInput = {
  supplyMin: 250_000_000_000n,
  supplyMax: 1_000_000_000_000n,
  halfLifeSec: 21_600,
  decayChannels: [
    { id: 'h-fast', probability: 500_000, label: 'fast (agent-h)' },
    { id: 'h-slow', probability: 300_000, label: 'slow (agent-h)' },
    { id: 'h-tunnel', probability: 200_000, label: 'tunnel (agent-h)' },
  ],
};

export const H_LINEAGE: LineageInput = {
  ca: 'AGENT-H-NOT-A-CA-daughter',
  generation: 2,
  mother: { ca: 'AGENT-H-NOT-A-CA-mother', generation: 1, finalState: 'tunnelled', measurementsSurvived: 7 },
};

export interface HFixture {
  seed: Uint8Array;
  crypto: CryptoEvent[];
  /** crypto events up to (not including) signStart */
  keygen: CryptoEvent[];
  /** crypto events from signStart on */
  signing: CryptoEvent[];
  quantum: QuantumEvent[];
  chain: ChainEvent[];
  superposition: SuperpositionInput;
  lineage: LineageInput;
  rootHex: string;
  root: Uint8Array;
  keygenMs: number;
  /** The one-time key index that was signed with. */
  signedIndex: number;
}

let cached: Promise<HFixture> | null = null;

/** Record once per process (≈ 4 s); every test file in a fork pays this once. */
export function hFixture(): Promise<HFixture> {
  cached ??= record();
  return cached;
}

export function hSeed(): Uint8Array {
  return sha256(new TextEncoder().encode(H_SEED_LABEL));
}

async function record(): Promise<HFixture> {
  const seed = hSeed();
  const rec = recordEvents({ redact: true });
  const t0 = performance.now();
  const identity = createIdentity(seed, { observer: rec.observer });
  const keygenMs = performance.now() - t0;
  const state = identity.initialState();
  const result = sign(identity, state, H_MESSAGE, { observer: rec.observer });
  rec.stop();

  const bus = new QuantumEventBus();
  const qrec = recordQuantumEvents(bus);
  const client = createQrngClient({ provider: new UnsafeDevRandomProvider(), bus });
  await client.measure(
    { agentH: true, purpose: 'scene-verify' },
    {
      id: 'agent-h-scene-resolver',
      resolve: (bytes) => {
        const b = bytes[0] ?? 0;
        // protocol-format labels: `collapse:<channelId>` or `survive`
        return b % 3 === 0 ? { value: { kind: 'survive' }, label: 'survive' } : { value: { kind: 'collapse', channelId: 'h-fast' }, label: 'collapse:h-fast' };
      },
    },
  );
  qrec.stop();

  const chain: ChainEvent[] = [
    { type: 'anchorSubmitted', seq: 0, txSignature: `AGENT-H-NOT-A-TX-${toHex(identity.root).slice(0, 12)}` },
    { type: 'anchored', seq: 1, txSignature: `AGENT-H-NOT-A-TX-${toHex(identity.root).slice(0, 12)}`, slot: 123_456 },
  ];

  const signAt = rec.events.findIndex((e) => e.type === 'signStart');
  if (signAt < 0) throw new Error('fixture: no signStart recorded');
  const signStart = rec.events[signAt] as Extract<CryptoEvent, { type: 'signStart' }>;
  void result;

  return {
    seed,
    crypto: rec.events,
    keygen: rec.events.slice(0, signAt),
    signing: rec.events.slice(signAt),
    quantum: qrec.events,
    chain,
    superposition: H_SUPERPOSITION,
    lineage: H_LINEAGE,
    rootHex: identity.rootHex,
    root: identity.root,
    keygenMs,
    signedIndex: signStart.index,
  };
}

/** The full scene stream in the order the app would deliver it. */
export function fullStream(f: HFixture): import('@qsd/scene').SceneEvent[] {
  return [
    ...f.keygen,
    { type: 'superposition', input: f.superposition },
    ...f.quantum,
    ...f.signing,
    ...f.chain,
    { type: 'lineage', input: f.lineage },
  ];
}

export function bytesEqual(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function hex(b: Uint8Array): string {
  return toHex(b);
}
