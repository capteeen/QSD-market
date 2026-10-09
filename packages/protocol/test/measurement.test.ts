import { bundleHash, verify } from '@qsd/quantum';
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_PARAMS,
  applyMeasurement,
  collapseMeasurement,
  collapseRewards,
  decayProgress,
  measurementInputs,
  measurementResolver,
  resolvePoolUnits,
  surviveRebate,
  survivedMeasurementIds,
  type Coin,
  type MeasurementBundle,
} from '../src/index.js';
import { coin, devClient } from './fixtures.js';

const VERIFY = { allowUnsafeDev: true };

async function measureUntil(c: Coin, at: number, want: 'survive' | 'collapse' | 'tunnel', maxTries = 5000) {
  const { client } = devClient();
  const inputs = measurementInputs(c, at);
  for (let i = 0; i < maxTries; i++) {
    const { bundle } = await client.measure(inputs, measurementResolver);
    if ((bundle.outcome.value as { kind: string }).kind === want) return bundle as MeasurementBundle;
  }
  throw new Error(`no ${want} in ${maxTries} tries`);
}

describe('measurementInputs', () => {
  it('builds JSON-safe integer inputs from the coin at `now`', () => {
    const c = coin({ lastActivityAt: 1_000_000, halfLifeSec: 3600 });
    const i = measurementInputs(c, 1_003_600);
    expect(i).toEqual({
      ca: c.ca,
      decayProgressPpb: 500_000_000,
      channels: [
        { id: 'alpha', probabilityPpm: 500_000 },
        { id: 'beta', probabilityPpm: 300_000 },
        { id: 'gamma', probabilityPpm: 200_000 },
      ],
      tunnelProbabilityPpm: PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM,
      measurementIndex: 0,
    });
    expect(() => measurementInputs({ ...c, state: 'collapsed' }, 1_003_600)).toThrow(/cannot be measured/);
    expect(() => JSON.stringify(i)).not.toThrow();
  });
});

