/**
 * RFC 8391 section 5.1 keyed hash functions for the SHA2 / n = 32 family:
 *
 *   F(KEY, M)     = SHA-256(toByte(0, 32) || KEY || M)
 *   H(KEY, M)     = SHA-256(toByte(1, 32) || KEY || M)
 *   H_msg(KEY, M) = SHA-256(toByte(2, 32) || KEY || M)
 *   PRF(KEY, M)   = SHA-256(toByte(3, 32) || KEY || M)
 *
 * plus RAND_HASH (section 4.1.4) and the randomized message hash.
 */
import { sha256 } from "@noble/hashes/sha256";
import type { Address } from "./address.js";
import { N } from "./params.js";

export { sha256 };

const PAD_F = 0;
const PAD_H = 1;
const PAD_HMSG = 2;
const PAD_PRF = 3;

// Reusable scratch buffers (single-threaded JS, so this is safe).
const bufPrf = new Uint8Array(32 + N + 32); // pad || key || adrs
const bufF = new Uint8Array(32 + N + N); // pad || key || masked
const bufH = new Uint8Array(32 + N + 2 * N); // pad || key || masked(2n)

bufPrf[31] = PAD_PRF;
bufF[31] = PAD_F;
bufH[31] = PAD_H;

/** PRF(KEY, M) with a 32-byte M (an ADRS or toByte(i, 32)). */
export function prf(key: Uint8Array, m32: Uint8Array): Uint8Array {
  if (key.length !== N) throw new Error("PRF: key must be n bytes");
  if (m32.length !== 32) throw new Error("PRF: input must be 32 bytes");
  bufPrf.set(key, 32);
  bufPrf.set(m32, 32 + N);
  return sha256(bufPrf);
}

/** F(KEY, M) with n-byte KEY and M. */
export function F(key: Uint8Array, m: Uint8Array): Uint8Array {
  if (key.length !== N || m.length !== N) throw new Error("F: key and message must be n bytes");
  bufF.set(key, 32);
  bufF.set(m, 32 + N);
  return sha256(bufF);
}

/** H(KEY, M) with n-byte KEY and 2n-byte M. */
export function H(key: Uint8Array, m: Uint8Array): Uint8Array {
  if (key.length !== N || m.length !== 2 * N) throw new Error("H: key must be n bytes and message 2n bytes");
  bufH.set(key, 32);
  bufH.set(m, 32 + N);
  return sha256(bufH);
}

/** H_msg(KEY, M) with 3n-byte KEY and arbitrary-length M. */
export function hMsg(key: Uint8Array, m: Uint8Array): Uint8Array {
  if (key.length !== 3 * N) throw new Error("H_msg: key must be 3n bytes");
  const h = sha256.create();
  const pad = new Uint8Array(32);
  pad[31] = PAD_HMSG;
  h.update(pad);
  h.update(key);
  h.update(m);
  return h.digest();
}

/**
 * The keyed, masked chaining step used by WOTS+ (RFC 8391 Algorithm 2 body):
 *   KEY = PRF(SEED, ADRS[keyAndMask = 0])
 *   BM  = PRF(SEED, ADRS[keyAndMask = 1])
 *   out = F(KEY, in XOR BM)
 * `adrs` must already carry the chain and hash addresses.
 */
export function thashF(input: Uint8Array, seed: Uint8Array, adrs: Address): Uint8Array {
  adrs.setKeyAndMask(0);
  const key = prf(seed, adrs.bytes);
  adrs.setKeyAndMask(1);
  const bm = prf(seed, adrs.bytes);
  const masked = new Uint8Array(N);
  for (let i = 0; i < N; i++) masked[i] = input[i]! ^ bm[i]!;
  return F(key, masked);
}

/**
 * RAND_HASH(LEFT, RIGHT, SEED, ADRS) (RFC 8391 Algorithm 7):
 *   KEY  = PRF(SEED, ADRS[keyAndMask = 0])
 *   BM_0 = PRF(SEED, ADRS[keyAndMask = 1])
 *   BM_1 = PRF(SEED, ADRS[keyAndMask = 2])
 *   out  = H(KEY, (LEFT XOR BM_0) || (RIGHT XOR BM_1))
 */
export function randHash(left: Uint8Array, right: Uint8Array, seed: Uint8Array, adrs: Address): Uint8Array {
  adrs.setKeyAndMask(0);
  const key = prf(seed, adrs.bytes);
  adrs.setKeyAndMask(1);
  const bm0 = prf(seed, adrs.bytes);
  adrs.setKeyAndMask(2);
  const bm1 = prf(seed, adrs.bytes);
  const masked = new Uint8Array(2 * N);
  for (let i = 0; i < N; i++) {
    masked[i] = left[i]! ^ bm0[i]!;
    masked[N + i] = right[i]! ^ bm1[i]!;
  }
  return H(key, masked);
}
