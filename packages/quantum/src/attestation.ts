import { ed25519 } from '@noble/curves/ed25519';
import {
  bytesToHex,
  canonicalJson,
  hexToBytes,
  isHex,
  isIsoTimestamp,
  sha256,
  utf8,
} from './encoding.js';
import type {
  Attestation,
  CapturedHttpResponse,
  Hex,
  ProviderSignedAttestation,
  UnsafeDevAttestation,
  VerifyResult,
  WitnessSignedAttestation,
} from './types.js';

/** Domain separator for witness and dev signatures. */
export const ATTESTATION_SIGNING_DOMAIN = 'qsd.market/quantum/attestation/v1';

// ---------------------------------------------------------------------------
// Ed25519 helpers (browser-safe; @noble/curves is pure JS)
// ---------------------------------------------------------------------------

export interface Ed25519Signer {
  readonly publicKey: Hex;
  sign(message: Uint8Array): Uint8Array;
}

/** Build a signer from a 32-byte Ed25519 seed. The seed is never stored on the returned object. */
export function ed25519SignerFromSeed(seed: Uint8Array): Ed25519Signer {
  if (seed.length !== 32) throw new TypeError('Ed25519 seed must be exactly 32 bytes');
  const sk = new Uint8Array(seed); // private copy
  const publicKey = bytesToHex(ed25519.getPublicKey(sk));
  return {
    publicKey,
    sign(message) {
      return ed25519.sign(message, sk);
    },
  };
}

/** Generate an ephemeral signer using the platform CSPRNG. */
export function ephemeralEd25519Signer(): Ed25519Signer {
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  return ed25519SignerFromSeed(seed);
}

export function ed25519Verify(signatureHex: Hex, message: Uint8Array, publicKeyHex: Hex): boolean {
  try {
    if (!isHex(signatureHex) || !isHex(publicKeyHex)) return false;
    const sig = hexToBytes(signatureHex);
    const pk = hexToBytes(publicKeyHex);
    if (sig.length !== 64 || pk.length !== 32) return false;
    return ed25519.verify(sig, message, pk);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Signing payloads
// ---------------------------------------------------------------------------

/**
 * The message signed by witness and dev attestations:
 * sha256( DOMAIN || "\n" || canonical(attestation without `signature`) ).
 */
export function attestationSigningMessage(att: Attestation): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _omit, ...unsigned } = att;
  return sha256(utf8(ATTESTATION_SIGNING_DOMAIN + '\n' + canonicalJson(unsigned)));
}

export function signWitnessAttestation(
  unsigned: Omit<WitnessSignedAttestation, 'signature' | 'witnessPublicKey'>,
  signer: Ed25519Signer,
): WitnessSignedAttestation {
  const withKey = { ...unsigned, witnessPublicKey: signer.publicKey, signature: '' };
  const sig = signer.sign(attestationSigningMessage(withKey));
  return { ...withKey, signature: bytesToHex(sig) };
}

export function signUnsafeDevAttestation(
  unsigned: Omit<UnsafeDevAttestation, 'signature' | 'ephemeralPublicKey'>,
  signer: Ed25519Signer,
): UnsafeDevAttestation {
  const withKey = { ...unsigned, ephemeralPublicKey: signer.publicKey, signature: '' };
  const sig = signer.sign(attestationSigningMessage(withKey));
  return { ...withKey, signature: bytesToHex(sig) };
}

// ---------------------------------------------------------------------------
// Verification (never throws)
// ---------------------------------------------------------------------------

export interface AttestationVerifyOptions {
  /**
   * Published QSD witness public keys (hex). A 'witness-signed' attestation is
   * accepted ONLY if its key is in this set. With no set, every witness-signed
   * attestation is rejected (fail closed). See `trustedWitnessKeysFromEnv()`.
   */
  trustedWitnessKeys?: readonly Hex[];
  /** Same for 'provider-signed': the provider's published keys. Required for acceptance. */
  trustedProviderKeys?: readonly Hex[];
  /** Whether 'unsafe-dev' attestations are acceptable. Default false. */
  allowUnsafeDev?: boolean;
  /**
   * Diagnostic only: accept a witness/provider signature made by the key
   * embedded in the attestation even if it is not a published key. The result
   * then carries `trust: 'self-consistent-only'` and must never be shown as
   * "verified". Default false.
   */
  trustAnyKey?: boolean;
}

