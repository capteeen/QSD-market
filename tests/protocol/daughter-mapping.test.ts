/**
 * Agent H — daughter parameter mapping: monotone (longer life → longer
 * half-life, tighter band) and bounded, property-tested with own generators;
 * generation suffix; generation 1000. Spec §5 l.191-197 ("Agent H checks it
 * is monotonic and bounded").
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  GENERATION_SEPARATOR,
  PROTOCOL_PARAMS,
  bandWidthBps,
  baseName,
  daughterBand,
  daughterHalfLifeSec,
  daughterName,
  daughterParamsFrom,
  generationPenaltyBps,
  longevityBps,
  type Channel,
  type MotherFinalState,
} from '@qsd/protocol';

const P = PROTOCOL_PARAMS;

const stateArb: fc.Arbitrary<MotherFinalState> = fc.record({
  halfLifeSec: fc.integer({ min: 1, max: 2_000_000 }),
  lifetimeSec: fc.integer({ min: 0, max: 100_000_000 }),
  measurementsSurvived: fc.integer({ min: 0, max: 50 }),
  supplyRemainingBps: fc.integer({ min: 0, max: 10_000 }),
  generation: fc.integer({ min: 1, max: 1000 }),
});

const channelArb: fc.Arbitrary<Channel> = fc
  .record({
    lo: fc.integer({ min: 0, max: 2_000_000 }),
    hi: fc.integer({ min: 0, max: 2_000_000 }),
    pmin: fc.bigUintN(70),
    pspan: fc.bigUintN(70),
  })
  .map(({ lo, hi, pmin, pspan }) => ({
    id: 'c',
    probabilityPpm: 1_000_000,
    label: 'c',
    daughterParams: { halfLifeSec: { min: Math.min(lo, hi), max: Math.max(lo, hi) }, poolUnits: { min: pmin, max: pmin + pspan } },
  }));

const inherit = { name: 'PHOTON', imageLineage: '11'.repeat(32), imageHash: '22'.repeat(32), decayChannels: [] as Channel[] };

const width = (b: { supplyMin: bigint; supplyMax: bigint }) => b.supplyMax - b.supplyMin;

describe('daughter mapping: bounded (spec §5 l.191-195)', () => {
  it('property: longevity ∈ [0, 10000]; half-life ∈ [HALF_LIFE_MIN, HALF_LIFE_MAX]; band inside the channel pool range; generation = mother + 1', () => {
    fc.assert(
      fc.property(stateArb, channelArb, (m, ch) => {
        const L = longevityBps(m);
        expect(L).toBeGreaterThanOrEqual(0);
        expect(L).toBeLessThanOrEqual(10_000);
        const d = daughterParamsFrom(m, ch, inherit);
        expect(d.longevityBps).toBe(L);
        expect(d.halfLifeSec).toBeGreaterThanOrEqual(P.HALF_LIFE_MIN_SEC);
        expect(d.halfLifeSec).toBeLessThanOrEqual(P.HALF_LIFE_MAX_SEC);
        expect(Number.isInteger(d.halfLifeSec)).toBe(true);
        const { min, max } = ch.daughterParams.poolUnits;
        expect(d.superposition.supplyMin >= min && d.superposition.supplyMin <= d.superposition.supplyMax && d.superposition.supplyMax <= max).toBe(true);
        expect(d.generation).toBe(m.generation + 1);
        expect(d.name).toBe(`PHOTON${GENERATION_SEPARATOR}${m.generation + 1}`);
      }),
      { numRuns: 1500 },
    );
  });

  it('generation 1000 (and 10 000): penalty capped at 50 %, half-life still within bounds, no overflow or NaN', () => {
    expect(generationPenaltyBps(1000)).toBe(P.DAUGHTER_GENERATION_PENALTY_CAP_BPS);
    expect(generationPenaltyBps(2)).toBe(500);
    expect(generationPenaltyBps(11)).toBe(5000);
    expect(generationPenaltyBps(1)).toBe(0);
    for (const gen of [999, 1000, 10_000, 2 ** 31]) {
      const d = daughterParamsFrom({ halfLifeSec: 3600, lifetimeSec: 10 ** 9, measurementsSurvived: 10 ** 6, supplyRemainingBps: 10_000, generation: gen }, {
        id: 'c',
        probabilityPpm: 1_000_000,
        label: 'c',
        daughterParams: { halfLifeSec: { min: 3600, max: 604_800 }, poolUnits: { min: 0n, max: 10n ** 30n } },
      }, inherit);
      expect(d.halfLifeSec).toBe(Math.max(P.HALF_LIFE_MIN_SEC, Math.floor((604_800 * 5000) / 10_000)));
      expect(d.generation).toBe(gen + 1);
      expect(d.name).toBe(`PHOTON·${gen + 1}`);
      expect(width(d.superposition)).toBe((10n ** 30n * 2000n) / 10_000n);
    }
  });

  it('a channel range outside the global bounds is clamped, not trusted', () => {
    expect(daughterHalfLifeSec(10_000, 1, { min: 1, max: 10 ** 9 })).toBe(P.HALF_LIFE_MAX_SEC);
    expect(daughterHalfLifeSec(10_000, 2, { min: 1, max: 10 ** 9 })).toBe(Math.floor(P.HALF_LIFE_MAX_SEC * 0.95));
    expect(daughterHalfLifeSec(0, 2, { min: 1, max: 10 ** 9 })).toBe(P.HALF_LIFE_MIN_SEC);
    expect(() => daughterHalfLifeSec(0, 2, { min: 10_000, max: 5_000 })).toThrow();
    expect(daughterHalfLifeSec(0, 2, { min: 10, max: 5 })).toBe(P.HALF_LIFE_MIN_SEC); // both ends clamp to the same bound first
    expect(() => daughterBand(0, { min: 5n, max: 4n })).toThrow();
    expect(() => daughterBand(0, { min: -1n, max: 4n })).toThrow();
  });
});

describe('daughter mapping: monotone (spec §5 l.193-195)', () => {
  const bump = (m: MotherFinalState, k: keyof MotherFinalState, d: number): MotherFinalState => ({ ...m, [k]: m[k] + d });

  it('property: longer life, more survives, more supply ⇒ longevity non-decreasing, half-life non-decreasing, band non-widening', () => {
    fc.assert(
      fc.property(stateArb, channelArb, fc.integer({ min: 0, max: 50_000_000 }), fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 10_000 }), (m, ch, dl, dm, ds) => {
        const variants: MotherFinalState[] = [
          bump(m, 'lifetimeSec', dl),
          bump(m, 'measurementsSurvived', dm),
          { ...m, supplyRemainingBps: Math.min(10_000, m.supplyRemainingBps + ds) },
        ];
        const base = daughterParamsFrom(m, ch, inherit);
        for (const v of variants) {
          const d = daughterParamsFrom(v, ch, inherit);
          expect(longevityBps(v) >= longevityBps(m)).toBe(true);
          expect(d.halfLifeSec >= base.halfLifeSec).toBe(true);
          expect(width(d.superposition) <= width(base.superposition)).toBe(true);
        }
      }),
      { numRuns: 1500 },
    );
  });

  it('property: a later generation never gets a longer half-life from the same final state; the band does not depend on generation', () => {
    fc.assert(
      fc.property(stateArb, channelArb, fc.integer({ min: 1, max: 100 }), (m, ch, dg) => {
        const a = daughterParamsFrom(m, ch, inherit);
        const b = daughterParamsFrom({ ...m, generation: m.generation + dg }, ch, inherit);
        expect(b.halfLifeSec <= a.halfLifeSec).toBe(true);
        expect(b.superposition).toEqual(a.superposition);
      }),
      { numRuns: 800 },
    );
  });

  it('property: half-life is non-decreasing in longevity and band width is non-increasing; end points are the channel min/full range and channel max/20 %', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 10_000 }), channelArb, (l1, l2, ch) => {
        const [lo, hi] = l1 <= l2 ? [l1, l2] : [l2, l1];
        expect(daughterHalfLifeSec(hi, 1, ch.daughterParams.halfLifeSec) >= daughterHalfLifeSec(lo, 1, ch.daughterParams.halfLifeSec)).toBe(true);
        expect(bandWidthBps(hi) <= bandWidthBps(lo)).toBe(true);
        expect(width(daughterBand(hi, ch.daughterParams.poolUnits)) <= width(daughterBand(lo, ch.daughterParams.poolUnits))).toBe(true);
      }),
      { numRuns: 800 },
    );
    expect(bandWidthBps(0)).toBe(P.DAUGHTER_BAND_WIDTH_MAX_BPS);
    expect(bandWidthBps(10_000)).toBe(P.DAUGHTER_BAND_WIDTH_MIN_BPS);
    const pool = { min: 1_000n, max: 11_000n };
    expect(daughterBand(0, pool)).toEqual({ supplyMin: 1_000n, supplyMax: 11_000n });
    expect(daughterBand(10_000, pool)).toEqual({ supplyMin: 5_000n, supplyMax: 7_000n });
    const r = { min: 3600, max: 86_400 };
    expect(daughterHalfLifeSec(0, 1, r)).toBe(3600);
    expect(daughterHalfLifeSec(10_000, 1, r)).toBe(86_400);
  });

  it('the economics.md §5 example: 1-hour mother, 3 half-lives, 2 survives, 50 % supply ⇒ L = 0.47 exactly', () => {
    expect(longevityBps({ halfLifeSec: 3600, lifetimeSec: 3 * 3600, measurementsSurvived: 2, supplyRemainingBps: 5000, generation: 1 })).toBe(4700);
  });

  it('refuses non-integer or negative final-state inputs rather than mapping them', () => {
    const ch = { id: 'c', probabilityPpm: 1_000_000, label: 'c', daughterParams: { halfLifeSec: { min: 3600, max: 3600 }, poolUnits: { min: 0n, max: 1n } } };
    const ok: MotherFinalState = { halfLifeSec: 3600, lifetimeSec: 1, measurementsSurvived: 0, supplyRemainingBps: 0, generation: 1 };
    expect(() => daughterParamsFrom({ ...ok, generation: 0 }, ch, inherit)).toThrow();
    expect(() => daughterParamsFrom({ ...ok, lifetimeSec: -1 }, ch, inherit)).toThrow();
    expect(() => daughterParamsFrom({ ...ok, lifetimeSec: 1.5 }, ch, inherit)).toThrow();
    expect(() => daughterParamsFrom({ ...ok, measurementsSurvived: -1 }, ch, inherit)).toThrow();
  });
});

describe('daughter name (spec §5 l.196-197)', () => {
  it('uses U+00B7 and replaces an existing suffix instead of stacking', () => {
    expect(GENERATION_SEPARATOR).toBe('·');
    expect(daughterName('PHOTON', 2)).toBe('PHOTON·2');
    expect(daughterName('PHOTON·2', 3)).toBe('PHOTON·3');
    expect(daughterName('PHOTON·99', 100)).toBe('PHOTON·100');
    expect(daughterName('PHOTON·2', 1)).toBe('PHOTON');
    expect(baseName('A·B·3')).toBe('A·B');
    expect(baseName('A·B')).toBe('A·B'); // non-numeric suffix kept
    expect(daughterName('PHOTON·2', 1000)).toBe('PHOTON·1000');
    expect(() => daughterName('X', 0)).toThrow();
    expect(() => daughterName('X', 1.5)).toThrow();
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('·')), fc.integer({ min: 2, max: 10_000 }), fc.integer({ min: 2, max: 10_000 }), (name, g1, g2) => {
        const once = daughterName(name, g1);
        expect(daughterName(once, g2)).toBe(`${name}·${g2}`);
        expect(once.split('·').length).toBe(2);
      }),
      { numRuns: 300 },
    );
  });

  it('INFO H-E4: a name that is only a dot-number (e.g. "·5") is not recognised as a suffix and stacks ("·5·2")', () => {
    expect(daughterName('·5', 2)).toBe('·5·2');
  });
});
