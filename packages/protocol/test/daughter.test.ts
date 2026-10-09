import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_PARAMS,
  bandWidthBps,
  baseName,
  buildDaughterCoin,
  daughterBand,
  daughterHalfLifeSec,
  daughterName,
  daughterParamsFrom,
  deriveDaughterParams,
  generationPenaltyBps,
  initialImageLineage,
  longevityBps,
  motherFinalState,
  nextImageLineage,
  type Channel,
  type Coin,
  type Measurement,
  type MotherFinalState,
} from '../src/index.js';
import { IMAGE_HASH, channels, coin } from './fixtures.js';

const P = PROTOCOL_PARAMS;

const finalState = fc.record<MotherFinalState>({
  halfLifeSec: fc.integer({ min: P.HALF_LIFE_MIN_SEC, max: P.HALF_LIFE_MAX_SEC }),
  lifetimeSec: fc.integer({ min: 0, max: 100 * P.HALF_LIFE_MAX_SEC }),
  measurementsSurvived: fc.integer({ min: 0, max: 50 }),
  supplyRemainingBps: fc.integer({ min: 0, max: 10_000 }),
  generation: fc.integer({ min: 1, max: 40 }),
});

const channelArb = fc
  .record({
    lo: fc.integer({ min: P.HALF_LIFE_MIN_SEC, max: P.HALF_LIFE_MAX_SEC }),
    hi: fc.integer({ min: P.HALF_LIFE_MIN_SEC, max: P.HALF_LIFE_MAX_SEC }),
    pmin: fc.bigInt(0n, 10n ** 15n),
    pmax: fc.bigInt(0n, 10n ** 15n),
  })
  .map(
    ({ lo, hi, pmin, pmax }): Channel => ({
      id: 'x',
      probabilityPpm: 1_000_000,
      label: 'x',
      daughterParams: {
        halfLifeSec: { min: Math.min(lo, hi), max: Math.max(lo, hi) },
        poolUnits: { min: pmin < pmax ? pmin : pmax, max: pmin < pmax ? pmax : pmin },
      },
    }),
  );

const inherit = { name: 'PHOTON', imageLineage: initialImageLineage(IMAGE_HASH), imageHash: IMAGE_HASH, decayChannels: channels() };