/** Env var holding published witness public keys: comma-separated 64-hex-char keys. */
export const WITNESS_PUBLIC_KEYS_ENV = 'QSD_WITNESS_PUBLIC_KEYS';

/**
 * Read the published witness key set from an env object (default: the real
 * process env). Returns [] when unset, which makes verification fail closed.
 */
export function trustedWitnessKeysFromEnv(env?: Record<string, string | undefined>): Hex[] {
  let e = env;
  if (!e) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e = ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
    } catch {
      e = {};
    }
  }
  const raw = e[WITNESS_PUBLIC_KEYS_ENV] ?? '';
  return raw
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length === 64 && isHex(k));
}

function checkCommonFields(att: Record<string, unknown>): string | null {
  if (typeof att['providerId'] !== 'string' || att['providerId'].length === 0) {
    return 'attestation.providerId missing';
  }
  if (!isIsoTimestamp(att['requestedAt'])) return 'attestation.requestedAt is not an ISO timestamp';
  if (!isIsoTimestamp(att['receivedAt'])) return 'attestation.receivedAt is not an ISO timestamp';
  if (Date.parse(att['receivedAt'] as string) < Date.parse(att['requestedAt'] as string)) {
    return 'attestation.receivedAt precedes requestedAt';
  }
  if (!isHex(att['bytesSha256']) || (att['bytesSha256'] as string).length !== 64) {
    return 'attestation.bytesSha256 is not a sha256 hex digest';
  }
  if (!isHex(att['signature']) || (att['signature'] as string).length !== 128) {
    return 'attestation.signature is not a 64-byte hex signature';
  }
  if (att['inputsHash'] !== undefined && (!isHex(att['inputsHash']) || (att['inputsHash'] as string).length !== 64)) {
    return 'attestation.inputsHash is not a sha256 hex digest';
  }
  if (att['nonce'] !== undefined && (!isHex(att['nonce']) || (att['nonce'] as string).length === 0)) {
    return 'attestation.nonce is not hex';
  }
  if ((att['inputsHash'] === undefined) !== (att['nonce'] === undefined)) {
    return 'attestation.inputsHash and attestation.nonce must be present together';
  }
  return null;
}

/** Is the provider's signed message bound to this draw? */
function providerMessageIsBound(p: ProviderSignedAttestation): boolean {
  const bodyHex = bytesToHex(utf8(p.response.body));
  if (p.signedMessage === bodyHex) return true;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(p.signedMessage));
    return text.includes(p.bytesSha256);
  } catch {
    return false;
  }
}

function checkCapturedResponse(r: unknown): string | null {
  if (!r || typeof r !== 'object') return 'attestation.response missing';
  const resp = r as Partial<CapturedHttpResponse>;
  if (typeof resp.status !== 'number') return 'attestation.response.status missing';
  if (typeof resp.body !== 'string') return 'attestation.response.body missing';
  if (typeof resp.url !== 'string') return 'attestation.response.url missing';
  if (!resp.headers || typeof resp.headers !== 'object') return 'attestation.response.headers missing';
  if (!isHex(resp.bodySha256) || resp.bodySha256.length !== 64) {
    return 'attestation.response.bodySha256 is not a sha256 hex digest';
  }
  const actual = bytesToHex(sha256(utf8(resp.body)));
  if (actual !== resp.bodySha256) return 'attestation.response.bodySha256 does not match body';
  return null;
}

/**
 * Verify an attestation's internal consistency and signature. Does not check
 * that `bytesSha256` matches any particular bytes; `verifyBundle` does that.
 */
