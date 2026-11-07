import { UnsafeDevRandomProvider, createQrngClient, type QrngClient } from '@qsd/quantum';
import type { Channel, Coin } from '../src/index.js';
import { initialImageLineage } from '../src/index.js';

export const IMAGE_HASH = 'a'.repeat(64);

export function channels(): Channel[] {
  const daughterParams = {
    halfLifeSec: { min: 3_600, max: 86_400 },
    poolUnits: { min: 100_000_000n, max: 300_000_000n },
  };
  return [
    { id: 'alpha', probabilityPpm: 500_000, label: 'alpha decay', daughterParams: { ...daughterParams } },
    { id: 'beta', probabilityPpm: 300_000, label: 'beta decay', daughterParams: { halfLifeSec: { min: 7_200, max: 172_800 }, poolUnits: { min: 50_000_000n, max: 400_000_000n } } },
    { id: 'gamma', probabilityPpm: 200_000, label: 'gamma burst', daughterParams: { halfLifeSec: { min: 3_600, max: 21_600 }, poolUnits: { min: 200_000_000n, max: 200_000_000n } } },
  ];
}

export function coin(overrides: Partial<Coin> = {}): Coin {
  return {
    ca: 'CoinAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
    name: 'PHOTON',
    ticker: 'PHO',
    image: { uri: 'ipfs://photon', hash: IMAGE_HASH, lineage: initialImageLineage(IMAGE_HASH) },
    lineageId: 'lineage-1',
    generation: 1,
    identityRoot: 'b'.repeat(64),
    halfLifeSec: 3_600,
    decayProgress: 0,
    decayChannels: channels(),
    superposition: { supplyMin: 100_000_000n, supplyMax: 300_000_000n },
    supply: { totalUnits: 1_000_000_000_000_000n, remainingUnits: 1_000_000_000_000_000n, decimals: 6 },
    state: 'superposed',
    lastActivityAt: 1_000_000,
    measurements: [],
    bornAt: 1_000_000,
    ...overrides,
  };
}

export function devClient(): { client: QrngClient; provider: UnsafeDevRandomProvider } {
  const provider = new UnsafeDevRandomProvider();
  return { client: createQrngClient({ provider }), provider };
}

/** 32 bytes with chosen big-endian u64 words (as fractions of 2^64 given in [0,1)). */
export function bytesFromFractions(f0: number, f1 = 0, f2 = 0, f3 = 0): Uint8Array {
  const out = new Uint8Array(32);
  const words = [f0, f1, f2, f3];
  for (let w = 0; w < 4; w++) {
    let v = BigInt(Math.floor(words[w]! * 2 ** 53)) << 11n; // fraction × 2^64, exact for 53-bit fractions
    for (let i = 7; i >= 0; i--) {
      out[w * 8 + i] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
  return out;
}
