/**
 * @qsd/quantum — attested quantum randomness, proof bundles and verification.
 *
 * Browser-safe: everything except the providers' use of `fetch` and
 * `crypto.getRandomValues` (both available in browsers and Node 22) is pure.
 */

export * from './types.js';
export {
  MeasurementUnavailableError,
  ProductionGuardError,
  QuantumConfigError,
  NotImplementedError,
  isProduction,
  currentNodeEnv,
  unsafeDevPermission,
  ALLOW_UNSAFE_DEV_ENV,
  type DevPermission,
} from './errors.js';

export {
  bytesToHex,
  hexToBytes,
  isHex,
  sha256Hex,
  canonicalJson,
  hashJson,
  nowIso,
  isIsoTimestamp,
} from './encoding.js';

export { computeCommitment, COMMITMENT_DOMAIN } from './commitment.js';

export {
  ATTESTATION_SIGNING_DOMAIN,
  attestationSigningMessage,
  ed25519SignerFromSeed,
  ephemeralEd25519Signer,
  ed25519Verify,
  signWitnessAttestation,
  signUnsafeDevAttestation,
  verifyAttestation,
  trustedWitnessKeysFromEnv,
  WITNESS_PUBLIC_KEYS_ENV,
  type Ed25519Signer,
  type AttestationVerifyOptions,
} from './attestation.js';

export { QuantumEventBus, recordEvents, type EventRecording } from './events.js';

export {
  buildProofBundle,
  serializeDraw,
  deserializeDraw,
  serializeBundle,
  parseBundle,
  bundleHash,
  verifyBundle,
  bundleBinding,
  type VerifyBundleOptions,
} from './bundle.js';

export {
  createQrngClient,
  DEFAULT_DRAW_BYTES,
  type QrngClient,
  type QrngClientOptions,
  type MeasureOptions,
  type MeasureResult,
} from './client.js';

export {
  AnuQuantumNumbersProvider,
  ANU_PROVIDER_ID,
  ANU_DEFAULT_ENDPOINT,
  ANU_MAX_BYTES_PER_REQUEST,
  CAPTURED_RESPONSE_HEADERS,
  parseAnuResponse,
  sanitizeExcerpt,
  type AnuProviderOptions,
  type AnuSuccessResponse,
} from './providers/anu.js';

export {
  UnsafeDevRandomProvider,
  UNSAFE_DEV_RANDOM_ID,
  UNSAFE_DEV_WARNING,
} from './providers/unsafeDev.js';

export { createProviderFromEnv, ENV, type EnvLike } from './providers/fromEnv.js';

/** Alias: the spec calls this verify(). */
export { verifyBundle as verify } from './bundle.js';
