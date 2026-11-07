import { sha256, toHex } from '@qsd/crypto';
import { canonicalJson } from '@qsd/quantum';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEAF_HEX,
  PROTOCOL_PARAMS,
  allocationLeaf,
  allocationProof,
  allocationRoot,
  computeAllocation,
  entanglementWeightBps,
  verifyAllocationProof,
  type AllocationInput,
  type HolderSnapshot,
} from '../src/index.js';

const BORN = 1_000_000;
const COLLAPSE = 1_100_000;
const QUIET = 1_080_000;
const MEAS = [
  { id: 'm1', outcome: { kind: 'survive' as const } },
  { id: 'm2', outcome: { kind: 'survive' as const } },
  { id: 'mc', outcome: { kind: 'collapse' as const, channelId: 'alpha', channelIndex: 0, poolPointPpm: 0 } },
];

function input(snapshot: HolderSnapshot[], total = 1_000_000_000n): AllocationInput {
  return { snapshot, measurements: MEAS, bornAt: BORN, collapseAt: COLLAPSE, quietPeriodStart: QUIET, totalDaughterUnits: total };
}

const holderArb = fc.record({
  wallet: fc.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{8,12}$/),
  balance: fc.bigInt(0n, 10n ** 18n),
  firstAcquiredAt: fc.integer({ min: BORN, max: COLLAPSE }),
  held: fc.subarray(['m1', 'm2', 'mc', 'bogus']),
  quiet: fc.boolean(),
});

const snapshotArb = fc
  .uniqueArray(holderArb, { minLength: 1, maxLength: 40, selector: (h) => h.wallet })
  .map((hs) =>
    hs.map(
      (h): HolderSnapshot => ({
        wallet: h.wallet,
        balance: h.balance,
        firstAcquiredAt: h.firstAcquiredAt,
        heldThroughMeasurementIds: h.held,
        heldThroughQuietPeriod: h.quiet && h.firstAcquiredAt <= QUIET,
      }),
    ),
  )
  .filter((hs) => hs.some((h) => h.balance > 0n));

const totalArb = fc.bigInt(0n, 10n ** 24n);

