/**
 * Public types for @qsd/quantum.
 *
 * Everything here is JSON-serialisable except `Draw.bytes` (a Uint8Array),
 * which is serialised as lowercase hex by `serializeBundle()` and restored by
 * `deserializeBundle()`.
 */

/** Lowercase hex string, no 0x prefix. */
export type Hex = string;

/** ISO-8601 UTC timestamp with millisecond precision, e.g. 2026-10-09T07:40:52.535Z */
export type IsoTimestamp = string;

/** Any JSON value. Inputs to a measurement must be representable as this. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Draw binding (anti-grinding)
// ---------------------------------------------------------------------------

/**
 * Binds a draw request to the measurement it is for. The client computes
 * `inputsHash = sha256(canonical(inputs))` BEFORE the draw and passes it to
 * the provider, which includes it (and the nonce) in the witness statement and
 * therefore in the commitment. The chain package anchors (inputsHash, nonce)
 * on-chain before the draw is requested, so a draw that was requested for
 * different inputs, or re-requested for the same inputs under a new nonce, is
 * detectable by comparing anchors. See README "Draw binding and grinding".
 */
export interface DrawBinding {
  /** sha256(canonical(inputs)) hex. */
  inputsHash: Hex;
  /** Per-measurement identifier, hex. Uniqueness, not secrecy, is what matters. */
  nonce: Hex;
}

// ---------------------------------------------------------------------------
// Attestations
// ---------------------------------------------------------------------------

/** Fields every attestation kind carries. `inputsHash`/`nonce` are present on every draw made through `createQrngClient().measure()`. */
interface AttestationBase {
  providerId: string;
  requestedAt: IsoTimestamp;
  receivedAt: IsoTimestamp;
  /** sha256(bytes) of the draw. */
  bytesSha256: Hex;
  /** Inputs the draw was requested for (see DrawBinding). Optional only for draws made without a binding. */
  inputsHash?: Hex;
  /** Per-measurement nonce (see DrawBinding). */
  nonce?: Hex;
}

/**
 * Captured verbatim from the provider's HTTP response. Headers are limited to
 * a documented allow-list (date, request ids, etag, content-type) so that the
 * attestation never accidentally captures credentials.
 */
export interface CapturedHttpResponse {
  /** HTTP status code as received. */
  status: number;
  /** Lowercased header name -> value, allow-listed, verbatim. */
  headers: Record<string, string>;
  /** Raw response body as received (UTF-8 text). */
  body: string;
  /** sha256(body) as hex, so a verifier can compare without the body. */
  bodySha256: Hex;
  /** The URL the request was sent to, with the API key never included. */
  url: string;
}

/**
 * The provider itself signed its response with a published key. Verifying the
 * signature proves the bytes came from the provider.
 *
 * No provider QSD has evaluated offers this yet (see README). The variant is
 * expressible so that a provider which does can be added without changing the
 * bundle format.
 */
export interface ProviderSignedAttestation extends AttestationBase {
  kind: 'provider-signed';
  /** Signature scheme. Only 'ed25519' is verifiable in this package today. */
  scheme: 'ed25519';
  /** Provider's public key, hex. Must match the key the provider publishes. */
  publicKey: Hex;
  /**
   * The exact message the provider signed, hex-encoded. verify() requires it
   * to be bound to this draw: it must be exactly the UTF-8 bytes of
   * `response.body`, or its decoded text must contain `bytesSha256`.
   * A signature over anything else is rejected.
   */
  signedMessage: Hex;
  /** Signature over `signedMessage`, hex. */
  signature: Hex;
  /** Verbatim capture of the HTTP response, for audit. */
  response: CapturedHttpResponse;
}

/**
 * The provider's response was captured verbatim over TLS and the QSD protocol
 * witness key signed a statement binding (providerId, requestedAt, receivedAt,
 * bytesSha256, response.bodySha256). Verifying the signature proves that the
 * holder of the witness key attests to having received that response at that
 * time. It does NOT by itself prove the provider sent it.
 */
export interface WitnessSignedAttestation extends AttestationBase {
  kind: 'witness-signed';
  /** Statement of how the response was obtained. */
  transport: 'https';
  /** Verbatim capture of the HTTP response (API key never present). */
  response: CapturedHttpResponse;
  /** Witness (QSD protocol) Ed25519 public key, hex. */
  witnessPublicKey: Hex;
  /** Ed25519 signature over sha256(canonical(attestation without signature)), hex. */
  signature: Hex;
}