describe('daughter mapping: bounded', () => {
  it('property: half-life within the clamp and the channel range; band inside the pool range; longevity in [0, 10000]', () => {
    fc.assert(
      fc.property(finalState, channelArb, (m, ch) => {
        const d = daughterParamsFrom(m, ch, inherit);
        expect(d.longevityBps).toBeGreaterThanOrEqual(0);
        expect(d.longevityBps).toBeLessThanOrEqual(10_000);
        expect(d.halfLifeSec).toBeGreaterThanOrEqual(P.HALF_LIFE_MIN_SEC);
        expect(d.halfLifeSec).toBeLessThanOrEqual(P.HALF_LIFE_MAX_SEC);
        expect(d.halfLifeSec).toBeLessThanOrEqual(ch.daughterParams.halfLifeSec.max);
        expect(d.superposition.supplyMin).toBeGreaterThanOrEqual(ch.daughterParams.poolUnits.min);
        expect(d.superposition.supplyMax).toBeLessThanOrEqual(ch.daughterParams.poolUnits.max);
        expect(d.superposition.supplyMin).toBeLessThanOrEqual(d.superposition.supplyMax);
        expect(d.generation).toBe(m.generation + 1);
        expect(d.name).toBe(`PHOTON·${m.generation + 1}`);
        expect(Number.isInteger(d.halfLifeSec)).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });
});

describe('daughter mapping: monotonic', () => {
  function expectMonotone(a: MotherFinalState, b: MotherFinalState, ch: Channel) {
    // b dominates a (longer life / more survives / more supply, same generation): longer half-life, tighter band
    const da = daughterParamsFrom(a, ch, inherit);
    const db = daughterParamsFrom(b, ch, inherit);
    expect(db.longevityBps).toBeGreaterThanOrEqual(da.longevityBps);
    expect(db.halfLifeSec).toBeGreaterThanOrEqual(da.halfLifeSec);
    const wa = da.superposition.supplyMax - da.superposition.supplyMin;
    const wb = db.superposition.supplyMax - db.superposition.supplyMin;
    expect(wb <= wa).toBe(true);
  }

  it('property: longer lifetime never shortens the daughter half-life or widens the band', () => {
    fc.assert(
      fc.property(finalState, channelArb, fc.integer({ min: 0, max: 10_000_000 }), (m, ch, extra) => {
        expectMonotone(m, { ...m, lifetimeSec: m.lifetimeSec + extra }, ch);
      }),
      { numRuns: 2000 },
    );
  });

  it('property: more survived measurements and more remaining supply are monotone too', () => {
    fc.assert(
      fc.property(finalState, channelArb, fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 10_000 }), (m, ch, k, s) => {
        expectMonotone(m, { ...m, measurementsSurvived: m.measurementsSurvived + k }, ch);
        expectMonotone(m, { ...m, supplyRemainingBps: Math.min(10_000, m.supplyRemainingBps + s) }, ch);
      }),
      { numRuns: 2000 },
    );
  });

  it('property: a later generation never gets a longer half-life, and the penalty is capped', () => {
    fc.assert(
      fc.property(finalState, channelArb, fc.integer({ min: 1, max: 30 }), (m, ch, g) => {
        const a = daughterParamsFrom(m, ch, inherit);
        const b = daughterParamsFrom({ ...m, generation: m.generation + g }, ch, inherit);
        expect(b.halfLifeSec).toBeLessThanOrEqual(a.halfLifeSec);
      }),
      { numRuns: 1000 },
    );
    expect(generationPenaltyBps(1)).toBe(0);
    expect(generationPenaltyBps(2)).toBe(P.DAUGHTER_GENERATION_PENALTY_BPS);
    expect(generationPenaltyBps(1000)).toBe(P.DAUGHTER_GENERATION_PENALTY_CAP_BPS);
  });

  it('worked points: fast death → shortest/widest, long survival → longest/tightest', () => {
    const ch = channels()[0]!; // half-life 3600..86400, pool 100M..300M
    const fast = longevityBps({ halfLifeSec: 3600, lifetimeSec: 0, measurementsSurvived: 0, supplyRemainingBps: 0, generation: 1 });
    const slow = longevityBps({ halfLifeSec: 3600, lifetimeSec: 3600 * 6, measurementsSurvived: 5, supplyRemainingBps: 10_000, generation: 1 });
    expect(fast).toBe(0);
    expect(slow).toBe(10_000);
    expect(daughterHalfLifeSec(fast, 2, ch.daughterParams.halfLifeSec)).toBe(3600);
    // lerp to 86400 then 5 % generation-2 penalty: 86400 × 0.95 = 82080
    expect(daughterHalfLifeSec(slow, 2, ch.daughterParams.halfLifeSec)).toBe(82_080);
    expect(bandWidthBps(fast)).toBe(10_000);
    expect(bandWidthBps(slow)).toBe(2_000);
    expect(daughterBand(fast, ch.daughterParams.poolUnits)).toEqual({ supplyMin: 100_000_000n, supplyMax: 300_000_000n });
    // 20 % of 200M = 40M wide, centred on 200M
    expect(daughterBand(slow, ch.daughterParams.poolUnits)).toEqual({ supplyMin: 180_000_000n, supplyMax: 220_000_000n });
    // half-way: lifetime 3 half-lives (fL = 5000), 2 survives (fM = 4000), 50 % supply → (5000×5000 + 3000×4000 + 2000×5000)/10000 = 4700
    expect(longevityBps({ halfLifeSec: 3600, lifetimeSec: 10_800, measurementsSurvived: 2, supplyRemainingBps: 5000, generation: 1 })).toBe(4700);
  });
});

describe('names and image lineage', () => {
  it('daughterName uses the middle dot and strips an existing generation suffix', () => {
    expect(daughterName('PHOTON', 2)).toBe('PHOTON·2');
    expect(daughterName('PHOTON·2', 3)).toBe('PHOTON·3');
    expect(daughterName('PHOTON', 1)).toBe('PHOTON');
    expect(daughterName('A·B', 2)).toBe('A·B·2'); // non-numeric suffix is part of the name
    expect(baseName('X·12')).toBe('X');
    expect(() => daughterName('X', 0)).toThrow();
  });

  it('image lineage is a sha256 chain', () => {
    const g1 = initialImageLineage(IMAGE_HASH);
    const g2 = nextImageLineage(g1, IMAGE_HASH);
    const g3 = nextImageLineage(g2, IMAGE_HASH);
    expect(g1).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([g1, g2, g3]).size).toBe(3);
    expect(nextImageLineage(g1, IMAGE_HASH)).toBe(g2); // deterministic
    expect(() => nextImageLineage('zz', IMAGE_HASH)).toThrow();
  });
});

