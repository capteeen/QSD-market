import { describe, expect, it } from 'vitest';
import { STATE_HEX, vesselParams, vesselPosition, type FieldCoin } from '../src/model/index.js';

const states = ['superposed', 'measured-alive', 'collapsed', 'tunnelled', 'decaying', 'dead'] as const;

describe('vesselParams', () => {
  it('is pure: the same input gives the same output', () => {
    const c: FieldCoin = { ca: 'x', uncertainty: 0.3, activity: 0.6, decayProgress: 0.2, state: 'superposed' };
    expect(vesselParams(c)).toEqual(vesselParams({ ...c }));
  });

  it('is bounded for every input, including NaN, Infinity and out-of-range values', () => {
    const samples = [-1e9, -1, -0.5, 0, 0.1, 0.5, 0.9, 1, 2, 1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const state of states) {
      for (const u of samples) {
        for (const a of samples) {
          for (const d of samples) {
            const p = vesselParams({ ca: 'c', uncertainty: u, activity: a, decayProgress: d, state });
            expect(p.spread).toBeGreaterThanOrEqual(0.25);
            expect(p.spread).toBeLessThanOrEqual(1.75);
            expect(p.brightness).toBeGreaterThanOrEqual(0.05);
            expect(p.brightness).toBeLessThanOrEqual(1);
            expect(p.drift).toBeGreaterThanOrEqual(0);
            expect(p.drift).toBeLessThanOrEqual(1);
            expect(p.density).toBeGreaterThanOrEqual(0.1);
            expect(p.density).toBeLessThanOrEqual(1);
            expect([0, 1]).toContain(p.settled);
            expect(p.tint).toBe(STATE_HEX[state]);
          }
        }
      }
    }
  });

  it('encodes the spec: bright tight = heavily traded, wide dim drifting = untouched and near collapse', () => {
    const traded = vesselParams({ ca: 'a', uncertainty: 0.5, activity: 1, decayProgress: 0, state: 'superposed' });
    const untouched = vesselParams({ ca: 'b', uncertainty: 0.5, activity: 0, decayProgress: 0.95, state: 'decaying' });
    expect(traded.brightness).toBeGreaterThan(untouched.brightness);
    expect(traded.spread).toBeLessThan(untouched.spread);
    expect(traded.drift).toBeLessThan(untouched.drift);
    const wide = vesselParams({ ca: 'c', uncertainty: 1, activity: 0, decayProgress: 0, state: 'superposed' });
    const narrow = vesselParams({ ca: 'd', uncertainty: 0, activity: 0, decayProgress: 0, state: 'superposed' });
    expect(wide.spread).toBeGreaterThan(narrow.spread);
    expect(vesselParams({ ca: 'e', uncertainty: 1, activity: 1, decayProgress: 0, state: 'collapsed' }).settled).toBe(1);
  });
});

describe('vesselPosition', () => {
  it('places every index at a distinct, finite point inside the radius', () => {
    const n = 400;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const [x, y, z] = vesselPosition(i, n, 20);
      expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
      expect(y).toBe(0);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(20 + 1e-9);
      seen.add(`${x.toFixed(4)},${z.toFixed(4)}`);
    }
    expect(seen.size).toBe(n);
  });

  it('keeps neighbours apart (no two vessels closer than a floor)', () => {
    const n = 300;
    const pts = Array.from({ length: n }, (_, i) => vesselPosition(i, n, 20));
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![2] - pts[j]![2]));
    expect(min).toBeGreaterThan(1.5);
  });
});
