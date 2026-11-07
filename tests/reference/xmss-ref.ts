/**
 * Agent H independent reference implementation of XMSS / WOTS+ (RFC 8391),
 * SHA-256, n = 32, w = 16, written from the RFC text without looking at
 * @qsd/crypto's source for the algorithms. It deliberately:
 *
 *  - uses node:crypto for SHA-256 (not @noble/hashes, which @qsd/crypto uses);
 *  - implements chain() recursively exactly as Algorithm 2 is written;
 *  - builds the tree with the literal stack algorithm of Algorithm 9 (treeHash)
 *    rather than level-by-level, so the ADRS tree-index handling is checked
 *    against an independent transcription;
 *  - implements XMSS_rootFromSig (Algorithm 13) with the RFC's even/odd
 *    tree-index arithmetic.
 *
 * Secret-key derivation follows Bouncy Castle / the RFC-era xmss-reference
 * (the published KAT needs it): S_ots = PRF(SK_SEED, ADRS{type=OTS, ots=i})
 * and sk[j] = PRF(S_ots, toByte(j, 32)). This only matters for reproducing
 * the KAT signatures; verification is derivation-independent.
 *
 * Everything is slow by design (clarity over speed).
 */
import { createHash } from 'node:crypto';

export const n = 32;
export const w = 16;
export const log2w = 4;
export const len1 = Math.ceil((8 * n) / log2w); // 64
export const len2 = Math.floor(Math.log2(len1 * (w - 1)) / log2w) + 1; // 3
export const len = len1 + len2; // 67

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

