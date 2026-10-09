/**
 * Parameters. These are the XMSS-SHA2_*_256 family parameters of RFC 8391
 * section 5.3 (n = 32, w = 16) with the QSD tree height fixed at 8.
 */

/** Security parameter / hash output size in bytes (SHA-256). */
export const N = 32;
/** Winternitz parameter. */
export const W = 16;
/** log2(W). */
export const LOG_W = 4;
/** Number of message chains: ceil(8n / log2 w) = 64. */
export const LEN_1 = 64;
/** Number of checksum chains: floor(log2(len_1 * (w - 1)) / log2 w) + 1 = 3. */
export const LEN_2 = 3;
/** Total number of WOTS+ chains. */
export const LEN = LEN_1 + LEN_2; // 67
/** Number of positions in each chain: depth 0 (secret) through depth w-1 (public). */
export const CHAIN_LINKS = W; // 16
/** Number of F applications in a full chain. */
export const CHAIN_STEPS = W - 1; // 15

/** QSD identity tree height. */
export const TREE_HEIGHT = 8;
/** Number of one-time keys per identity. */
export const LEAVES = 1 << TREE_HEIGHT; // 256

/** Index bytes in an XMSS signature (RFC 8391 section 4.1.8). */
export const INDEX_BYTES = 4;
/** Size of a WOTS+ signature / public key in bytes. */
export const WOTS_SIG_BYTES = LEN * N; // 2144
/** Exact size of an identity signature in bytes: index + r + sig_ots + auth path. */
export const SIGNATURE_BYTES = INDEX_BYTES + N + WOTS_SIG_BYTES + TREE_HEIGHT * N; // 2436
/** Size of the encoded public key: root || pubSeed. */
export const PUBLIC_KEY_BYTES = 2 * N; // 64

export function signatureBytesForHeight(height: number): number {
  return INDEX_BYTES + N + WOTS_SIG_BYTES + height * N;
}