describe('applyMeasurement', () => {
  it('a bundle produced through @qsd/quantum passes verify() with measurementResolver and applies as survive', async () => {
    const c = coin({ lastActivityAt: 1_000_000, halfLifeSec: 3600 });
    const at = 1_003_600; // decay 0.5
    const bundle = await measureUntil(c, at, 'survive');
    expect(verify(bundle, measurementResolver, VERIFY)).toEqual({ ok: true });
    expect(verify(bundle, measurementResolver)).toEqual({ ok: false, reason: expect.stringMatching(/unsafe-dev/i) });

    const r = applyMeasurement(c, bundle, { at, by: 'WalletM', verify: VERIFY });
    expect(r.outcome).toEqual({ kind: 'survive' });
    expect(r.coin.state).toBe('measured-alive');
    // 75 % of 3600 s quiet removed → origin moves to 1_002_700, quiet 900 s
    expect(r.coin.lastActivityAt).toBe(1_002_700);
    expect(r.measurement.decayBefore).toBeCloseTo(0.5, 12);
    expect(r.measurement.decayAfter).toBeCloseTo(1 - Math.pow(2, -900 / 3600), 12);
    expect(r.coin.decayProgress).toBe(r.measurement.decayAfter);
    expect(r.measurement.id).toBe(bundleHash(bundle));
    expect(r.measurement.by).toBe('WalletM');
    expect(r.measurement.at).toBe(at);
    expect(r.coin.measurements).toHaveLength(1);
    expect(c.measurements).toHaveLength(0); // input untouched
    expect(c.state).toBe('superposed');
    // the second measurement has index 1
    expect(measurementInputs(r.coin, at + 100).measurementIndex).toBe(1);
  });

  it('collapse moves the coin to collapsed with decay 1 and a channel; the pool resolves inside the band', async () => {
    const c = coin({ lastActivityAt: 1_000_000, halfLifeSec: 3600 });
    const at = 1_000_000 + 3600 * 3; // decay 0.875
    const bundle = await measureUntil(c, at, 'collapse');
    const r = applyMeasurement(c, bundle, { at, by: PROTOCOL_PARAMS.AUTO_MEASURER_ID, verify: VERIFY });
    expect(r.coin.state).toBe('collapsed');
    expect(r.coin.collapsedAt).toBe(at);
    expect(r.coin.decayProgress).toBe(1);
    expect(decayProgress(r.coin, at + 10_000)).toBe(1);
    const m = collapseMeasurement(r.coin);
    expect(['alpha', 'beta', 'gamma']).toContain(m.outcome.channelId);
    const pool = resolvePoolUnits(r.coin.superposition, m.outcome.poolPointPpm);
    expect(pool).toBeGreaterThanOrEqual(c.superposition.supplyMin);
    expect(pool).toBeLessThanOrEqual(c.superposition.supplyMax);
    expect(() => measurementInputs(r.coin, at + 1)).toThrow();
  });

  it('tunnel returns the coin to a measurable state as itself with a fully reset quiet clock', async () => {
    const c = coin({ lastActivityAt: 1_000_000, halfLifeSec: 3600 });
    const at = 1_000_000 + 3600 * 10;
    const bundle = await measureUntil(c, at, 'tunnel', 20_000);
    const r = applyMeasurement(c, bundle, { at, by: 'W', verify: VERIFY });
    expect(r.coin.state).toBe('tunnelled');
    expect(r.coin.lastActivityAt).toBe(at);
    expect(r.coin.decayProgress).toBe(0);
    expect(r.coin.ca).toBe(c.ca);
    expect(r.coin.generation).toBe(c.generation);
    expect(measurementInputs(r.coin, at + 60).measurementIndex).toBe(1);
  });

  it('rejects a bundle whose inputs do not match the coin at `at`, a wrong resolver, a tampered outcome', async () => {
    const c = coin({ lastActivityAt: 1_000_000, halfLifeSec: 3600 });
    const at = 1_003_600;
    const bundle = await measureUntil(c, at, 'survive');
    // different time → different decayProgressPpb
    expect(() => applyMeasurement(c, bundle, { at: at + 1, by: 'W' })).toThrow(/inputs do not match/);
    // different coin
    expect(() => applyMeasurement(coin({ ca: 'Other' }), bundle, { at, by: 'W' })).toThrow(/inputs do not match/);
    // measurement index advanced
    expect(() => applyMeasurement({ ...c, measurements: [{} as never] }, bundle, { at, by: 'W' })).toThrow(/inputs do not match/);
    // wrong resolver id
    expect(() => applyMeasurement(c, { ...bundle, resolverId: 'other/v1' }, { at, by: 'W' })).toThrow(/resolverId/);
    // tampered outcome value
    const tampered: MeasurementBundle = { ...bundle, outcome: { value: { kind: 'tunnel' }, label: 'tunnel' } };
    expect(() => applyMeasurement(c, tampered, { at, by: 'W' })).toThrow(/does not match resolver/);
    // tampered label only
    const badLabel: MeasurementBundle = { ...bundle, outcome: { ...bundle.outcome, label: 'collapse:alpha' } };
    expect(() => applyMeasurement(c, badLabel, { at, by: 'W' })).toThrow(/label/);
    // tampered bytes are caught by quantum verify when verify options are given
    const badBytes: MeasurementBundle = { ...bundle, draw: { ...bundle.draw, bytesHex: 'ff'.repeat(32) } };
    expect(() => applyMeasurement(c, badBytes, { at, by: 'W', verify: VERIFY })).toThrow(/failed verification/);
    expect(() => applyMeasurement(c, bundle, { at, by: '' })).toThrow(/by/);
  });

  it('survivedMeasurementIds lists only survives', () => {
    const ms = [
      { id: 'a', outcome: { kind: 'survive' as const } },
      { id: 'b', outcome: { kind: 'tunnel' as const } },
      { id: 'c', outcome: { kind: 'survive' as const } },
    ];
    expect(survivedMeasurementIds(ms)).toEqual(['a', 'c']);
  });
});

describe('rewards', () => {
  it('collapse: 1 % removed, 20 % of that to the measurer, rest burned; exact bigint', () => {
    const r = collapseRewards(1_000_000_000_000_000n); // 1e9 tokens at 6 decimals
    expect(r.removedUnits).toBe(10_000_000_000_000n);
    expect(r.measurerUnits).toBe(2_000_000_000_000n);
    expect(r.burnedUnits).toBe(8_000_000_000_000n);
    expect(r.measurerUnits + r.burnedUnits).toBe(r.removedUnits);
    expect(collapseRewards(0n)).toEqual({ removedUnits: 0n, measurerUnits: 0n, burnedUnits: 0n });
    expect(collapseRewards(99n).removedUnits).toBe(0n);
  });

  it('survive: 10 % of the measurement fee is rebated', () => {
    expect(surviveRebate(1_000_000n)).toBe(100_000n);
    expect(surviveRebate(9n)).toBe(0n);
  });

  it('resolvePoolUnits lerps the band by ppm (floor)', () => {
    const band = { supplyMin: 100n, supplyMax: 300n };
    expect(resolvePoolUnits(band, 0)).toBe(100n);
    expect(resolvePoolUnits(band, 500_000)).toBe(200n);
    expect(resolvePoolUnits(band, 999_999)).toBe(299n);
    expect(() => resolvePoolUnits(band, 1_000_000)).toThrow();
  });
});
