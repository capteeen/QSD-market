/**
 * XMSS (RFC 8391 section 4) over SHA-256 with n = 32, w = 16, parameterised by
 * tree height so the published XMSS-SHA2_10_256 / height-4 vectors can be
 * reproduced; QSD identities use height 8.
 *
 * Signature layout (section 4.1.8): toByte(idx, 4) || r (n) || sig_ots (len·n) || auth (h·n).
 */
import { concat, equalBytes, toByte } from "./bytes.js";
import { CryptoInputError } from "./errors.js";
import type { CryptoObserver } from "./events.js";
import { hMsg, prf } from "./hash.js";
import { authPath, buildHashTree, ltree, rootFromAuthPath, type HashTree } from "./merkle.js";
import { CHAIN_LINKS, INDEX_BYTES, LEN, N, WOTS_SIG_BYTES, signatureBytesForHeight } from "./params.js";
import {
  wotsExpandSecretKey,
  wotsPublicKey,
  wotsPublicKeyFromSignature,
  wotsSecretSeed,
  wotsSign,
} from "./wots.js";

export interface XmssSecretMaterial {
  skSeed: Uint8Array;
  skPrf: Uint8Array;
  pubSeed: Uint8Array;
}

export interface XmssKeyPair {
  height: number;
  root: Uint8Array;
  pubSeed: Uint8Array;
  tree: HashTree;
}

export interface XmssSignature {
  index: number;
  r: Uint8Array;
  wots: Uint8Array[];
  auth: Uint8Array[];
}

function checkSeed(name: string, b: Uint8Array): void {
  if (!(b instanceof Uint8Array) || b.length !== N) throw new CryptoInputError(`${name} must be ${N} bytes`);
}

/** Compute the WOTS+ public key of one leaf and compress it into the leaf node. Emits chain/leaf events. */
export function xmssLeaf(m: XmssSecretMaterial, leaf: number, observer?: CryptoObserver): Uint8Array {
  const sk = wotsExpandSecretKey(wotsSecretSeed(m.skSeed, leaf));
  const pk = wotsPublicKey(sk, m.pubSeed, leaf, observer);
  const node = ltree(pk, m.pubSeed, leaf);
  observer?.emit({ type: "leafFormed", leaf, hash: node });
  return node;
}

/** XMSS_keyGen (Algorithm 10) with all 2^h leaves computed and the full tree retained. */
export function xmssKeyGen(m: XmssSecretMaterial, height: number, observer?: CryptoObserver): XmssKeyPair {
  checkSeed("skSeed", m.skSeed);
  checkSeed("skPrf", m.skPrf);
  checkSeed("pubSeed", m.pubSeed);
  if (!Number.isInteger(height) || height < 1 || height > 20) throw new CryptoInputError("height must be 1..20");
  const leaves = 1 << height;
  observer?.emit({ type: "keygenStart", leaves, chains: LEN, links: CHAIN_LINKS });
  const leafNodes: Uint8Array[] = new Array(leaves);
  for (let i = 0; i < leaves; i++) leafNodes[i] = xmssLeaf(m, i, observer);
  const tree = buildHashTree(leafNodes, m.pubSeed, observer);
  return { height, root: tree.root, pubSeed: m.pubSeed, tree };
}

/** Randomized message digest: r = PRF(SK_PRF, toByte(idx, 32)); H_msg(r || root || toByte(idx, n), M). */
export function messageDigest(r: Uint8Array, root: Uint8Array, index: number, message: Uint8Array): Uint8Array {
  return hMsg(concat(r, root, toByte(index, N)), message);
}

/** XMSS_sign (Algorithm 12) for a given leaf index. Does NOT track index usage; see identity.ts. */
export function xmssSign(
  m: XmssSecretMaterial,
  kp: XmssKeyPair,
  index: number,
  message: Uint8Array,
  observer?: CryptoObserver,
): XmssSignature {
  if (!Number.isInteger(index) || index < 0 || index >= 1 << kp.height) {
    throw new CryptoInputError(`index ${index} out of range for height ${kp.height}`);
  }
  if (!(message instanceof Uint8Array)) throw new CryptoInputError("message must be a Uint8Array");
  const r = prf(m.skPrf, toByte(index, 32));
  const digest = messageDigest(r, kp.root, index, message);
  observer?.emit({ type: "signStart", index, r, digest });
  const sk = wotsExpandSecretKey(wotsSecretSeed(m.skSeed, index));
  const wots = wotsSign(sk, digest, m.pubSeed, index, observer);
  const auth = authPath(kp.tree, index, observer);
  return { index, r, wots, auth };
}

export function encodeSignature(sig: XmssSignature): Uint8Array {
  return concat(toByte(sig.index, INDEX_BYTES), sig.r, ...sig.wots, ...sig.auth);
}

export function decodeSignature(bytes: Uint8Array, height: number): XmssSignature {
  const expected = signatureBytesForHeight(height);
  if (!(bytes instanceof Uint8Array) || bytes.length !== expected) {
    throw new CryptoInputError(`signature must be exactly ${expected} bytes, got ${bytes?.length}`);
  }
  let off = 0;
  const index = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  off += INDEX_BYTES;
  const r = bytes.slice(off, off + N);
  off += N;
  const wots: Uint8Array[] = new Array(LEN);
  for (let i = 0; i < LEN; i++) {
    wots[i] = bytes.slice(off, off + N);
    off += N;
  }
  const auth: Uint8Array[] = new Array(height);
  for (let i = 0; i < height; i++) {
    auth[i] = bytes.slice(off, off + N);
    off += N;
  }
  if (off !== expected || off !== INDEX_BYTES + N + WOTS_SIG_BYTES + height * N) {
    throw new CryptoInputError("signature decode length mismatch");
  }
  return { index, r, wots, auth };
}

/** XMSS_rootFromSig (Algorithm 13): recompute the root a signature claims. */
export function xmssRootFromSig(
  sig: XmssSignature,
  root: Uint8Array,
  pubSeed: Uint8Array,
  message: Uint8Array,
  observer?: CryptoObserver,
): Uint8Array {
  const digest = messageDigest(sig.r, root, sig.index, message);
  observer?.emit({ type: "verifyStart", index: sig.index, digest });
  const pk = wotsPublicKeyFromSignature(sig.wots, digest, pubSeed, sig.index, observer);
  const leaf = ltree(pk, pubSeed, sig.index);
  observer?.emit({ type: "verifyLeafFormed", index: sig.index, hash: leaf });
  return rootFromAuthPath(leaf, sig.index, sig.auth, pubSeed, observer);
}

/** XMSS_verify (Algorithm 14). Needs only public values. */
export function xmssVerify(
  root: Uint8Array,
  pubSeed: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
  height: number,
  observer?: CryptoObserver,
): boolean {
  checkSeed("root", root);
  checkSeed("pubSeed", pubSeed);
  if (!(message instanceof Uint8Array)) throw new CryptoInputError("message must be a Uint8Array");
  let sig: XmssSignature;
  try {
    sig = decodeSignature(signature, height);
  } catch {
    return false;
  }
  if (sig.index >= 1 << height) return false;
  const computedRoot = xmssRootFromSig(sig, root, pubSeed, message, observer);
  const valid = equalBytes(computedRoot, root);
  observer?.emit({ type: "verifyResult", computedRoot, expectedRoot: root, valid });
  return valid;
}
