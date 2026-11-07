/**
 * Agent H — allocation properties with Agent H's OWN generators and an
 * INDEPENDENT Merkle recomputation (tests/reference/xmss-ref.ts RAND_HASH,
 * node:crypto SHA-256, own canonical JSON, own tree).
 *
 * Spec §5 l.199-216 (deterministic, sum-normalised, non-negative, sybil:
 * splitting never increases, Merkle root of the table) and §10 l.409-410.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import {
  ALLOCATION_TREE_SEED_HEX,
  EMPTY_LEAF_HEX,
  PROTOCOL_PARAMS,
  allocationProof,
  computeAllocation,
  entanglementWeightBps,
  verifyAllocationProof,
  type AllocationInput,
  type HolderSnapshot,
  type Measurement,
} from '@qsd/protocol';
import { ADRS, RAND_HASH, unhex, hex } from '../reference/xmss-ref.js';

// ------------------------------------------------------------ Agent H's own tooling

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Own canonical JSON for the two-key leaf object: keys sorted, JSON.stringify escaping. */
function leafHex(wallet: string, units: bigint): string {
  const json = `{"units":${JSON.stringify(units.toString())},"wallet":${JSON.stringify(wallet)}}`;
  return hex(sha256(utf8(json)));
}

/** Own tree: XMSS hash-tree addressing (type 2, treeHeight = level, treeIndex = parent index). */
function ownRoot(leavesHex: string[], seedHex: string): string {
  const seed = unhex(seedHex);
  let level = leavesHex.map(unhex);
  let h = 0;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length / 2; i++) {
      const adrs = new ADRS();
      adrs.setType(2);
      adrs.setTreeHeight(h);
      adrs.setTreeIndex(i);
      next.push(RAND_HASH(level[2 * i]!, level[2 * i + 1]!, seed, adrs));
    }
    level = next;
    h++;
  }
  return hex(level[0]!);
}

function padPow2(leaves: string[], empty: string): string[] {
  let n = 2;
  while (n < leaves.length) n *= 2;
  const out = leaves.slice();
  while (out.length < n) out.push(empty);
  return out;
}

const BORN = 1_000_000;
const COLLAPSE = 1_100_000;
const QUIET = 1_080_000;
const MEAS: Pick<Measurement, 'id' | 'outcome'>[] = [
  { id: 'm1', outcome: { kind: 'survive' } },
  { id: 'm2', outcome: { kind: 'survive' } },
  { id: 'm3', outcome: { kind: 'tunnel' } },
  { id: 'm4', outcome: { kind: 'survive' } },
  { id: 'm5', outcome: { kind: 'collapse', channelId: 'alpha', channelIndex: 0, poolPointPpm: 1 } },
];
const SURVIVED = ['m1', 'm2', 'm4'];