/** RFC 8391 §2.4 toByte(x, y): y-byte big-endian encoding of x. */
export function toByte(x: number | bigint, y: number): Uint8Array {
  let v = BigInt(x);
  if (v < 0n) throw new Error('toByte: negative');
  const out = new Uint8Array(y);
  for (let i = y - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error('toByte: overflow');
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error('xor: length mismatch');
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

export function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}
export function unhex(s: string): Uint8Array {
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error('bad hex');
  return new Uint8Array(Buffer.from(s, 'hex'));
}

// §5.1 keyed hash functions for SHA2 with n = 32.
export const F = (key: Uint8Array, m: Uint8Array): Uint8Array => sha256(toByte(0, 32), key, m);
export const H = (key: Uint8Array, m: Uint8Array): Uint8Array => sha256(toByte(1, 32), key, m);
export const H_msg = (key: Uint8Array, m: Uint8Array): Uint8Array => sha256(toByte(2, 32), key, m);
export const PRF = (key: Uint8Array, m: Uint8Array): Uint8Array => sha256(toByte(3, 32), key, m);

/**
 * §2.5 ADRS: 8 big-endian 32-bit words.
 * [0] layer, [1..2] tree (64-bit), [3] type, [4] OTS / L-tree address / padding,
 * [5] chain address / tree height, [6] hash address / tree index, [7] keyAndMask.
 */
export class ADRS {
  words: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  setLayerAddress(v: number) { this.words[0] = v >>> 0; }
  setTreeAddress(v: bigint) { this.words[1] = Number((v >> 32n) & 0xffffffffn); this.words[2] = Number(v & 0xffffffffn); }
  /** §2.5: setting the type zeroes the three following words. */
  setType(v: number) { this.words[3] = v >>> 0; this.words[4] = 0; this.words[5] = 0; this.words[6] = 0; this.words[7] = 0; }
  setOTSAddress(v: number) { this.words[4] = v >>> 0; }
  setLtreeAddress(v: number) { this.words[4] = v >>> 0; }
  setChainAddress(v: number) { this.words[5] = v >>> 0; }
  setTreeHeight(v: number) { this.words[5] = v >>> 0; }
  getTreeHeight(): number { return this.words[5]!; }
  setHashAddress(v: number) { this.words[6] = v >>> 0; }
  setTreeIndex(v: number) { this.words[6] = v >>> 0; }
  getTreeIndex(): number { return this.words[6]!; }
  setKeyAndMask(v: number) { this.words[7] = v >>> 0; }
  toBytes(): Uint8Array {
    const out = new Uint8Array(32);
    this.words.forEach((wd, i) => {
      out[4 * i] = (wd >>> 24) & 0xff;
      out[4 * i + 1] = (wd >>> 16) & 0xff;
      out[4 * i + 2] = (wd >>> 8) & 0xff;
      out[4 * i + 3] = wd & 0xff;
    });
    return out;
  }
}

/** Algorithm 1: base_w. */
export function base_w(X: Uint8Array, out_len: number): number[] {
  let inIdx = 0;
  let total = 0;
  let bits = 0;
  const basew: number[] = [];
  for (let consumed = 0; consumed < out_len; consumed++) {
    if (bits === 0) {
      total = X[inIdx]!;
      inIdx++;
      bits += 8;
    }
    bits -= log2w;
    basew.push((total >> bits) & (w - 1));
  }
  return basew;
}

/** Algorithm 2: chain(X, i, s, SEED, ADRS), written recursively as in the RFC. */
export function chain(X: Uint8Array, i: number, s: number, SEED: Uint8Array, adrs: ADRS): Uint8Array {
  if (s === 0) return X;
  if (i + s > w - 1) throw new Error('chain: i + s > w - 1');
  const tmp = chain(X, i, s - 1, SEED, adrs);
  adrs.setHashAddress(i + s - 1);
  adrs.setKeyAndMask(0);
  const KEY = PRF(SEED, adrs.toBytes());
  adrs.setKeyAndMask(1);
  const BM = PRF(SEED, adrs.toBytes());
  return F(KEY, xor(tmp, BM));
}

/** Algorithm 4: WOTS_genPK. */
export function WOTS_genPK(sk: Uint8Array[], SEED: Uint8Array, adrs: ADRS): Uint8Array[] {
  const pk: Uint8Array[] = [];
  for (let i = 0; i < len; i++) {
    adrs.setChainAddress(i);
    pk.push(chain(sk[i]!, 0, w - 1, SEED, adrs));
  }
  return pk;
}

/** The message + checksum base-w digits shared by Algorithms 5 and 6. */
export function msgDigits(M: Uint8Array): number[] {
  if (M.length !== n) throw new Error('msg must be n bytes');
  const msg = base_w(M, len1);
  let csum = 0;
  for (let i = 0; i < len1; i++) csum += w - 1 - msg[i]!;
  csum = csum << (8 - ((len2 * log2w) % 8));
  const len_2_bytes = Math.ceil((len2 * log2w) / 8);
  return msg.concat(base_w(toByte(csum, len_2_bytes), len2));
}

/** Algorithm 5: WOTS_sign. */
export function WOTS_sign(M: Uint8Array, sk: Uint8Array[], SEED: Uint8Array, adrs: ADRS): Uint8Array[] {
  const msg = msgDigits(M);
  const sig: Uint8Array[] = [];
  for (let i = 0; i < len; i++) {
    adrs.setChainAddress(i);
    sig.push(chain(sk[i]!, 0, msg[i]!, SEED, adrs));
  }
  return sig;
}

/** Algorithm 6: WOTS_pkFromSig. */
export function WOTS_pkFromSig(M: Uint8Array, sig: Uint8Array[], SEED: Uint8Array, adrs: ADRS): Uint8Array[] {
  const msg = msgDigits(M);
  const tmp_pk: Uint8Array[] = [];
  for (let i = 0; i < len; i++) {
    adrs.setChainAddress(i);
    tmp_pk.push(chain(sig[i]!, msg[i]!, w - 1 - msg[i]!, SEED, adrs));
  }
  return tmp_pk;
}

/** Algorithm 7: RAND_HASH. */
export function RAND_HASH(LEFT: Uint8Array, RIGHT: Uint8Array, SEED: Uint8Array, adrs: ADRS): Uint8Array {
  adrs.setKeyAndMask(0);
  const KEY = PRF(SEED, adrs.toBytes());
  adrs.setKeyAndMask(1);
  const BM_0 = PRF(SEED, adrs.toBytes());
  adrs.setKeyAndMask(2);
  const BM_1 = PRF(SEED, adrs.toBytes());
  return H(KEY, concat(xor(LEFT, BM_0), xor(RIGHT, BM_1)));
}

/** Algorithm 8: ltree. */
export function ltree(pkIn: Uint8Array[], SEED: Uint8Array, adrs: ADRS): Uint8Array {
  const pk = pkIn.slice();
  let lenP = len;
  adrs.setTreeHeight(0);
  while (lenP > 1) {
    for (let i = 0; i < Math.floor(lenP / 2); i++) {
      adrs.setTreeIndex(i);
      pk[i] = RAND_HASH(pk[2 * i]!, pk[2 * i + 1]!, SEED, adrs);
    }
    if (lenP % 2 === 1) pk[Math.floor(lenP / 2)] = pk[lenP - 1]!;
    lenP = Math.ceil(lenP / 2);
    adrs.setTreeHeight(adrs.getTreeHeight() + 1);
  }
  return pk[0]!;
}

export interface RefSK {
  SK_SEED: Uint8Array;
  SK_PRF: Uint8Array;
  SEED: Uint8Array;
}

/** Bouncy Castle / xmss-reference WOTS+ secret key for leaf i (see header). */
export function getWOTS_SK(SK: RefSK, i: number): Uint8Array[] {
  const a = new ADRS();
  a.setType(0);
  a.setOTSAddress(i);
  const S_ots = PRF(SK.SK_SEED, a.toBytes());
  const sk: Uint8Array[] = [];
  for (let j = 0; j < len; j++) sk.push(PRF(S_ots, toByte(j, 32)));
  return sk;
}

/** Leaf i = ltree(WOTS_genPK(sk_i)) with the ADRS handling of Algorithm 9. */
export function leaf(SK: RefSK, i: number, adrs: ADRS): Uint8Array {
  adrs.setType(0);
  adrs.setOTSAddress(i);
  const pk = WOTS_genPK(getWOTS_SK(SK, i), SK.SEED, adrs);
  adrs.setType(1);
  adrs.setLtreeAddress(i);
  return ltree(pk, SK.SEED, adrs);
}

export interface RefTree {
  h: number;
  /** nodes.get(`${height}:${index}`) */
  nodes: Map<string, Uint8Array>;
  root: Uint8Array;
}

/**
 * Algorithm 9 (treeHash) over the whole tree (s = 0, t = h), transcribed with
 * its stack, recording every node it produces so authentication paths can be
 * read back. Leaves may be supplied precomputed (same values as leaf()).
 */
export function treeHashFull(SK: RefSK, h: number, leaves?: Uint8Array[]): RefTree {
  const nodes = new Map<string, Uint8Array>();
  const stack: { node: Uint8Array; height: number }[] = [];
  const adrs = new ADRS();
  const count = 1 << h;
  for (let i = 0; i < count; i++) {
    let node = leaves ? leaves[i]! : leaf(SK, i, adrs);
    nodes.set(`0:${i}`, node);
    adrs.setType(2);
    adrs.setTreeHeight(0);
    adrs.setTreeIndex(i);
    let height = 0;
    while (stack.length > 0 && stack[stack.length - 1]!.height === height) {
      adrs.setTreeIndex((adrs.getTreeIndex() - 1) / 2);
      const left = stack.pop()!.node;
      node = RAND_HASH(left, node, SK.SEED, adrs);
      adrs.setTreeHeight(adrs.getTreeHeight() + 1);
      height++;
      nodes.set(`${height}:${adrs.getTreeIndex()}`, node);
    }
    stack.push({ node, height });
  }
  if (stack.length !== 1) throw new Error('treeHash: stack not reduced');
  return { h, nodes, root: stack[0]!.node };
}

/** Algorithm 11 buildAuth: auth[j] = sibling subtree root at height j. */
export function buildAuth(tree: RefTree, i: number): Uint8Array[] {
  const auth: Uint8Array[] = [];
  for (let j = 0; j < tree.h; j++) {
    const k = Math.floor(i / 2 ** j) ^ 1;
    const node = tree.nodes.get(`${j}:${k}`);
    if (!node) throw new Error(`missing node ${j}:${k}`);
    auth.push(node);
  }
  return auth;
}

/** Algorithm 12 (XMSS_sign) for a given idx, returning the §4.1.8 byte layout. */
export function XMSS_sign(SK: RefSK, tree: RefTree, idx_sig: number, M: Uint8Array): Uint8Array {
  const r = PRF(SK.SK_PRF, toByte(idx_sig, 32));
  const Mp = H_msg(concat(r, tree.root, toByte(idx_sig, n)), M);
  const adrs = new ADRS();
  adrs.setType(0);
  adrs.setOTSAddress(idx_sig);
  const sig_ots = WOTS_sign(Mp, getWOTS_SK(SK, idx_sig), SK.SEED, adrs);
  const auth = buildAuth(tree, idx_sig);
  return concat(toByte(idx_sig, 4), r, ...sig_ots, ...auth);
}

export function sigBytesForHeight(h: number): number {
  return 4 + n + len * n + h * n;
}

/** Algorithm 13: XMSS_rootFromSig, from the raw §4.1.8 layout. */
export function XMSS_rootFromSig(sigBytes: Uint8Array, M: Uint8Array, root: Uint8Array, SEED: Uint8Array, h: number): Uint8Array {
  if (sigBytes.length !== sigBytesForHeight(h)) throw new Error('bad signature length');
  const idx_sig = ((sigBytes[0]! << 24) | (sigBytes[1]! << 16) | (sigBytes[2]! << 8) | sigBytes[3]!) >>> 0;
  const r = sigBytes.subarray(4, 4 + n);
  const sig_ots: Uint8Array[] = [];
  let o = 4 + n;
  for (let i = 0; i < len; i++) {
    sig_ots.push(sigBytes.subarray(o, o + n));
    o += n;
  }
  const auth: Uint8Array[] = [];
  for (let i = 0; i < h; i++) {
    auth.push(sigBytes.subarray(o, o + n));
    o += n;
  }
  const Mp = H_msg(concat(r, root, toByte(idx_sig, n)), M);
  const adrs = new ADRS();
  adrs.setType(0);
  adrs.setOTSAddress(idx_sig);
  const pk_ots = WOTS_pkFromSig(Mp, sig_ots, SEED, adrs);
  adrs.setType(1);
  adrs.setLtreeAddress(idx_sig);
  let node0 = ltree(pk_ots, SEED, adrs);
  adrs.setType(2);
  adrs.setTreeIndex(idx_sig);
  for (let k = 0; k < h; k++) {
    adrs.setTreeHeight(k);
    if (Math.floor(idx_sig / 2 ** k) % 2 === 0) {
      adrs.setTreeIndex(adrs.getTreeIndex() / 2);
      node0 = RAND_HASH(node0, auth[k]!, SEED, adrs);
    } else {
      adrs.setTreeIndex((adrs.getTreeIndex() - 1) / 2);
      node0 = RAND_HASH(auth[k]!, node0, SEED, adrs);
    }
  }
  return node0;
}

/** Algorithm 14: XMSS_verify. Needs only (root, SEED). */
export function XMSS_verify(sigBytes: Uint8Array, M: Uint8Array, root: Uint8Array, SEED: Uint8Array, h: number): boolean {
  try {
    const idx = ((sigBytes[0]! << 24) | (sigBytes[1]! << 16) | (sigBytes[2]! << 8) | sigBytes[3]!) >>> 0;
    if (idx >= 2 ** h) return false;
    const got = XMSS_rootFromSig(sigBytes, M, root, SEED, h);
    return hex(got) === hex(root);
  } catch {
    return false;
  }
}

/** Full key generation (Algorithm 10) with the recorded tree. */
export function XMSS_keyGen(SK: RefSK, h: number): RefTree {
  return treeHashFull(SK, h);
}
