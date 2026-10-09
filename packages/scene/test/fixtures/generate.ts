/**
 * Records a REAL event stream once and stores it under
 * test/fixtures/generated/ (gitignored, ~11.5 MB):
 *
 *   crypto.bin      full createIdentity + sign stream, REDACTED (depth < 15
 *                   chain values replaced by their SHA-256 commitments, see
 *                   @qsd/crypto README "Event stream sensitivity")
 *   manifest.json   seed hex (a throwaway test seed), expected root, counts,
 *                   the recorded quantum events (UNSAFE_DEV_RANDOM provider),
 *                   the superposition input and lineage used, and a
 *                   clearly-labelled fixture chain event.
 *
 * Nothing here is product data: the seed is public, the QRNG is the dev
 * provider, the tx signature is prefixed FIXTURE-NOT-A-TX.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdentity, recordEvents, sha256, sign, toHex, type CryptoEvent } from '@qsd/crypto';
import {
  QuantumEventBus,
  UnsafeDevRandomProvider,
  createQrngClient,
  recordEvents as recordQuantumEvents,
  bytesToHex,
  hexToBytes,
  type QuantumEvent,
} from '@qsd/quantum';
import { encodeCryptoEvents, decodeCryptoEvents } from '../../src/model/codec.js';
import type { ChainEvent, LineageInput, SuperpositionInput } from '../../src/model/types.js';

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'generated');
export const FIXTURE_SEED_LABEL = 'qsd-scene-test-fixture-seed-v1 (public throwaway seed, not an identity)';

export interface FixtureManifest {
  version: 1;
  seedHex: string;
  seedLabel: string;
  rootHex: string;
  cryptoEventCount: number;
  keygenMs: number;
  /** Quantum events with bytes as hex. */
  quantum: (Omit<QuantumEvent, 'bytes'> & { bytesHex?: string })[];
  superposition: { supplyMin: string; supplyMax: string; halfLifeSec: number; decayChannels: SuperpositionInput['decayChannels'] };
  lineage: LineageInput;
  chain: ChainEvent[];
}

export interface Fixture {
  crypto: CryptoEvent[];
  quantum: QuantumEvent[];
  superposition: SuperpositionInput;
  lineage: LineageInput;
  chain: ChainEvent[];
  manifest: FixtureManifest;
}

/** Labelled test parameters for the superposition stage; the app supplies real ones. */
export const FIXTURE_SUPERPOSITION: SuperpositionInput = {
  supplyMin: 600_000_000_000000n,
  supplyMax: 1_000_000_000_000000n,
  halfLifeSec: 3600,
  decayChannels: [
    { id: 'fixture-fast', probability: 450_000, label: 'fast collapse (fixture)' },
    { id: 'fixture-slow', probability: 400_000, label: 'slow collapse (fixture)' },
    { id: 'fixture-tunnel', probability: 150_000, label: 'tunnel (fixture)' },
  ],
};

export const FIXTURE_LINEAGE: LineageInput = {
  ca: 'FIXTURE-NOT-A-CA-daughter',
  generation: 1,
  mother: { ca: 'FIXTURE-NOT-A-CA-mother', generation: 0, finalState: 'collapsed', channelLabel: 'fast collapse (fixture)', measurementsSurvived: 3 },
};

export async function generateFixture(): Promise<Fixture> {
  const seed = sha256(new TextEncoder().encode(FIXTURE_SEED_LABEL));
  const rec = recordEvents({ redact: true });
  const identity = createIdentity(seed, { observer: rec.observer });
  const state = identity.initialState();
  const message = new TextEncoder().encode('qsd scene fixture message');
  sign(identity, state, message, { observer: rec.observer });
  rec.stop();

  const bus = new QuantumEventBus();
  const qrec = recordQuantumEvents(bus);
  const client = createQrngClient({ provider: new UnsafeDevRandomProvider(), bus });
  await client.measure(
    { fixture: true },
    {
      id: 'qsd-scene-fixture-resolver',
      // labels in the protocol's format: `collapse:<channelId>` | `tunnel` | `survive`
      resolve: (bytes) => {
        const b = (bytes[0] ?? 0) % 3;
        return b === 0
          ? { value: { kind: 'survive' }, label: 'survive' }
          : b === 1
            ? { value: { kind: 'collapse', channelId: 'fixture-fast' }, label: 'collapse:fixture-fast' }
            : { value: { kind: 'tunnel' }, label: 'tunnel' };
      },
    },
  );
  qrec.stop();

  const chain: ChainEvent[] = [
    { type: 'anchorSubmitted', seq: 0 },
    { type: 'anchored', seq: 1, txSignature: `FIXTURE-NOT-A-TX-${toHex(identity.root).slice(0, 16)}`, slot: 0 },
  ];

  const manifest: FixtureManifest = {
    version: 1,
    seedHex: toHex(seed),
    seedLabel: FIXTURE_SEED_LABEL,
    rootHex: identity.rootHex,
    cryptoEventCount: rec.events.length,
    keygenMs: identity.keygenMs,
    quantum: qrec.events.map((e) => (e.type === 'entropyArrived' ? { ...omitBytes(e), bytesHex: bytesToHex(e.bytes) } : e)),
    superposition: {
      supplyMin: FIXTURE_SUPERPOSITION.supplyMin.toString(),
      supplyMax: FIXTURE_SUPERPOSITION.supplyMax.toString(),
      halfLifeSec: FIXTURE_SUPERPOSITION.halfLifeSec,
      decayChannels: FIXTURE_SUPERPOSITION.decayChannels,
    },
    lineage: FIXTURE_LINEAGE,
    chain,
  };

  return { crypto: rec.events, quantum: qrec.events, superposition: FIXTURE_SUPERPOSITION, lineage: FIXTURE_LINEAGE, chain, manifest };
}

function omitBytes(e: QuantumEvent & { type: 'entropyArrived' }): Omit<typeof e, 'bytes'> {
  const { bytes: _bytes, ...rest } = e;
  return rest;
}

export function writeFixture(f: Fixture, dir = FIXTURE_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'crypto.bin'), encodeCryptoEvents(f.crypto));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(f.manifest, null, 2));
}

export function readFixture(dir = FIXTURE_DIR): Fixture | null {
  const bin = join(dir, 'crypto.bin');
  const man = join(dir, 'manifest.json');
  if (!existsSync(bin) || !existsSync(man)) return null;
  const manifest = JSON.parse(readFileSync(man, 'utf8')) as FixtureManifest;
  if (manifest.version !== 1) return null;
  const crypto = decodeCryptoEvents(new Uint8Array(readFileSync(bin)));
  const quantum = manifest.quantum.map((e) => {
    if (e.type === 'entropyArrived') {
      const { bytesHex, ...rest } = e;
      return { ...rest, bytes: hexToBytes(bytesHex ?? '') } as QuantumEvent;
    }
    return e as QuantumEvent;
  });
  return {
    crypto,
    quantum,
    superposition: {
      supplyMin: BigInt(manifest.superposition.supplyMin),
      supplyMax: BigInt(manifest.superposition.supplyMax),
      halfLifeSec: manifest.superposition.halfLifeSec,
      decayChannels: manifest.superposition.decayChannels,
    },
    lineage: manifest.lineage,
    chain: manifest.chain,
    manifest,
  };
}

/** Load the fixture, generating it (≈4 s) on first use. */
export async function loadFixture(): Promise<Fixture> {
  const existing = readFixture();
  if (existing) return existing;
  const f = await generateFixture();
  writeFixture(f);
  return f;
}
