/**
 * Allocation: how the daughter pool is split between the mother's holders.
 *
 *   score_i  = balance_i × weight_i                        (weight in bps, 10 000..15 000)
 *   units_i  = floor(totalDaughterUnits × score_i / Σ score)
 *   dust     = totalDaughterUnits − Σ units_i   (< number of wallets; burned)
 *
 * Entanglement weight:
 *   fD = min(1, (collapseAt − firstAcquiredAt) / (collapseAt − bornAt))    duration, continuous
 *   fM = min(1, heldThroughSurvivedMeasurements / max(1, survivedMeasurements))
 *   fQ = heldThroughQuietPeriod ? 1 : 0
 *   weight = 1 + 0.5 × (wD·fD + wM·fM + wQ·fQ)            wD + wM + wQ = 1
 *
 * Everything is integer (bps / bigint). Rounding is floor only, with the dust
 * burned, so splitting a bag across wallets can never increase the total
 * received (floor(a) + floor(b) ≤ floor(a + b)); a largest-remainder rule
 * would leak up to one base unit to the splitter and is deliberately not
 * used. Sum of units + dust equals totalDaughterUnits exactly.
 *
 * Merkle commitment: leaf = sha256(canonical({ wallet, units: units.toString() })),
 * leaves sorted by wallet ascending (UTF-16 code unit order), padded to the
 * next power of two (at least 2) with EMPTY_LEAF = sha256("qsd/allocation/empty-leaf/v1"),
 * fused with @qsd/crypto's buildHashTree (RAND_HASH, public seed
 * ALLOCATION_TREE_SEED = sha256("qsd/allocation/tree-seed/v1")).
 */
import { authPath, buildHashTree, equalBytes, fromHex, rootFromAuthPath, sha256, toHex, type HashTree } from '@qsd/crypto';
import { canonicalJson } from '@qsd/quantum';
import { ProtocolError } from './errors.js';
import { BPS, PPB_BIG, PROTOCOL_PARAMS } from './params.js';
import type { AllocationEntry, AllocationInput, AllocationProof, AllocationTable, Hex, HolderSnapshot } from './types.js';

const P = PROTOCOL_PARAMS;
const utf8 = (s: string) => new TextEncoder().encode(s);

export const ALLOCATION_VERSION = 'qsd-allocation/v1' as const;
export const ALLOCATION_TREE_SEED: Uint8Array = sha256(utf8('qsd/allocation/tree-seed/v1'));
export const EMPTY_LEAF: Uint8Array = sha256(utf8('qsd/allocation/empty-leaf/v1'));
export const EMPTY_LEAF_HEX: Hex = toHex(EMPTY_LEAF);
export const ALLOCATION_TREE_SEED_HEX: Hex = toHex(ALLOCATION_TREE_SEED);

export interface WeightInputs {
  firstAcquiredAt: number;
  heldThroughCount: number;
  heldThroughQuietPeriod: boolean;
}

export interface WeightContext {
  bornAt: number;
  collapseAt: number;
  /** Number of survived measurements in the mother's history. */
  survivedCount: number;
}

function clampBps(v: number): number {
  return v < 0 ? 0 : v > BPS ? BPS : v;
}

/** fD in bps: fraction of the mother's lifetime the wallet held, floor, capped at 10 000. */
export function durationScoreBps(firstAcquiredAt: number, ctx: Pick<WeightContext, 'bornAt' | 'collapseAt'>): number {
  const lifetime = ctx.collapseAt - ctx.bornAt;
  if (lifetime <= 0) throw new ProtocolError('collapseAt must be after bornAt');
  const held = Math.max(0, ctx.collapseAt - firstAcquiredAt);
  return clampBps(Math.floor((held * BPS) / lifetime));
}

/** fM in bps: heldThrough / max(1, survived), floor, capped. */
export function measurementScoreBps(heldThroughCount: number, survivedCount: number): number {
  return clampBps(Math.floor((heldThroughCount * BPS) / Math.max(1, survivedCount)));
}