/**
 * Produced only by UNSAFE_DEV_RANDOM. Signed by an ephemeral key generated at
 * provider construction so that bundles still round-trip through verify() in
 * tests. Carries no evidential weight and is impossible to produce when
 * NODE_ENV=production.
 */
export interface UnsafeDevAttestation extends AttestationBase {
  kind: 'unsafe-dev';
  providerId: 'UNSAFE_DEV_RANDOM';
  /** Ephemeral Ed25519 public key, hex. */
  ephemeralPublicKey: Hex;
  /** Ed25519 signature over sha256(canonical(attestation without signature)), hex. */
  signature: Hex;
  /** Human-readable warning carried in every bundle. */
  warning: string;
}

export type Attestation =
  | ProviderSignedAttestation
  | WitnessSignedAttestation
  | UnsafeDevAttestation;

export type AttestationKind = Attestation['kind'];

// ---------------------------------------------------------------------------
// Draws
// ---------------------------------------------------------------------------

export interface Draw {
  /** Raw random bytes exactly as decoded from the provider. */
  bytes: Uint8Array;
  providerId: string;
  requestedAt: IsoTimestamp;
  receivedAt: IsoTimestamp;
  attestation: Attestation;
  /**
   * sha256 over the length-prefixed concatenation of
   * DOMAIN || providerId || requestedAt || bytes || canonical(attestation).
   * See `computeCommitment()`.
   */
  commitment: Hex;
}

/** JSON-safe form of a Draw (bytes as hex). */
export interface SerializedDraw {
  bytesHex: Hex;
  providerId: string;
  requestedAt: IsoTimestamp;
  receivedAt: IsoTimestamp;
  attestation: Attestation;
  commitment: Hex;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type QuantumEventBody =
  | { type: 'entropyRequested'; providerId: string; nBytes: number; requestedAt: IsoTimestamp }
  | { type: 'entropyArrived'; bytes: Uint8Array; attestation: Attestation }
  | { type: 'commitmentComputed'; hash: Hex }
  | { type: 'outcomeResolved'; value: JsonValue; outcomeLabel: string };

export type QuantumEvent = QuantumEventBody & {
  /** Monotonic per bus, starting at 0. */
  seq: number;
  /** Wall-clock time the event was emitted. */
  at: IsoTimestamp;
};

export type QuantumEventType = QuantumEventBody['type'];

export type QuantumListener = (event: QuantumEvent) => void;

/** What a provider receives so it can emit events at the exact moment they happen. */
export interface DrawObserver {
  emit(body: QuantumEventBody): void;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface QrngProvider {
  /** Stable identifier recorded in every draw, e.g. 'anu-quantum-numbers'. */
  readonly id: string;
  /** The attestation kind this provider produces. */
  readonly attestationKind: AttestationKind;
  /**
   * Draw `nBytes` random bytes. `binding`, when given, must be included in the
   * attestation (and therefore the commitment). Rejects with
   * MeasurementUnavailableError when the source cannot be reached or returns
   * something unusable. Never falls back to anything.
   */
  draw(nBytes: number, observer?: DrawObserver, binding?: DrawBinding): Promise<Draw>;
}

// ---------------------------------------------------------------------------
// Outcomes, resolvers and proof bundles
// ---------------------------------------------------------------------------

export interface Outcome {
  /** Machine-readable outcome, e.g. { kind: 'collapse', channel: 2 }. */
  value: JsonValue;
  /** Human-readable label, e.g. 'collapse:channel-2'. */
  label: string;
}

/**
 * A pure, deterministic rule mapping (draw bytes, inputs) -> outcome. The
 * protocol package exports the real ones. `id` is embedded in bundles so a
 * verifier knows which rule to apply.
 */
export interface OutcomeResolver<I extends JsonValue = JsonValue> {
  readonly id: string;
  resolve(bytes: Uint8Array, inputs: I): Outcome;
}

export const PROOF_BUNDLE_VERSION = 1 as const;

export interface ProofBundle<I extends JsonValue = JsonValue> {
  version: typeof PROOF_BUNDLE_VERSION;
  /** Identifier of the resolver rule that produced `outcome`. */
  resolverId: string;
  draw: SerializedDraw;
  inputs: {
    value: I;
    /** sha256(canonical(value)) hex. */
    hash: Hex;
  };
  outcome: Outcome;
  resolvedAt: IsoTimestamp;
}

export type VerifyResult =
  | { ok: true }
  /** Only produced when the caller passed `trustAnyKey: true`: the attestation is internally consistent but its key is not a published one. A UI must not render this as "verified". */
  | { ok: true; trust: 'self-consistent-only' }
  | { ok: false; reason: string };
