/** Protocol coin fixtures for chain tests (same shape as @qsd/protocol's own test fixtures). */
import { initialImageLineage, applyMeasurement, measurementInputs, measurementResolver, type Channel, type Coin } from '@qsd/protocol';
import { UnsafeDevRandomProvider, createQrngClient } from '@qsd/quantum';
import { Keypair } from '@solana/web3.js';

export const IMAGE_HASH = 'a'.repeat(64);

export function channels(): Channel[] {
  return [
    { id: 'alpha', probabilityPpm: 500_000, label: 'alpha decay', daughterParams: { halfLifeSec: { min: 3_600, max: 86_400 }, poolUnits: { min: 100_000_000n, max: 300_000_000n } } },
    { id: 'beta', probabilityPpm: 300_000, label: 'beta decay', daughterParams: { halfLifeSec: { min: 7_200, max: 172_800 }, poolUnits: { min: 50_000_000n, max: 400_000_000n } } },
    { id: 'gamma', probabilityPpm: 200_000, label: 'gamma burst', daughterParams: { halfLifeSec: { min: 3_600, max: 21_600 }, poolUnits: { min: 200_000_000n, max: 200_000_000n } } },
  ];
}

export function coin(overrides: Partial<Coin> = {}): Coin {
  return {
    ca: overrides.ca ?? 'CoinAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
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

/**
 * Drive a coin to `collapsed` with real dev-provider draws at a time when
 * decay is ~1 (collapse near-certain; tunnels are retried). Returns the
 * collapsed coin and the time of collapse.
 */
export async function collapsedCoin(base: Coin = coin(), by = Keypair.generate().publicKey.toBase58()): Promise<{ mother: Coin; collapseAt: number }> {
  const client = createQrngClient({ provider: new UnsafeDevRandomProvider() });
  let c = base;
  let at = base.lastActivityAt + 100 * base.halfLifeSec;
  for (let i = 0; i < 50; i++) {
    const inputs = measurementInputs(c, at);
    const { bundle } = await client.measure(inputs, measurementResolver);
    const r = applyMeasurement(c, bundle, { at, by, verify: { allowUnsafeDev: true } });
    c = r.coin;
    if (c.state === 'collapsed') return { mother: c, collapseAt: at };
    at = c.lastActivityAt + 100 * c.halfLifeSec; // tunnelled: quiet clock reset; try again
  }
  throw new Error('could not collapse the fixture coin in 50 draws');
}