/** Entanglement weight in bps: 10 000 + (wD·fD + wM·fM + wQ·fQ) / 2, floor. In [10 000, 15 000]. */
export function entanglementWeightBps(w: WeightInputs, ctx: WeightContext): number {
  const fD = durationScoreBps(w.firstAcquiredAt, ctx);
  const fM = measurementScoreBps(w.heldThroughCount, ctx.survivedCount);
  const fQ = w.heldThroughQuietPeriod ? BPS : 0;
  const inner = Math.floor((P.ALLOC_W_DURATION_BPS * fD + P.ALLOC_W_MEASUREMENTS_BPS * fM + P.ALLOC_W_QUIET_BPS * fQ) / BPS);
  const bonus = Math.floor((inner * (P.ENTANGLEMENT_WEIGHT_MAX_BPS - BPS)) / BPS);
  return BPS + bonus;
}

export function compareWallets(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** sha256(canonical({ wallet, units })) with units as a decimal string. */
export function allocationLeaf(entry: { wallet: string; units: bigint }): Uint8Array {
  return sha256(utf8(canonicalJson({ wallet: entry.wallet, units: entry.units.toString() })));
}

function nextPowerOfTwo(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/** Padded leaf list for a wallet-sorted table. */
export function paddedLeaves(entries: readonly { wallet: string; units: bigint }[]): Uint8Array[] {
  const leaves = entries.map(allocationLeaf);
  const n = nextPowerOfTwo(leaves.length);
  while (leaves.length < n) leaves.push(EMPTY_LEAF);
  return leaves;
}

export function allocationTree(entries: readonly { wallet: string; units: bigint }[]): HashTree {
  return buildHashTree(paddedLeaves(entries), ALLOCATION_TREE_SEED);
}

function validateSnapshot(snapshot: readonly HolderSnapshot[], input: AllocationInput): void {
  if (!Array.isArray(snapshot) || snapshot.length === 0) throw new ProtocolError('snapshot must be a non-empty array');
  const seen = new Set<string>();
  for (const h of snapshot) {
    if (typeof h.wallet !== 'string' || h.wallet.length === 0) throw new ProtocolError('wallet must be a non-empty string');
    if (seen.has(h.wallet)) throw new ProtocolError(`duplicate wallet in snapshot: ${h.wallet}`);
    seen.add(h.wallet);
    if (typeof h.balance !== 'bigint' || h.balance < 0n) throw new ProtocolError(`balance of ${h.wallet} must be a non-negative bigint`);
    if (!Number.isInteger(h.firstAcquiredAt) || h.firstAcquiredAt < 0) throw new ProtocolError(`firstAcquiredAt of ${h.wallet} must be a non-negative integer`);
    if (h.heldThroughQuietPeriod && h.firstAcquiredAt > input.quietPeriodStart) {
      throw new ProtocolError(`${h.wallet} cannot have held through the quiet period: acquired after it started`);
    }
    if (!Array.isArray(h.heldThroughMeasurementIds)) throw new ProtocolError(`heldThroughMeasurementIds of ${h.wallet} must be an array`);
  }
}

/** Build the allocation table. Deterministic; the input is not mutated. */
export function computeAllocation(input: AllocationInput): AllocationTable {
  const { snapshot, totalDaughterUnits, bornAt, collapseAt, quietPeriodStart } = input;
  if (typeof totalDaughterUnits !== 'bigint' || totalDaughterUnits < 0n) throw new ProtocolError('totalDaughterUnits must be a non-negative bigint');
  if (!Number.isInteger(bornAt) || !Number.isInteger(collapseAt) || !Number.isInteger(quietPeriodStart)) throw new ProtocolError('times must be integers');
  if (collapseAt <= bornAt) throw new ProtocolError('collapseAt must be after bornAt');
  if (quietPeriodStart > collapseAt) throw new ProtocolError('quietPeriodStart must not be after collapseAt');
  validateSnapshot(snapshot, input);

  const survived = new Set(input.measurements.filter((m) => m.outcome.kind === 'survive').map((m) => m.id));
  const ctx: WeightContext = { bornAt, collapseAt, survivedCount: survived.size };

  const sorted = [...snapshot].sort((a, b) => compareWallets(a.wallet, b.wallet));
  const totalBag = sorted.reduce((s, h) => s + h.balance, 0n);
  if (totalBag <= 0n) throw new ProtocolError('snapshot holds no units; nothing to allocate');

  const weights = sorted.map((h) =>
    entanglementWeightBps(
      {
        firstAcquiredAt: h.firstAcquiredAt,
        heldThroughCount: new Set(h.heldThroughMeasurementIds.filter((id) => survived.has(id))).size,
        heldThroughQuietPeriod: h.heldThroughQuietPeriod,
      },
      ctx,
    ),
  );
  const scores = sorted.map((h, i) => h.balance * BigInt(weights[i]!));
  const totalScore = scores.reduce((s, x) => s + x, 0n);

  let allocated = 0n;
  const entries: AllocationEntry[] = sorted.map((h, i) => {
    const units = (totalDaughterUnits * scores[i]!) / totalScore;
    allocated += units;
    return {
      wallet: h.wallet,
      bagUnits: h.balance,
      bagFractionPpb: Number((h.balance * PPB_BIG) / totalBag),
      weightBps: weights[i]!,
      sharePpb: totalDaughterUnits === 0n ? 0 : Number((units * PPB_BIG) / totalDaughterUnits),
      units,
      leaf: toHex(allocationLeaf({ wallet: h.wallet, units })),
    };
  });

  const tree = allocationTree(entries);
  return {
    version: ALLOCATION_VERSION,
    entries,
    totalUnits: totalDaughterUnits,
    allocatedUnits: allocated,
    dustUnits: totalDaughterUnits - allocated,
    merkleRoot: toHex(tree.root),
    leafCount: tree.levels[0]!.length,
  };
}

/** Merkle proof for `wallet`. Throws if the wallet is not in the table. */
export function allocationProof(table: AllocationTable, wallet: string): AllocationProof {
  const index = table.entries.findIndex((e) => e.wallet === wallet);
  if (index < 0) throw new ProtocolError(`wallet ${wallet} is not in the allocation table`);
  const tree = allocationTree(table.entries);
  if (toHex(tree.root) !== table.merkleRoot) throw new ProtocolError('table merkleRoot does not match its entries');
  return { index, path: authPath(tree, index).map(toHex) };
}

/** Recompute the root from (entry, proof) and compare with `rootHex`. Never throws. */
export function verifyAllocationProof(rootHex: Hex, entry: { wallet: string; units: bigint }, proof: AllocationProof): boolean {
  try {
    if (!Number.isInteger(proof.index) || proof.index < 0 || proof.index >= 2 ** proof.path.length) return false;
    const leaf = allocationLeaf(entry);
    const path = proof.path.map(fromHex);
    if (path.some((p) => p.length !== 32)) return false;
    const root = rootFromAuthPath(leaf, proof.index, path, ALLOCATION_TREE_SEED);
    return equalBytes(root, fromHex(rootHex));
  } catch {
    return false;
  }
}

/** Recompute a table's root from its entries (e.g. after deserialising). */
export function allocationRoot(entries: readonly { wallet: string; units: bigint }[]): Hex {
  for (let i = 1; i < entries.length; i++) {
    if (compareWallets(entries[i - 1]!.wallet, entries[i]!.wallet) >= 0) throw new ProtocolError('entries must be sorted by wallet ascending with no duplicates');
  }
  return toHex(allocationTree(entries).root);
}

/** Convert a weight in bps to the 1.0..1.5 decimal for display. */
export function weightToNumber(weightBps: number): number {
  return weightBps / BPS;
}
