import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HALF_LIFE_PRESETS,
  PROTOCOL_PARAMS,
  applyBuy,
  decayProgress,
  decayProgressFor,
  decayProgressPpb,
  isAutoMeasureDue,
  maxWindowSec,
  nextAutoMeasureAt,
  quietSeconds,
  resetQuietTime,
  zenoResetBps,
} from '../src/index.js';
import { coin } from './fixtures.js';

describe('decay formula', () => {
  it('is 0 at zero quiet time, 0.5 at one half-life, 0.75 at two, and bounded in [0,1]', () => {
    expect(decayProgressFor(0, 3600)).toBe(0);
    expect(decayProgressFor(3600, 3600)).toBeCloseTo(0.5, 12);
    expect(decayProgressFor(7200, 3600)).toBeCloseTo(0.75, 12);
    expect(decayProgressFor(3600 * 40, 3600)).toBeLessThanOrEqual(1);
    expect(decayProgressFor(1e12, 3600)).toBe(1);
  });

  it('property: bounded and monotonically non-decreasing in quiet time, non-increasing in half-life', () => {
    fc.assert(
      fc.property(fc.nat(10_000_000), fc.nat(10_000_000), fc.integer({ min: 1, max: 604_800 }), (a, b, T) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const pLo = decayProgressFor(lo, T);
        const pHi = decayProgressFor(hi, T);
        expect(pLo).toBeGreaterThanOrEqual(0);
        expect(pHi).toBeLessThanOrEqual(1);
        expect(pHi).toBeGreaterThanOrEqual(pLo);
        expect(decayProgressFor(hi, T * 2)).toBeLessThanOrEqual(pHi);
      }),
      { numRuns: 2000 },
    );
  });

  it('decayProgress(coin, now) uses lastActivityAt, is 1 once collapsed, and clamps a past `now` to 0', () => {
    const c = coin({ halfLifeSec: 3600, lastActivityAt: 1_000_000 });
    expect(decayProgress(c, 1_000_000)).toBe(0);
    expect(decayProgress(c, 1_003_600)).toBeCloseTo(0.5, 12);
    expect(decayProgress(c, 999_000)).toBe(0);
    expect(quietSeconds(c, 999_000)).toBe(0);
    expect(decayProgress({ ...c, state: 'collapsed' }, 1_000_000)).toBe(1);
    expect(decayProgressPpb(c, 1_003_600)).toBe(500_000_000);
    expect(decayProgressPpb(c, 1_000_000 + 3600 * 100)).toBe(1_000_000_000);
  });

  it('rejects a non-positive or non-integer half-life', () => {
    expect(() => decayProgressFor(10, 0)).toThrow();
    expect(() => decayProgressFor(10, 1.5)).toThrow();
  });
});

describe('auto-measurement window', () => {
  it('presets are AUTO_MEASURE_HALF_LIVES × half-life and cover 1h..7d', () => {
    expect(HALF_LIFE_PRESETS.map((p) => p.halfLifeSec)).toEqual([3600, 21600, 86400, 259200, 604800]);
    for (const p of HALF_LIFE_PRESETS) {
      expect(p.maxWindowSec).toBe(PROTOCOL_PARAMS.AUTO_MEASURE_HALF_LIVES * p.halfLifeSec);
      expect(maxWindowSec(p.halfLifeSec)).toBe(p.maxWindowSec);
      expect(p.halfLifeSec).toBeGreaterThanOrEqual(PROTOCOL_PARAMS.HALF_LIFE_MIN_SEC);
      expect(p.halfLifeSec).toBeLessThanOrEqual(PROTOCOL_PARAMS.HALF_LIFE_MAX_SEC);
    }
  });

  it('nextAutoMeasureAt is lastActivityAt + window for measurable states and null when collapsed', () => {
    const c = coin({ halfLifeSec: 3600, lastActivityAt: 1_000_000 });
    expect(nextAutoMeasureAt(c)).toBe(1_007_200);
    expect(isAutoMeasureDue(c, 1_007_199)).toBe(false);
    expect(isAutoMeasureDue(c, 1_007_200)).toBe(true);
    expect(nextAutoMeasureAt({ ...c, state: 'measured-alive' })).toBe(1_007_200);
    expect(nextAutoMeasureAt({ ...c, state: 'tunnelled' })).toBe(1_007_200);
    expect(nextAutoMeasureAt({ ...c, state: 'collapsed' })).toBeNull();
  });
});

describe('Zeno mechanic', () => {
  it('reset fraction is k × buy/mcap, capped', () => {
    expect(zenoResetBps(1n, 100n)).toBe(400); // 1% buy → 4%
    expect(zenoResetBps(5n, 100n)).toBe(2000); // 5% → 20%
    expect(zenoResetBps(12n, 100n)).toBe(4800);
    expect(zenoResetBps(13n, 100n)).toBe(PROTOCOL_PARAMS.ZENO_RESET_CAP_BPS); // 13% → 52% → capped at 50%
    expect(zenoResetBps(0n, 100n)).toBe(0);
    expect(zenoResetBps(10n ** 30n, 1n)).toBe(PROTOCOL_PARAMS.ZENO_RESET_CAP_BPS);
  });

  it('property: reset is in [0, cap], monotone in buy size, and never pushes lastActivityAt past now', () => {
    fc.assert(
      fc.property(fc.bigInt(0n, 10n ** 18n), fc.bigInt(0n, 10n ** 18n), fc.bigInt(1n, 10n ** 18n), fc.nat(1_000_000), (a, b, mcap, quiet) => {
        const small = a < b ? a : b;
        const big = a < b ? b : a;
        const rs = zenoResetBps(small, mcap);
        const rb = zenoResetBps(big, mcap);
        expect(rs).toBeGreaterThanOrEqual(0);
        expect(rb).toBeLessThanOrEqual(PROTOCOL_PARAMS.ZENO_RESET_CAP_BPS);
        expect(rb).toBeGreaterThanOrEqual(rs);
        const c = coin({ lastActivityAt: 5_000_000 });
        const now = 5_000_000 + quiet;
        const next = applyBuy(c, big, mcap, now);
        expect(next.lastActivityAt).toBeGreaterThanOrEqual(c.lastActivityAt);
        expect(next.lastActivityAt).toBeLessThanOrEqual(now);
        expect(decayProgress(next, now)).toBeLessThanOrEqual(decayProgress(c, now));
        // at most half the quiet time can be removed by one buy
        expect(now - next.lastActivityAt).toBeGreaterThanOrEqual(Math.ceil(quiet / 2));
      }),
      { numRuns: 2000 },
    );
  });

  it('applyBuy removes exactly floor(quiet × bps / 10000) seconds, settles transient states, rejects collapsed', () => {
    const c = coin({ lastActivityAt: 1_000_000, state: 'measured-alive' });
    const next = applyBuy(c, 1n, 100n, 1_003_601); // quiet 3601s, 4% → 144.04 → 144
    expect(next.lastActivityAt).toBe(1_000_144);
    expect(next.state).toBe('superposed');
    expect(next.decayProgress).toBeCloseTo(decayProgress(next, 1_003_601), 12);
    expect(c.lastActivityAt).toBe(1_000_000); // input not mutated
    expect(() => applyBuy({ ...c, state: 'collapsed' }, 1n, 100n, 1_003_601)).toThrow(/collapsed/);
    expect(() => applyBuy(c, 1n, 0n, 1_003_601)).toThrow();
    expect(resetQuietTime(c, 1_003_600, 10_000)).toBe(1_003_600);
    expect(() => resetQuietTime(c, 1_003_600, 10_001)).toThrow();
  });
});
