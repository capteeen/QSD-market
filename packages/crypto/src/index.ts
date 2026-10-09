/**
 * @qsd/crypto — hash-based launch identities (WOTS+ / XMSS-style Merkle
 * signatures over SHA-256) with step-by-step observability.
 *
 * See README.md for the math, the event model and the limits.
 */

// Parameters & sizes
export {
  N,
  W,
  LOG_W,
  LEN,
  LEN_1,
  LEN_2,
  CHAIN_LINKS,
  CHAIN_STEPS,
  TREE_HEIGHT,
  LEAVES,
  INDEX_BYTES,
  WOTS_SIG_BYTES,
  SIGNATURE_BYTES,
  PUBLIC_KEY_BYTES,
  signatureBytesForHeight,
} from "./params.js";

// Identity API
export {
  Identity,
  createIdentity,
  sign,
  signWithIndex,
  verify,
  signatureIndex,
  encodePublicKey,
  decodePublicKey,
  publicKeysEqual,
  validateState,
  isIndexUsed,
  markUsed,
  mergeStates,
  remainingIndices,
  remainingCount,
  MemoryStateStore,
  Signer,
  StateConflictError,
} from "./identity.js";
export type {
  IdentityPublicKey,
  IdentityState,
  CreateIdentityOptions,
  SignOptions,
  SignResult,
  VerifyOptions,
  StateStore,
} from "./identity.js";

// Errors
export { KeyReuseError, KeysExhaustedError, CryptoInputError, NotImplementedError } from "./errors.js";

// Events
export { CryptoObserver, recordEvents, redactEvents, redactEvent, describeEvent } from "./events.js";
export type { CryptoEvent, CryptoEventType, CryptoEventInput, CryptoListener, Recording } from "./events.js";

// Lower-level building blocks (for the scene, tests and Agent H)
export { deriveKeyMaterial, KDF_SALT, MIN_SEED_BYTES } from "./kdf.js";
export type { DerivedKeyMaterial } from "./kdf.js";
export { Address, ADRS_TYPE_OTS, ADRS_TYPE_LTREE, ADRS_TYPE_HASHTREE } from "./address.js";
export { sha256, F, H, hMsg, prf, randHash, thashF } from "./hash.js";
export {
  baseW,
  chainLengths,
  chain,
  otsAddress,
  wotsSecretSeed,
  wotsExpandSecretKey,
  wotsPublicKey,
  wotsSign,
  wotsPublicKeyFromSignature,
} from "./wots.js";
export { ltree, buildHashTree, authPath, rootFromAuthPath, hashTreeAddress } from "./merkle.js";
export type { HashTree } from "./merkle.js";
export {
  xmssKeyGen,
  xmssLeaf,
  xmssSign,
  xmssVerify,
  xmssRootFromSig,
  messageDigest,
  encodeSignature,
  decodeSignature,
} from "./xmss.js";
export type { XmssSecretMaterial, XmssKeyPair, XmssSignature } from "./xmss.js";
export { toHex, fromHex, concat, toByte, equalBytes } from "./bytes.js";