describe('deriveDaughterParams from a collapsed coin', () => {
  const collapse = (over: Partial<Coin> = {}): Coin => {
    const survive = (id: string): Measurement => ({ id, at: 0, by: 'w', proofBundle: {} as never, outcome: { kind: 'survive' }, decayBefore: 0, decayAfter: 0 });
    const col: Measurement = { id: 'c', at: 0, by: 'w', proofBundle: {} as never, outcome: { kind: 'collapse', channelId: 'beta', channelIndex: 1, poolPointPpm: 0 }, decayBefore: 0, decayAfter: 1 };
    return coin({ state: 'collapsed', bornAt: 1_000_000, measurements: [survive('a'), survive('b'), col], ...over });
  };

  it('uses the collapse channel, counts survives, and inherits name/lineage/channels', () => {
    const mother = collapse();
    const at = 1_000_000 + 3600 * 3;
    const fs = motherFinalState(mother, at);
    expect(fs).toEqual({ halfLifeSec: 3600, lifetimeSec: 10_800, measurementsSurvived: 2, supplyRemainingBps: 10_000, generation: 1 });
    const d = deriveDaughterParams(mother, at);
    // longevity: fL 5000, fM 4000, fS 10000 → (25e6 + 12e6 + 20e6)/1e4 = 5700
    expect(d.longevityBps).toBe(5700);
    // beta: 7200 + (172800−7200) × 0.57 = 7200 + 94392 = 101592, × 0.95 = 96512.4 → 96512
    expect(d.halfLifeSec).toBe(96_512);
    expect(d.name).toBe('PHOTON·2');
    expect(d.generation).toBe(2);
    expect(d.decayChannels).toEqual(mother.decayChannels);
    expect(d.decayChannels).not.toBe(mother.decayChannels);
    expect(d.imageLineage).toBe(nextImageLineage(mother.image.lineage, mother.image.hash));

    const child = buildDaughterCoin(mother, d, { ca: 'Daughter1', identityRoot: 'c'.repeat(64), bornAt: at + 5, supply: mother.supply });
    expect(child.motherCa).toBe(mother.ca);
    expect(child.lineageId).toBe(mother.lineageId);
    expect(child.state).toBe('superposed');
    expect(child.generation).toBe(2);
    expect(child.halfLifeSec).toBe(96_512);
    expect(child.image.lineage).toBe(d.imageLineage);
    expect(child.lastActivityAt).toBe(at + 5);
    expect(daughterName(child.name, 3)).toBe('PHOTON·3');
  });

  it('refuses a coin that has not collapsed', () => {
    expect(() => deriveDaughterParams(coin(), 1_000_001)).toThrow(/not collapsed/);
    expect(() => deriveDaughterParams(coin({ state: 'collapsed' }), 1_000_001)).toThrow(/no collapse measurement/);
  });
});
