/**
 * L-tree (RFC 8391 Algorithm 8) and the XMSS binary hash tree (Algorithm 9),
 * both built on RAND_HASH. The full tree is kept in memory so that
 * authentication paths are read directly instead of recomputed.
 */
import { Address, ADRS_TYPE_HASHTREE, ADRS_TYPE_LTREE } from "./address.js";
import type { CryptoObserver } from "./events.js";
import { randHash } from "./hash.js";
import { LEN } from "./params.js";

/** ltree(pk, SEED, ADRS): compress the 67 WOTS+ public key elements into one n-byte leaf. */
export function ltree(pk: Uint8Array[], seed: Uint8Array, leaf: number): Uint8Array {
  if (pk.length !== LEN) throw new Error("ltree: expected len public key elements");
  const nodes = pk.slice();
  const adrs = new Address().setType(ADRS_TYPE_LTREE).setLTree(leaf);
  let len = LEN;
  let height = 0;
  adrs.setTreeHeight(0);
  while (len > 1) {
    for (let i = 0; i < Math.floor(len / 2); i++) {
      adrs.setTreeIndex(i);
      nodes[i] = randHash(nodes[2 * i]!, nodes[2 * i + 1]!, seed, adrs);
    }
    if (len % 2 === 1) nodes[Math.floor(len / 2)] = nodes[len - 1]!;
    len = Math.ceil(len / 2);
    height++;
    adrs.setTreeHeight(height);
  }
  return nodes[0]!;
}

/** All nodes of a full binary hash tree: levels[0] = leaves … levels[h] = [root]. */
export interface HashTree {
  height: number;
  levels: Uint8Array[][];
  root: Uint8Array;
}

/** Hash address for fusing children at `level` into parent `index` of level + 1. */
export function hashTreeAddress(level: number, index: number): Address {
  return new Address().setType(ADRS_TYPE_HASHTREE).setTreeHeight(level).setTreeIndex(index);
}

/**
 * Build the complete tree bottom-up. Node (level+1, i) = RAND_HASH(node(level, 2i),
 * node(level, 2i+1), SEED, ADRS{treeHeight = level, treeIndex = i}) — the same
 * addressing Algorithm 9 produces with its stack. Emits treeLevelFused and rootReady.
 */
export function buildHashTree(leaves: Uint8Array[], seed: Uint8Array, observer?: CryptoObserver): HashTree {
  const height = Math.log2(leaves.length);
  if (!Number.isInteger(height)) throw new Error("buildHashTree: leaf count must be a power of two");
  const levels: Uint8Array[][] = [leaves.slice()];
  for (let level = 0; level < height; level++) {
    const below = levels[level]!;
    const above: Uint8Array[] = new Array(below.length / 2);
    for (let i = 0; i < above.length; i++) {
      const adrs = hashTreeAddress(level, i);
      const left = below[2 * i]!;
      const right = below[2 * i + 1]!;
      const parent = randHash(left, right, seed, adrs);
      above[i] = parent;
      observer?.emit({ type: "treeLevelFused", level, index: i, left, right, parent });
    }
    levels.push(above);
  }
  const root = levels[height]![0]!;
  observer?.emit({ type: "rootReady", root });
  return { height, levels, root };
}

/** Authentication path for leaf `index`: the sibling at every level 0..h-1. */
export function authPath(tree: HashTree, index: number, observer?: CryptoObserver): Uint8Array[] {
  const path: Uint8Array[] = new Array(tree.height);
  for (let level = 0; level < tree.height; level++) {
    const sibling = (index >>> level) ^ 1;
    const node = tree.levels[level]![sibling]!;
    path[level] = node;
    observer?.emit({ type: "authPathNode", level, hash: node });
  }
  return path;
}

/**
 * Recompute the root from a leaf and its authentication path (the loop in
 * RFC 8391 Algorithm 13, XMSS_rootFromSig).
 */
export function rootFromAuthPath(
  leaf: Uint8Array,
  index: number,
  path: Uint8Array[],
  seed: Uint8Array,
  observer?: CryptoObserver,
): Uint8Array {
  let node = leaf;
  let idx = index;
  for (let level = 0; level < path.length; level++) {
    const sibling = path[level]!;
    const parentIndex = idx >>> 1;
    const adrs = hashTreeAddress(level, parentIndex);
    const left = (idx & 1) === 0 ? node : sibling;
    const right = (idx & 1) === 0 ? sibling : node;
    const parent = randHash(left, right, seed, adrs);
    observer?.emit({ type: "verifyLevelFused", level, left, right, parent });
    node = parent;
    idx = parentIndex;
  }
  return node;
}