export function verifyAttestation(
  att: unknown,
  opts: AttestationVerifyOptions = {},
): VerifyResult {
  try {
    if (!att || typeof att !== 'object') return { ok: false, reason: 'attestation is not an object' };
    const a = att as Record<string, unknown>;
    const common = checkCommonFields(a);
    if (common) return { ok: false, reason: common };

    switch (a['kind']) {
      case 'witness-signed': {
        const w = a as unknown as WitnessSignedAttestation;
        if (w.transport !== 'https') return { ok: false, reason: 'witness attestation transport is not https' };
        const respErr = checkCapturedResponse(w.response);
        if (respErr) return { ok: false, reason: respErr };
        if (!isHex(w.witnessPublicKey) || w.witnessPublicKey.length !== 64) {
          return { ok: false, reason: 'witnessPublicKey is not a 32-byte hex key' };
        }
        if (!ed25519Verify(w.signature, attestationSigningMessage(w), w.witnessPublicKey)) {
          return { ok: false, reason: 'witness signature does not verify' };
        }
        if (!(opts.trustedWitnessKeys ?? []).includes(w.witnessPublicKey)) {
          if (opts.trustAnyKey) return { ok: true, trust: 'self-consistent-only' };
          return {
            ok: false,
            reason: opts.trustedWitnessKeys
              ? 'witnessPublicKey is not in the trusted witness key set'
              : 'no trusted witness keys were supplied; a witness-signed attestation cannot be accepted',
          };
        }
        return { ok: true };
      }
      case 'provider-signed': {
        const p = a as unknown as ProviderSignedAttestation;
        if (p.scheme !== 'ed25519') {
          return { ok: false, reason: `unsupported provider signature scheme: ${String(p.scheme)}` };
        }
        const respErr = checkCapturedResponse(p.response);
        if (respErr) return { ok: false, reason: respErr };
        if (!isHex(p.publicKey) || p.publicKey.length !== 64) {
          return { ok: false, reason: 'provider publicKey is not a 32-byte hex key' };
        }
        if (!isHex(p.signedMessage)) return { ok: false, reason: 'signedMessage is not hex' };
        if (!providerMessageIsBound(p)) {
          return {
            ok: false,
            reason: 'provider signedMessage is not bound to this draw (must be the response body or contain bytesSha256)',
          };
        }
        if (!ed25519Verify(p.signature, hexToBytes(p.signedMessage), p.publicKey)) {
          return { ok: false, reason: 'provider signature does not verify' };
        }
        if (!(opts.trustedProviderKeys ?? []).includes(p.publicKey)) {
          if (opts.trustAnyKey) return { ok: true, trust: 'self-consistent-only' };
          return {
            ok: false,
            reason: opts.trustedProviderKeys
              ? 'provider publicKey is not in the trusted provider key set'
              : 'no trusted provider keys were supplied; a provider-signed attestation cannot be accepted',
          };
        }
        return { ok: true };
      }
      case 'unsafe-dev': {
        const d = a as unknown as UnsafeDevAttestation;
        if (!opts.allowUnsafeDev) {
          return { ok: false, reason: 'unsafe-dev attestation is not accepted (allowUnsafeDev is false)' };
        }
        if (d.providerId !== 'UNSAFE_DEV_RANDOM') {
          return { ok: false, reason: 'unsafe-dev attestation must have providerId UNSAFE_DEV_RANDOM' };
        }
        if (!isHex(d.ephemeralPublicKey) || d.ephemeralPublicKey.length !== 64) {
          return { ok: false, reason: 'ephemeralPublicKey is not a 32-byte hex key' };
        }
        if (!ed25519Verify(d.signature, attestationSigningMessage(d), d.ephemeralPublicKey)) {
          return { ok: false, reason: 'unsafe-dev signature does not verify' };
        }
        return { ok: true };
      }
      default:
        return { ok: false, reason: `unknown attestation kind: ${String(a['kind'])}` };
    }
  } catch (err) {
    return { ok: false, reason: `attestation verification threw: ${(err as Error)?.message ?? String(err)}` };
  }
}