describe('entanglement weight', () => {
  it('is 1.0× with nothing and 1.5× with everything; each factor contributes its documented share', () => {
    const ctx = { bornAt: BORN, collapseAt: COLLAPSE, survivedCount: 2 };
    expect(entanglementWeightBps({ firstAcquiredAt: COLLAPSE, heldThroughCount: 0, heldThroughQuietPeriod: false }, ctx)).toBe(10_000);
    expect(entanglementWeightBps({ firstAcquiredAt: BORN, heldThroughCount: 2, heldThroughQuietPeriod: true }, ctx)).toBe(15_000);
    expect(entanglementWeightBps({ firstAcquiredAt: BORN, heldThroughCount: 0, heldThroughQuietPeriod: false }, ctx)).toBe(12_500); // duration only: 0.5 × 0.5
    expect(entanglementWeightBps({ firstAcquiredAt: COLLAPSE, heldThroughCount: 2, heldThroughQuietPeriod: false }, ctx)).toBe(11_500); // measurements: 0.5 × 0.3
    expect(entanglementWeightBps({ firstAcquiredAt: COLLAPSE, heldThroughCount: 0, heldThroughQuietPeriod: true }, ctx)).toBe(11_000); // quiet: 0.5 × 0.2
    // no survived measurements → fM = 0 for everyone
    expect(entanglementWeightBps({ firstAcquiredAt: COLLAPSE, heldThroughCount: 0, heldThroughQuietPeriod: false }, { ...ctx, survivedCount: 0 })).toBe(10_000);
  });

  it('property: bounded in [10000, ENTANGLEMENT_WEIGHT_MAX_BPS] and monotone in duration', () => {
    fc.assert(
      fc.property(fc.integer({ min: BORN, max: COLLAPSE }), fc.integer({ min: 0, max: 5 }), fc.boolean(), fc.nat(100_000), (acq, held, q, earlier) => {
        const ctx = { bornAt: BORN, collapseAt: COLLAPSE, survivedCount: 2 };
        const w = entanglementWeightBps({ firstAcquiredAt: acq, heldThroughCount: held, heldThroughQuietPeriod: q }, ctx);
        const w2 = entanglementWeightBps({ firstAcquiredAt: Math.max(BORN, acq - earlier), heldThroughCount: held, heldThroughQuietPeriod: q }, ctx);
        expect(w).toBeGreaterThanOrEqual(10_000);
        expect(w).toBeLessThanOrEqual(PROTOCOL_PARAMS.ENTANGLEMENT_WEIGHT_MAX_BPS);
        expect(w2).toBeGreaterThanOrEqual(w);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('computeAllocation: normalisation', () => {
  it('property: units are non-negative, sum + dust == total exactly, dust < wallets, sorted by wallet, deterministic', () => {
    fc.assert(
      fc.property(snapshotArb, totalArb, (snapshot, total) => {
        const t = computeAllocation(input(snapshot, total));
        let sum = 0n;
        for (const e of t.entries) {
          expect(e.units >= 0n).toBe(true);
          expect(e.weightBps).toBeGreaterThanOrEqual(10_000);
          expect(e.weightBps).toBeLessThanOrEqual(15_000);
          sum += e.units;
        }
        expect(sum).toBe(t.allocatedUnits);
        expect(t.allocatedUnits + t.dustUnits).toBe(total);
        expect(t.dustUnits >= 0n).toBe(true);
        expect(t.dustUnits < BigInt(t.entries.length)).toBe(true);
        for (let i = 1; i < t.entries.length; i++) expect(t.entries[i - 1]!.wallet < t.entries[i]!.wallet).toBe(true);
        // deterministic regardless of input order
        const shuffled = [...snapshot].reverse();
        const t2 = computeAllocation(input(shuffled, total));
        expect(t2.merkleRoot).toBe(t.merkleRoot);
        expect(t2.entries).toEqual(t.entries);
        // a zero bag gets zero units; a sole holder gets everything
        for (const e of t.entries) if (e.bagUnits === 0n) expect(e.units).toBe(0n);
      }),
      { numRuns: 3000 },
    );
  });

  it('a single holder receives the whole pool with no dust', () => {
    const t = computeAllocation(input([{ wallet: 'A', balance: 5n, firstAcquiredAt: COLLAPSE, heldThroughMeasurementIds: [], heldThroughQuietPeriod: false }], 777n));
    expect(t.entries[0]!.units).toBe(777n);
    expect(t.dustUnits).toBe(0n);
    expect(t.entries[0]!.sharePpb).toBe(1_000_000_000);
    expect(t.entries[0]!.bagFractionPpb).toBe(1_000_000_000);
    expect(t.leafCount).toBe(2);
  });

  it('rejects empty, duplicate, negative, inconsistent quiet flags and an all-zero snapshot', () => {
    const h = (w: string, b: bigint): HolderSnapshot => ({ wallet: w, balance: b, firstAcquiredAt: COLLAPSE, heldThroughMeasurementIds: [], heldThroughQuietPeriod: false });
    expect(() => computeAllocation(input([]))).toThrow();
    expect(() => computeAllocation(input([h('A', 1n), h('A', 1n)]))).toThrow(/duplicate/);
    expect(() => computeAllocation(input([h('A', -1n)]))).toThrow();
    expect(() => computeAllocation(input([h('A', 0n)]))).toThrow(/nothing to allocate/);
    expect(() => computeAllocation(input([{ ...h('A', 1n), heldThroughQuietPeriod: true }]))).toThrow(/quiet period/);
    expect(() => computeAllocation({ ...input([h('A', 1n)]), collapseAt: BORN })).toThrow();
    expect(() => computeAllocation(input([h('A', 1n)], -1n))).toThrow();
  });
});

describe('computeAllocation: sybil resistance', () => {
  it('property: splitting a bag into two wallets with the same timing never increases the total received', () => {
    fc.assert(
      fc.property(snapshotArb, totalArb, fc.bigInt(0n, 10n ** 18n), fc.integer({ min: 0, max: 39 }), (snapshot, total, split, idx) => {
        const victim = snapshot[idx % snapshot.length]!;
        if (victim.balance === 0n) return;
        const b1 = split % (victim.balance + 1n);
        const b2 = victim.balance - b1;
        const unsplit = computeAllocation(input(snapshot, total));
        const u = unsplit.entries.find((e) => e.wallet === victim.wallet)!.units;
        const others = snapshot.filter((h) => h.wallet !== victim.wallet);
        const splitSnap: HolderSnapshot[] = [
          ...others,
          { ...victim, wallet: victim.wallet + '1', balance: b1 },
          { ...victim, wallet: victim.wallet + '2', balance: b2 },
        ];
        const t = computeAllocation(input(splitSnap, total));
        const got = t.entries.filter((e) => e.wallet.startsWith(victim.wallet) && e.wallet.length === victim.wallet.length + 1).reduce((s, e) => s + e.units, 0n);
        expect(got <= u).toBe(true);
        expect(got >= u - 1n).toBe(true); // and loses at most one base unit to the floor
      }),
      { numRuns: 3000 },
    );
  });

  it('property: splitting into k wallets never increases the total either', () => {
    fc.assert(
      fc.property(fc.bigInt(1n, 10n ** 15n), fc.array(fc.bigInt(0n, 10n ** 15n), { minLength: 1, maxLength: 8 }), totalArb, (bal, parts, total) => {
        const other: HolderSnapshot = { wallet: 'ZZZother', balance: 12_345n, firstAcquiredAt: BORN, heldThroughMeasurementIds: ['m1'], heldThroughQuietPeriod: true };
        const whole: HolderSnapshot = { wallet: 'AAA', balance: bal, firstAcquiredAt: BORN + 10, heldThroughMeasurementIds: ['m2'], heldThroughQuietPeriod: true };
        const sumParts = parts.reduce((s, p) => s + p, 0n);
        if (sumParts === 0n) return;
        const pieces: HolderSnapshot[] = parts.map((p, i) => ({ ...whole, wallet: `AAA${i}`, balance: (bal * p) / sumParts }));
        const rem = bal - pieces.reduce((s, p) => s + p.balance, 0n);
        pieces[0]!.balance += rem;
        const u = computeAllocation(input([other, whole], total)).entries.find((e) => e.wallet === 'AAA')!.units;
        const got = computeAllocation(input([other, ...pieces], total))
          .entries.filter((e) => e.wallet.startsWith('AAA'))
          .reduce((s, e) => s + e.units, 0n);
        expect(got <= u).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('computeAllocation: monotonicity', () => {
  it('property: holding longer never decreases your units, others fixed; a bigger bag never decreases them either', () => {
    fc.assert(
      fc.property(snapshotArb, totalArb, fc.integer({ min: 0, max: 39 }), fc.nat(100_000), fc.bigInt(0n, 10n ** 18n), (snapshot, total, idx, earlier, more) => {
        const i = idx % snapshot.length;
        const h = snapshot[i]!;
        const base = computeAllocation(input(snapshot, total)).entries.find((e) => e.wallet === h.wallet)!.units;
        const longer = snapshot.map((x, j) => (j === i ? { ...x, firstAcquiredAt: Math.max(BORN, x.firstAcquiredAt - earlier) } : x));
        const bigger = snapshot.map((x, j) => (j === i ? { ...x, balance: x.balance + more } : x));
        expect(computeAllocation(input(longer, total)).entries.find((e) => e.wallet === h.wallet)!.units >= base).toBe(true);
        expect(computeAllocation(input(bigger, total)).entries.find((e) => e.wallet === h.wallet)!.units >= base).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('Merkle commitment', () => {
  it('leaf is sha256(canonical({wallet, units})) with units as a decimal string; empty leaf is documented', () => {
    expect(toHex(allocationLeaf({ wallet: 'W', units: 42n }))).toBe(toHex(sha256(new TextEncoder().encode(canonicalJson({ units: '42', wallet: 'W' })))));
    expect(EMPTY_LEAF_HEX).toBe(toHex(sha256(new TextEncoder().encode('qsd/allocation/empty-leaf/v1'))));
  });

  it('property: root is reproducible from entries and every wallet has a verifying proof; tampering fails', () => {
    fc.assert(
      fc.property(snapshotArb, totalArb, (snapshot, total) => {
        const t = computeAllocation(input(snapshot, total));
        expect(allocationRoot(t.entries)).toBe(t.merkleRoot);
        expect(t.leafCount).toBeGreaterThanOrEqual(t.entries.length);
        expect(Math.log2(t.leafCount) % 1).toBe(0);
        for (const e of t.entries) {
          const proof = allocationProof(t, e.wallet);
          expect(proof.path.length).toBe(Math.log2(t.leafCount));
          expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units }, proof)).toBe(true);
          expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units + 1n }, proof)).toBe(false);
          expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet + 'x', units: e.units }, proof)).toBe(false);
          expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units }, { ...proof, index: proof.index ^ 1 })).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('verifyAllocationProof never throws on garbage', () => {
    expect(verifyAllocationProof('zz', { wallet: 'a', units: 1n }, { index: 0, path: ['nothex'] })).toBe(false);
    expect(verifyAllocationProof('00'.repeat(32), { wallet: 'a', units: 1n }, { index: 5, path: ['00'.repeat(32)] })).toBe(false);
    expect(() => allocationProof(computeAllocation(input([{ wallet: 'A', balance: 1n, firstAcquiredAt: COLLAPSE, heldThroughMeasurementIds: [], heldThroughQuietPeriod: false }])), 'B')).toThrow();
  });
});
