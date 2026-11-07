/**
 * Agent H — decay formula bounds and the Zeno cap, independently.
 * Spec §5 l.179-185 (half-life, not a timer; Zeno proportional, capped) and
 * the public prose in docs/economics.md §1-§3.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  HALF_LIFE_PRESETS,
  PROTOCOL_PARAMS,
  applyBuy,
  decayProgress,
  decayProgressPpb,
  isAutoMeasureDue,
  nextAutoMeasureAt,
  quietSeconds,
  resetQuietTime,
  zenoResetBps,
  type Coin,
} from '@qsd/protocol';

const here = path.dirname(fileURLToPath(import.meta.url));
const economics = readFileSync(path.join(here, '..', '..', 'docs', 'economics.md'), 'utf8');

function coin(o: Partial<Coin> = {}): Coin {
  return {
    ca: 'CA',
    name: 'X',
    ticker: 'X',
    image: { uri: '', hash: '00'.repeat(32), lineage: '00'.repeat(32) },
    lineageId: 'l',
    generation: 1,
    identityRoot: '00'.repeat(32),
    halfLifeSec: 3600,
    decayProgress: 0,
    decayChannels: [{ id: 'a', probabilityPpm: 1_000_000, label: 'a', daughterParams: { halfLifeSec: { min: 3600, max: 3600 }, poolUnits: { min: 1n, max: 2n } } }],
    superposition: { supplyMin: 1n, supplyMax: 2n },
    supply: { totalUnits: 100n, remainingUnits: 100n, decimals: 0 },
    state: 'superposed',
    lastActivityAt: 1_000_000,
    measurements: [],
    bornAt: 1_000_000,
    ...o,
  };
}

const T = fc.constantFrom(...HALF_LIFE_PRESETS.map((p) => p.halfLifeSec), 1, 7, 100_000);
const timeArb = fc.integer({ min: 0, max: 4_000_000_000 });

describe('decay: a half-life, not a timer (spec §5 l.179-182)', () => {
  it('property: decayProgress ∈ [0, 1]; 0 at or before lastActivityAt; monotone non-decreasing in quiet time; ppb integer in [0, 1e9]', () => {
    fc.assert(
      fc.property(T, timeArb, fc.integer({ min: -1_000_000, max: 4_000_000_000 }), fc.integer({ min: 0, max: 1_000_000 }), (hl, last, dt, extra) => {
        const c = coin({ halfLifeSec: hl, lastActivityAt: last });
        const now = Math.max(0, last + dt);
        const p = decayProgress(c, now);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        if (now <= last) expect(p).toBe(0);
        const later = decayProgress(c, now + extra);
        expect(later >= p).toBe(true);
        const ppb = decayProgressPpb(c, now);
        expect(Number.isInteger(ppb) && ppb >= 0 && ppb <= 1e9).toBe(true);
        expect(ppb).toBe(Math.floor(p * 1e9));
      }),
      { numRuns: 2000 },
    );
  });

  it('exactly 0.5 after one half-life, 0.75 after two, 0.875 after three, never 1 while quiet (float), 1 once collapsed', () => {
    for (const hl of HALF_LIFE_PRESETS.map((p) => p.halfLifeSec)) {
      const c = coin({ halfLifeSec: hl });
      expect(decayProgress(c, c.lastActivityAt + hl)).toBe(0.5);
      expect(decayProgress(c, c.lastActivityAt + 2 * hl)).toBe(0.75);
      expect(decayProgress(c, c.lastActivityAt + 3 * hl)).toBe(0.875);
      expect(decayProgress(c, c.lastActivityAt + 10 * hl)).toBeLessThan(1);
      expect(decayProgress({ ...c, state: 'collapsed' }, c.lastActivityAt)).toBe(1);
      expect(decayProgressPpb({ ...c, state: 'collapsed' }, 0)).toBe(1e9);
    }
    // nothing "fires" at t = T: the value is continuous through it
    const c = coin();
    expect(decayProgress(c, c.lastActivityAt + 3599)).toBeLessThan(0.5);
    expect(decayProgress(c, c.lastActivityAt + 3601)).toBeGreaterThan(0.5);
    expect(decayProgress(c, c.lastActivityAt + 3601) - decayProgress(c, c.lastActivityAt + 3599)).toBeLessThan(1e-3);
  });

  it('matches the economics.md formula 1 − 2^(−t/T) and the "same curve as radioactive decay" claim (e-folding = T/ln 2)', () => {
    expect(economics).toMatch(/decayProgress\(t\) = 1 − 2\^\(−t \/ T\)/);
    fc.assert(
      fc.property(T, fc.integer({ min: 0, max: 10_000_000 }), (hl, t) => {
        const c = coin({ halfLifeSec: hl });
        const expected = Math.min(1, Math.max(0, 1 - Math.exp((-t * Math.LN2) / hl)));
        expect(Math.abs(decayProgress(c, c.lastActivityAt + t) - expected)).toBeLessThan(1e-12);
      }),
      { numRuns: 500 },
    );
  });

  it('auto-measurement: nextAutoMeasureAt == lastActivityAt + 2T for every measurable state; null when collapsed; due iff now ≥ it', () => {
    fc.assert(
      fc.property(T, timeArb, fc.constantFrom('superposed', 'measured-alive', 'tunnelled') as fc.Arbitrary<Coin['state']>, fc.integer({ min: -10, max: 10 }), (hl, last, state, d) => {
        const c = coin({ halfLifeSec: hl, lastActivityAt: last, state });
        expect(nextAutoMeasureAt(c)).toBe(last + PROTOCOL_PARAMS.AUTO_MEASURE_HALF_LIVES * hl);
        expect(PROTOCOL_PARAMS.AUTO_MEASURE_HALF_LIVES).toBe(2);
        const at = last + 2 * hl + d;
        expect(isAutoMeasureDue(c, Math.max(0, at))).toBe(Math.max(0, at) >= last + 2 * hl);
        expect(nextAutoMeasureAt({ ...c, state: 'collapsed' })).toBeNull();
        expect(isAutoMeasureDue({ ...c, state: 'collapsed' }, at + 1e9)).toBe(false);
      }),
      { numRuns: 500 },
    );
    for (const p of HALF_LIFE_PRESETS) expect(p.maxWindowSec).toBe(2 * p.halfLifeSec);
    // decay at the auto window is exactly 0.75 as the doc says
    expect(decayProgress(coin(), coin().lastActivityAt + 7200)).toBe(0.75);
  });

  it('rejects non-integer / negative times and half-lives instead of producing a number', () => {
    expect(() => decayProgress(coin({ halfLifeSec: 0 }), 5)).toThrow();
    expect(() => decayProgress(coin({ halfLifeSec: -1 }), 5)).toThrow();
    expect(() => decayProgress(coin({ halfLifeSec: 1.5 }), 5)).toThrow();
    expect(() => decayProgress(coin(), 1.5)).toThrow();
    expect(() => decayProgress(coin(), -1)).toThrow();
    expect(() => decayProgress(coin(), NaN)).toThrow();
    expect(() => quietSeconds({ lastActivityAt: NaN }, 5)).toThrow();
  });
});

describe('Zeno mechanic (spec §5 l.183-185; economics.md §2)', () => {
  const lamports = fc.bigUintN(64);

  it('property: a buy never increases decayProgress, never moves the clock past now, removes at most 50 % of the quiet time (cap holds for any size), and is monotone in buy size', () => {
    fc.assert(
      fc.property(T, timeArb, fc.integer({ min: 0, max: 5_000_000 }), lamports, fc.bigUintN(64).map((x) => x + 1n), (hl, last, quiet, buy, mcap) => {
        const c = coin({ halfLifeSec: hl, lastActivityAt: last });
        const now = last + quiet;
        const before = decayProgress(c, now);
        const after = applyBuy(c, buy, mcap, now);
        expect(after.state).toBe('superposed');
        expect(decayProgress(after, now) <= before).toBe(true);
        expect(after.decayProgress).toBe(decayProgress(after, now));
        expect(after.lastActivityAt <= now).toBe(true);
        expect(after.lastActivityAt >= last).toBe(true);
        const removed = after.lastActivityAt - last;
        expect(removed <= Math.floor(quiet / 2)).toBe(true);
        // bigger buy, same everything: never removes less
        const bigger = applyBuy(c, buy * 2n + 1n, mcap, now);
        expect(bigger.lastActivityAt >= after.lastActivityAt).toBe(true);
        // a buy of ≥ 12.5 % of market cap hits the cap exactly: half the quiet time (floor) removed
        const capped = applyBuy(c, mcap, mcap, now);
        expect(capped.lastActivityAt - last).toBe(Math.floor(quiet / 2));
        const huge = applyBuy(c, mcap * 1_000_000n, mcap, now);
        expect(huge.lastActivityAt).toBe(capped.lastActivityAt);
        // input coin not mutated
        expect(c.lastActivityAt).toBe(last);
      }),
      { numRuns: 1500 },
    );
  });

  it('fraction = min(5000, floor(4 × buy × 10000 / mcap)) bps, exact bigint; documented examples: 1 % → 4 %, 5 % → 20 %, ≥ 12.5 % → cap', () => {
    expect(zenoResetBps(1n, 100n)).toBe(400);
    expect(zenoResetBps(5n, 100n)).toBe(2000);
    expect(zenoResetBps(125n, 1000n)).toBe(5000);
    expect(zenoResetBps(1n, 1n)).toBe(5000);
    expect(zenoResetBps(0n, 1n)).toBe(0);
    expect(zenoResetBps(1n, 10n ** 30n)).toBe(0);
    expect(() => zenoResetBps(-1n, 1n)).toThrow();
    expect(() => zenoResetBps(1n, 0n)).toThrow();
    fc.assert(
      fc.property(lamports, fc.bigUintN(64).map((x) => x + 1n), (buy, mcap) => {
        const raw = (4n * buy * 10_000n) / mcap;
        expect(zenoResetBps(buy, mcap)).toBe(Number(raw < 5000n ? raw : 5000n));
      }),
      { numRuns: 500 },
    );
    expect(economics).toMatch(/A buy worth 1 % of market cap removes 4 % of the quiet time; a buy worth\n5 % removes 20 %; anything from 12\.5 % of market cap upward hits the 50 %\ncap/);
  });

  it('economics.md §2 worked numbers: 2 h quiet at T = 1 h is 0.75; a 5 % buy leaves 1 h 36 min and 0.67', () => {
    const c = coin();
    const now = c.lastActivityAt + 7200;
    expect(decayProgress(c, now)).toBe(0.75);
    const after = applyBuy(c, 5n, 100n, now);
    expect(now - after.lastActivityAt).toBe(96 * 60);
    expect(decayProgress(after, now)).toBeCloseTo(0.67, 2);
  });

  it('FINDING H-E1 (LOW): economics.md says quietTimeAfter = quietTimeBefore × (1 − fraction) "rounded down", but the code rounds the REMOVED time down, so the remaining quiet time rounds up', () => {
    // Fixed (H-E1): the doc now states the code's semantics: the REMOVED time is floored, so the
    // remaining quiet time rounds in the coin's favour (consistent with the Zeno property above).
    expect(economics).toMatch(/quietTimeRemoved = floor\( quietTimeBefore × fractionRemoved \)/);
    expect(economics).toMatch(/quietTimeAfter {3}= quietTimeBefore − quietTimeRemoved/);
    // quiet = 7 s, fraction = 50 %: floor(3.5) = 3 s removed, 4 s left.
    const c = coin({ lastActivityAt: 100 });
    const after = applyBuy(c, 1n, 1n, 107);
    const quietAfter = 107 - after.lastActivityAt;
    expect(quietAfter).toBe(7 - Math.floor(7 * 0.5));
  });

  it('applyBuy on a collapsed coin throws; measured-alive and tunnelled settle to superposed; a buy before lastActivityAt changes nothing', () => {
    expect(() => applyBuy(coin({ state: 'collapsed' }), 1n, 1n, 2_000_000)).toThrow(/collapsed/);
    for (const s of ['measured-alive', 'tunnelled'] as const) expect(applyBuy(coin({ state: s }), 1n, 1n, 1_000_001).state).toBe('superposed');
    const c = coin();
    expect(applyBuy(c, 1n, 1n, c.lastActivityAt - 10).lastActivityAt).toBe(c.lastActivityAt);
    expect(() => resetQuietTime(c, c.lastActivityAt + 10, 10_001)).toThrow();
    expect(() => resetQuietTime(c, c.lastActivityAt + 10, -1)).toThrow();
  });
});