const base58Char = fc.constantFrom(...'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.split(''));
const walletArb = fc.array(base58Char, { minLength: 32, maxLength: 44 }).map((a) => a.join(''));

const holderArb = (wallet: string): fc.Arbitrary<HolderSnapshot> =>
  fc
    .record({
      balance: fc.oneof(fc.constant(0n), fc.bigUintN(40), fc.bigUintN(90)),
      firstAcquiredAt: fc.integer({ min: BORN, max: COLLAPSE }),
      held: fc.subarray(MEAS.map((m) => m.id)),
      quiet: fc.boolean(),
    })
    .map(({ balance, firstAcquiredAt, held, quiet }) => ({
      wallet,
      balance,
      firstAcquiredAt,
      heldThroughMeasurementIds: held,
      heldThroughQuietPeriod: quiet && firstAcquiredAt <= QUIET,
    }));

const snapshotArb = (min = 1, max = 12) =>
  fc.uniqueArray(walletArb, { minLength: min, maxLength: max }).chain((ws) => fc.tuple(...ws.map(holderArb))).filter((hs) => hs.some((h) => h.balance > 0n));

const totalArb = fc.oneof(fc.constant(0n), fc.constant(1n), fc.bigUintN(30), fc.bigUintN(64), fc.bigUintN(100));

const input = (snapshot: HolderSnapshot[], totalDaughterUnits: bigint): AllocationInput => ({
  snapshot,
  measurements: MEAS,
  bornAt: BORN,
  collapseAt: COLLAPSE,
  quietPeriodStart: QUIET,
  totalDaughterUnits,
});

const unitsOf = (snap: HolderSnapshot[], total: bigint, wallet: string): bigint =>
  computeAllocation(input(snap, total)).entries.find((e) => e.wallet === wallet)!.units;

// ------------------------------------------------------------ properties

describe('allocation: normalisation and bounds (spec §5 l.205-207)', () => {
  it('property: Σ units + dust == total exactly, every unit ≥ 0, dust < wallets, weights in [10000, 15000], sorted by wallet', () => {
    fc.assert(
      fc.property(snapshotArb(), totalArb, (snap, total) => {
        const t = computeAllocation(input(snap, total));
        let sum = 0n;
        for (const e of t.entries) {
          expect(e.units >= 0n).toBe(true);
          expect(e.weightBps).toBeGreaterThanOrEqual(10_000);
          expect(e.weightBps).toBeLessThanOrEqual(PROTOCOL_PARAMS.ENTANGLEMENT_WEIGHT_MAX_BPS);
          sum += e.units;
        }
        expect(sum + t.dustUnits).toBe(total);
        expect(t.allocatedUnits).toBe(sum);
        expect(t.dustUnits >= 0n && t.dustUnits < BigInt(t.entries.length)).toBe(true);
        for (let i = 1; i < t.entries.length; i++) expect(t.entries[i - 1]!.wallet < t.entries[i]!.wallet).toBe(true);
        expect(t.entries.length).toBe(snap.length);
      }),
      { numRuns: 600 },
    );
  });

  it('property: deterministic regardless of input order (and of heldThrough id order)', () => {
    fc.assert(
      fc.property(snapshotArb(2, 10), totalArb, fc.infiniteStream(fc.nat()), (snap, total, rnd) => {
        const a = computeAllocation(input(snap, total));
        const it = rnd[Symbol.iterator]();
        const shuffled = snap
          .map((h) => ({ ...h, heldThroughMeasurementIds: [...h.heldThroughMeasurementIds].reverse() }))
          .sort(() => ((it.next().value as number) % 2 === 0 ? -1 : 1));
        const b = computeAllocation(input(shuffled, total));
        expect(JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      }),
      { numRuns: 300 },
    );
  });
});

describe('allocation: sybil resistance (spec §5 l.209-211, §10 l.409-410)', () => {
  it('property: a k-way split of one bag (same timing) never increases the total and loses at most k−1 units', () => {
    fc.assert(
      fc.property(
        snapshotArb(1, 8),
        totalArb,
        fc.integer({ min: 2, max: 7 }),
        fc.array(fc.bigUintN(16), { minLength: 6, maxLength: 6 }),
        fc.uniqueArray(walletArb, { minLength: 7, maxLength: 7 }),
        (snap, total, k, cuts, freshWallets) => {
          const idx = snap.findIndex((h) => h.balance > 0n);
          const whole = snap[idx]!;
          const before = unitsOf(snap, total, whole.wallet);
          // split whole.balance into k non-negative parts
          const parts: bigint[] = [];
          let rest = whole.balance;
          for (let i = 0; i < k - 1; i++) {
            const p = rest === 0n ? 0n : cuts[i]! % (rest + 1n);
            parts.push(p);
            rest -= p;
          }
          parts.push(rest);
          const used = new Set(snap.map((h) => h.wallet));
          const names = freshWallets.filter((w) => !used.has(w)).slice(0, k);
          fc.pre(names.length === k);
          const pieces: HolderSnapshot[] = parts.map((balance, i) => ({ ...whole, wallet: names[i]!, balance }));
          const split = [...snap.slice(0, idx), ...snap.slice(idx + 1), ...pieces];
          const t = computeAllocation(input(split, total));
          const after = pieces.reduce((s, p) => s + t.entries.find((e) => e.wallet === p.wallet)!.units, 0n);
          expect(after <= before).toBe(true);
          expect(before - after <= BigInt(k - 1)).toBe(true);
          // nobody else lost or gained from the split either
          const tBefore = computeAllocation(input(snap, total));
          for (const e of tBefore.entries) {
            if (e.wallet === whole.wallet) continue;
            expect(t.entries.find((x) => x.wallet === e.wallet)!.units).toBe(e.units);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('allocation: monotonicity (spec §5 l.205, §10 l.410)', () => {
  it('property: a longer holding duration never decreases a wallet\'s units, others fixed', () => {
    fc.assert(
      fc.property(snapshotArb(1, 8), totalArb, fc.nat(), fc.integer({ min: 0, max: COLLAPSE - BORN }), (snap, total, pick, delta) => {
        const i = pick % snap.length;
        const h = snap[i]!;
        const earlier = Math.max(BORN, h.firstAcquiredAt - delta);
        const longer: HolderSnapshot = { ...h, firstAcquiredAt: earlier };
        const s2 = snap.map((x, j) => (j === i ? longer : x));
        expect(unitsOf(s2, total, h.wallet) >= unitsOf(snap, total, h.wallet)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('property: holding through more survived measurements never decreases units; non-survived ids count for nothing', () => {
    fc.assert(
      fc.property(snapshotArb(1, 8), totalArb, fc.nat(), fc.subarray(SURVIVED), (snap, total, pick, extra) => {
        const i = pick % snap.length;
        const h = snap[i]!;
        const more: HolderSnapshot = { ...h, heldThroughMeasurementIds: [...new Set([...h.heldThroughMeasurementIds, ...extra])] };
        const s2 = snap.map((x, j) => (j === i ? more : x));
        expect(unitsOf(s2, total, h.wallet) >= unitsOf(snap, total, h.wallet)).toBe(true);
        // ids of tunnel/collapse measurements, unknown ids and duplicates change nothing
        const junk: HolderSnapshot = { ...h, heldThroughMeasurementIds: [...h.heldThroughMeasurementIds, 'm3', 'm5', 'nope', ...h.heldThroughMeasurementIds] };
        const s3 = snap.map((x, j) => (j === i ? junk : x));
        expect(unitsOf(s3, total, h.wallet)).toBe(unitsOf(snap, total, h.wallet));
      }),
      { numRuns: 400 },
    );
  });

  it('property: holding through the quiet period never decreases units', () => {
    fc.assert(
      fc.property(snapshotArb(1, 8), totalArb, fc.nat(), (snap, total, pick) => {
        const i = pick % snap.length;
        const h = snap[i]!;
        fc.pre(h.firstAcquiredAt <= QUIET);
        const no = snap.map((x, j) => (j === i ? { ...h, heldThroughQuietPeriod: false } : x));
        const yes = snap.map((x, j) => (j === i ? { ...h, heldThroughQuietPeriod: true } : x));
        expect(unitsOf(yes, total, h.wallet) >= unitsOf(no, total, h.wallet)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('weight formula reproduced independently (bps, floors)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: COLLAPSE }), fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 }), fc.boolean(), (first, held, survived, q) => {
        const lifetime = COLLAPSE - BORN;
        const fD = Math.min(10_000, Math.floor((Math.max(0, COLLAPSE - first) * 10_000) / lifetime));
        const fM = Math.min(10_000, Math.floor((held * 10_000) / Math.max(1, survived)));
        const fQ = q ? 10_000 : 0;
        const inner = Math.floor((5000 * fD + 3000 * fM + 2000 * fQ) / 10_000);
        const expected = 10_000 + Math.floor((inner * 5000) / 10_000);
        expect(entanglementWeightBps({ firstAcquiredAt: first, heldThroughCount: held, heldThroughQuietPeriod: q }, { bornAt: BORN, collapseAt: COLLAPSE, survivedCount: survived })).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });
});

describe('allocation: adversarial inputs', () => {
  const W = (n: number) => `W${String(n).padStart(43, '0')}`;
  const h = (n: number, o: Partial<HolderSnapshot> = {}): HolderSnapshot => ({
    wallet: W(n),
    balance: 100n,
    firstAcquiredAt: BORN,
    heldThroughMeasurementIds: [],
    heldThroughQuietPeriod: false,
    ...o,
  });

  it('zero-balance wallets are kept in the table with 0 units and a leaf; an all-zero snapshot is refused', () => {
    const t = computeAllocation(input([h(1), h(2, { balance: 0n })], 1000n));
    expect(t.entries.find((e) => e.wallet === W(2))!.units).toBe(0n);
    expect(t.entries.find((e) => e.wallet === W(1))!.units).toBe(1000n);
    expect(() => computeAllocation(input([h(1, { balance: 0n })], 1000n))).toThrow(/no units/);
  });

  it('duplicate wallets, negative balances, non-bigint balances are refused', () => {
    expect(() => computeAllocation(input([h(1), h(1)], 10n))).toThrow(/duplicate/);
    expect(() => computeAllocation(input([h(1, { balance: -1n })], 10n))).toThrow();
    expect(() => computeAllocation(input([h(1, { balance: 5 as unknown as bigint })], 10n))).toThrow();
  });

  it('heldThroughQuietPeriod with firstAcquiredAt after quietPeriodStart is refused', () => {
    expect(() => computeAllocation(input([h(1, { firstAcquiredAt: QUIET + 1, heldThroughQuietPeriod: true })], 10n))).toThrow(/quiet period/);
    expect(() => computeAllocation(input([h(1, { firstAcquiredAt: QUIET, heldThroughQuietPeriod: true })], 10n))).not.toThrow();
  });

  it('INFO H-E3: firstAcquiredAt after collapseAt (impossible for a holder at the collapse block) is accepted with fD = 0 rather than refused; before bornAt is accepted with fD = 1', () => {
    const late = computeAllocation(input([h(1, { firstAcquiredAt: COLLAPSE + 999 }), h(2)], 1000n));
    expect(late.entries.find((e) => e.wallet === W(1))!.weightBps).toBe(10_000);
    const early = computeAllocation(input([h(1, { firstAcquiredAt: 0 }), h(2)], 1000n));
    expect(early.entries.find((e) => e.wallet === W(1))!.weightBps).toBe(10_000 + 2500);
  });

  it('bad times are refused: collapseAt ≤ bornAt, quietPeriodStart > collapseAt, non-integers, negative total', () => {
    expect(() => computeAllocation({ ...input([h(1)], 10n), collapseAt: BORN })).toThrow();
    expect(() => computeAllocation({ ...input([h(1)], 10n), quietPeriodStart: COLLAPSE + 1 })).toThrow();
    expect(() => computeAllocation({ ...input([h(1)], 10n), collapseAt: COLLAPSE + 0.5 })).toThrow();
    expect(() => computeAllocation(input([h(1)], -1n))).toThrow();
  });

  it('huge bigint balances and pools stay exact', () => {
    const big = 10n ** 60n;
    const t = computeAllocation(input([h(1, { balance: big }), h(2, { balance: big + 1n }), h(3, { balance: 1n })], 10n ** 40n));
    expect(t.allocatedUnits + t.dustUnits).toBe(10n ** 40n);
    expect(t.entries.every((e) => e.units >= 0n)).toBe(true);
    expect(t.entries.find((e) => e.wallet === W(3))!.units).toBe(0n);
  });

  it('a single holder gets the whole pool, dust 0, leafCount 2 (padded with the documented empty leaf)', () => {
    const t = computeAllocation(input([h(1, { balance: 7n })], 123_456_789n));
    expect(t.entries[0]!.units).toBe(123_456_789n);
    expect(t.dustUnits).toBe(0n);
    expect(t.leafCount).toBe(2);
    expect(t.merkleRoot).toBe(ownRoot([leafHex(W(1), 123_456_789n), EMPTY_LEAF_HEX], ALLOCATION_TREE_SEED_HEX));
  });

  it('10 000 holders: exact sum, dust < 10 000, leafCount 16384, under 10 s', () => {
    const snap: HolderSnapshot[] = [];
    for (let i = 0; i < 10_000; i++) snap.push(h(i, { balance: BigInt(1 + ((i * 7919) % 1000)), firstAcquiredAt: BORN + ((i * 13) % (COLLAPSE - BORN)) }));
    const t0 = Date.now();
    const t = computeAllocation(input(snap, 10n ** 18n));
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(t.allocatedUnits + t.dustUnits).toBe(10n ** 18n);
    expect(t.dustUnits < 10_000n).toBe(true);
    expect(t.leafCount).toBe(16_384);
    expect(t.merkleRoot).toBe(ownRoot(padPow2(t.entries.map((e) => leafHex(e.wallet, e.units)), EMPTY_LEAF_HEX), ALLOCATION_TREE_SEED_HEX));
  });
});

describe('allocation: Merkle commitment verified independently (spec §5 l.214-216)', () => {
  it('documented constants', () => {
    expect(EMPTY_LEAF_HEX).toBe(hex(sha256(utf8('qsd/allocation/empty-leaf/v1'))));
    expect(ALLOCATION_TREE_SEED_HEX).toBe(hex(sha256(utf8('qsd/allocation/tree-seed/v1'))));
  });

  it('property: table.merkleRoot == Agent H root over sha256(canonical({wallet, units})) leaves sorted by wallet, padded, RAND_HASH-fused', () => {
    fc.assert(
      fc.property(snapshotArb(1, 20), totalArb, (snap, total) => {
        const t = computeAllocation(input(snap, total));
        const leaves = t.entries.map((e) => {
          expect(e.leaf).toBe(leafHex(e.wallet, e.units));
          return e.leaf;
        });
        const padded = padPow2(leaves, EMPTY_LEAF_HEX);
        expect(padded.length).toBe(t.leafCount);
        expect(ownRoot(padded, ALLOCATION_TREE_SEED_HEX)).toBe(t.merkleRoot);
      }),
      { numRuns: 200 },
    );
  });

  it('property: every proof verifies; a modified units value, wallet, index or path is rejected; never throws', () => {
    fc.assert(
      fc.property(snapshotArb(1, 12), totalArb, fc.nat(), fc.bigUintN(20), (snap, total, pick, delta) => {
        const t = computeAllocation(input(snap, total));
        const e = t.entries[pick % t.entries.length]!;
        const proof = allocationProof(t, e.wallet);
        expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units }, proof)).toBe(true);
        expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units + 1n + delta }, proof)).toBe(false);
        if (e.units > 0n) expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units - 1n }, proof)).toBe(false);
        expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet + 'x', units: e.units }, proof)).toBe(false);
        expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units }, { ...proof, index: proof.index ^ 1 })).toBe(false);
        if (proof.path.length > 1) {
          expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units }, { ...proof, path: [...proof.path].reverse() })).toBe(false);
        }
        expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units }, { ...proof, path: proof.path.slice(1) })).toBe(false);
        expect(verifyAllocationProof('zz', { wallet: e.wallet, units: e.units }, proof)).toBe(false);
        expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units }, { index: -1, path: proof.path })).toBe(false);
        expect(verifyAllocationProof(t.merkleRoot, { wallet: e.wallet, units: e.units }, { index: 1e9, path: proof.path })).toBe(false);
        // proof for one wallet does not verify another wallet's row
        const other = t.entries.find((x) => x.wallet !== e.wallet);
        if (other) expect(verifyAllocationProof(t.merkleRoot, { wallet: other.wallet, units: other.units }, proof)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('a proof cannot be produced for a table whose root was edited; the empty leaf has no claimable preimage', () => {
    const W = (n: number) => `W${String(n).padStart(43, '0')}`;
    const t = computeAllocation(input([{ wallet: W(1), balance: 5n, firstAcquiredAt: BORN, heldThroughMeasurementIds: [], heldThroughQuietPeriod: false }], 10n));
    expect(() => allocationProof({ ...t, merkleRoot: 'ab'.repeat(32) }, W(1))).toThrow();
    expect(() => allocationProof(t, W(2))).toThrow();
    // index 1 is the padding leaf: no (wallet, units) row hashes to it
    const proof = allocationProof(t, W(1));
    const sibling = { index: 1, path: [t.entries[0]!.leaf] };
    expect(verifyAllocationProof(t.merkleRoot, { wallet: '', units: 0n }, sibling)).toBe(false);
    expect(proof.path[0]).toBe(EMPTY_LEAF_HEX);
  });
});
