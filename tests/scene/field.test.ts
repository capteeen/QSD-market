/**
 * Item 6: FieldScene mapping. SPEC §7 FIELD SCENE: "cloud spread =
 * uncertainty; bright tight = heavily traded, wide dim drifting = untouched
 * and near collapse."
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { STATE_HEX, vesselParams, vesselPosition, type FieldCoin } from '@qsd/scene';

const states = ['superposed', 'measured-alive', 'collapsed', 'tunnelled', 'decaying', 'dead'] as const;
const anyNumber = fc.oneof(fc.double({ noNaN: false, noDefaultInfinity: false }), fc.constantFrom(NaN, Infinity, -Infinity, -0, 1e308, -1e308));
const coinArb = fc.record({
  ca: fc.string(),
  uncertainty: anyNumber,
  activity: anyNumber,
  decayProgress: anyNumber,
  state: fc.constantFrom(...states),
}) as fc.Arbitrary<FieldCoin>;
const unit = fc.double({ min: 0, max: 1, noNaN: true });

describe('vesselParams', () => {
  it('is pure and total: same input → identical output; every output finite and in its documented range (fast-check, incl. NaN/±∞)', () => {
    fc.assert(
      fc.property(coinArb, (coin) => {
        const a = vesselParams(coin);
        const b = vesselParams({ ...coin });
        expect(a).toEqual(b);
        expect(a.spread).toBeGreaterThanOrEqual(0.25);
        expect(a.spread).toBeLessThanOrEqual(1.75);
        expect(a.brightness).toBeGreaterThanOrEqual(0.05);
        expect(a.brightness).toBeLessThanOrEqual(1);
        expect(a.drift).toBeGreaterThanOrEqual(0);
        expect(a.drift).toBeLessThanOrEqual(1);
        expect(a.density).toBeGreaterThanOrEqual(0.1);
        expect(a.density).toBeLessThanOrEqual(1);
        expect([0, 1]).toContain(a.settled);
        expect(a.tint).toMatch(/^#[0-9A-Fa-f]{6}$/);
        for (const v of [a.spread, a.brightness, a.drift, a.density]) expect(Number.isFinite(v)).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });

  it('does not depend on time or randomness (two calls far apart, two processes-worth of calls)', () => {
    const coin: FieldCoin = { ca: 'x', uncertainty: 0.4, activity: 0.3, decayProgress: 0.6, state: 'decaying' };
    const first = vesselParams(coin);
    const t0 = Date.now();
    while (Date.now() - t0 < 20) {
      /* spin */
    }
    for (let i = 0; i < 1000; i++) expect(vesselParams(coin)).toEqual(first);
  });

  it('heavily traded → brighter and tighter (monotone in activity, for every uncertainty/decay)', () => {
    fc.assert(
      fc.property(unit, unit, unit, unit, (u, d, a1, a2) => {
        const [lo, hi] = a1 <= a2 ? [a1, a2] : [a2, a1];
        const p1 = vesselParams({ ca: 'a', uncertainty: u, decayProgress: d, activity: lo, state: 'superposed' });
        const p2 = vesselParams({ ca: 'a', uncertainty: u, decayProgress: d, activity: hi, state: 'superposed' });
        expect(p2.brightness).toBeGreaterThanOrEqual(p1.brightness - 1e-12);
        expect(p2.spread).toBeLessThanOrEqual(p1.spread + 1e-12);
        expect(p2.drift).toBeLessThanOrEqual(p1.drift + 1e-12);
        expect(p2.density).toBeGreaterThanOrEqual(p1.density - 1e-12);
      }),
      { numRuns: 2000 },
    );
    // strict at the extremes
    const dead = vesselParams({ ca: 'a', uncertainty: 0.5, decayProgress: 0.9, activity: 0, state: 'superposed' });
    const hot = vesselParams({ ca: 'a', uncertainty: 0.5, decayProgress: 0.9, activity: 1, state: 'superposed' });
    expect(hot.brightness).toBeGreaterThan(dead.brightness);
    expect(hot.spread).toBeLessThan(dead.spread);
    expect(hot.drift).toBeLessThan(dead.drift);
    expect(hot.drift).toBe(0); // traded coins sit still
  });

  it('untouched and near collapse → dimmer, wider-or-equal, more drift (monotone in decayProgress)', () => {
    fc.assert(
      fc.property(unit, unit, unit, unit, (u, a, d1, d2) => {
        const [lo, hi] = d1 <= d2 ? [d1, d2] : [d2, d1];
        const p1 = vesselParams({ ca: 'a', uncertainty: u, activity: a, decayProgress: lo, state: 'superposed' });
        const p2 = vesselParams({ ca: 'a', uncertainty: u, activity: a, decayProgress: hi, state: 'superposed' });
        expect(p2.brightness).toBeLessThanOrEqual(p1.brightness + 1e-12);
        expect(p2.spread).toBeGreaterThanOrEqual(p1.spread - 1e-12);
        expect(p2.drift).toBeGreaterThanOrEqual(p1.drift - 1e-12);
      }),
      { numRuns: 2000 },
    );
    const fresh = vesselParams({ ca: 'a', uncertainty: 0.5, activity: 0, decayProgress: 0, state: 'superposed' });
    const dying = vesselParams({ ca: 'a', uncertainty: 0.5, activity: 0, decayProgress: 1, state: 'superposed' });
    expect(dying.brightness).toBeLessThan(fresh.brightness);
    expect(dying.drift).toBeGreaterThan(fresh.drift);
    expect(dying.drift).toBe(1);
    expect(fresh.drift).toBe(0);
  });

  it('cloud spread = uncertainty (monotone in uncertainty; zero uncertainty → minimum spread)', () => {
    fc.assert(
      fc.property(unit, unit, unit, unit, (a, d, u1, u2) => {
        const [lo, hi] = u1 <= u2 ? [u1, u2] : [u2, u1];
        const p1 = vesselParams({ ca: 'a', uncertainty: lo, activity: a, decayProgress: d, state: 'superposed' });
        const p2 = vesselParams({ ca: 'a', uncertainty: hi, activity: a, decayProgress: d, state: 'superposed' });
        expect(p2.spread).toBeGreaterThanOrEqual(p1.spread - 1e-12);
      }),
      { numRuns: 2000 },
    );
    expect(vesselParams({ ca: 'a', uncertainty: 0, activity: 0.5, decayProgress: 0.5, state: 'superposed' }).spread).toBe(0.25);
    expect(vesselParams({ ca: 'a', uncertainty: 1, activity: 0, decayProgress: 0, state: 'superposed' }).spread).toBe(1.75);
  });

  it('collapsed / dead coins are settled (no cloud); every state has a tint from the ui-tokens palette', () => {
    for (const st of states) {
      const p = vesselParams({ ca: 'a', uncertainty: 0.5, activity: 0.5, decayProgress: 0.5, state: st });
      expect(p.settled).toBe(st === 'collapsed' || st === 'dead' ? 1 : 0);
      expect(p.tint).toBe(STATE_HEX[st]);
    }
    // unknown state: falls back to the dead tint, never throws, never invents
    const p = vesselParams({ ca: 'a', uncertainty: 0.5, activity: 0.5, decayProgress: 0.5, state: 'nonsense' as never });
    expect(p.tint).toBe(STATE_HEX.dead);
  });
});

describe('vesselPosition', () => {
  it('is deterministic, finite, inside the disc, and 350 vessels are pairwise ≥ 1.2 apart at the default radius', () => {
    const n = 350;
    const R = Math.max(6, Math.sqrt(n) * 1.35);
    const pts = Array.from({ length: n }, (_, i) => vesselPosition(i, n, R));
    for (const [x, y, z] of pts) {
      expect(y).toBe(0);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(R + 1e-9);
      expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
    }
    let minD = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minD = Math.min(minD, Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![2] - pts[j]![2]));
    expect(minD).toBeGreaterThanOrEqual(1.2);
    expect(vesselPosition(7, n, R)).toEqual(vesselPosition(7, n, R));
  });
});
