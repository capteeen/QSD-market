/**
 * Seed → (SK_SEED, SK_PRF, SEED) via HKDF-SHA256 (RFC 5869). The input seed is
 * never stored on any returned object, never logged and never placed in an
 * event or error message.
 */
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { CryptoInputError } from "./errors.js";
import { N } from "./params.js";

export const KDF_SALT = new TextEncoder().encode("qsd.market/identity/v1");
export const KDF_INFO_SK_SEED = "xmss-sk-seed";
export const KDF_INFO_SK_PRF = "xmss-sk-prf";
export const KDF_INFO_PUB_SEED = "xmss-pub-seed";

export interface DerivedKeyMaterial {
  /** Secret: seeds every WOTS+ private key. */
  skSeed: Uint8Array;
  /** Secret: keys the per-signature randomizer r. */
  skPrf: Uint8Array;
  /** Public: SEED used for all PRF keys and bitmasks. Part of the public key. */
  pubSeed: Uint8Array;
}

export const MIN_SEED_BYTES = 32;

export function deriveKeyMaterial(seed: Uint8Array): DerivedKeyMaterial {
  if (!(seed instanceof Uint8Array)) throw new CryptoInputError("seed must be a Uint8Array");
  if (seed.length < MIN_SEED_BYTES) throw new CryptoInputError(`seed must be at least ${MIN_SEED_BYTES} bytes`);
  const enc = new TextEncoder();
  return {
    skSeed: hkdf(sha256, seed, KDF_SALT, enc.encode(KDF_INFO_SK_SEED), N),
    skPrf: hkdf(sha256, seed, KDF_SALT, enc.encode(KDF_INFO_SK_PRF), N),
    pubSeed: hkdf(sha256, seed, KDF_SALT, enc.encode(KDF_INFO_PUB_SEED), N),
  };
}
