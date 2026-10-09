import { verifyAttestation, type AttestationVerifyOptions } from './attestation.js';
import { computeCommitment } from './commitment.js';
import {
  bytesToHex,
  canonicalJson,
  hashJson,
  hexToBytes,
  isHex,
  isIsoTimestamp,
  sha256Hex,
} from './encoding.js';
import {
  PROOF_BUNDLE_VERSION,
  type Draw,
  type JsonValue,
  type Outcome,
  type OutcomeResolver,
  type ProofBundle,
  type SerializedDraw,
  type VerifyResult,
} from './types.js';

export function serializeDraw(draw: Draw): SerializedDraw {
  return {
    bytesHex: bytesToHex(draw.bytes),
    providerId: draw.providerId,
    requestedAt: draw.requestedAt,
    receivedAt: draw.receivedAt,
    attestation: draw.attestation,
    commitment: draw.commitment,
  };
}

export function deserializeDraw(s: SerializedDraw): Draw {
  return {
    bytes: hexToBytes(s.bytesHex),
    providerId: s.providerId,
    requestedAt: s.requestedAt,
    receivedAt: s.receivedAt,
    attestation: s.attestation,
    commitment: s.commitment,
  };
}

/** Build a bundle from a completed draw and a resolver. Pure; no I/O. */
export function buildProofBundle<I extends JsonValue>(args: {
  draw: Draw;
  inputs: I;
  resolver: OutcomeResolver<I>;
  resolvedAt?: string;
}): { bundle: ProofBundle<I>; outcome: Outcome } {
  const outcome = args.resolver.resolve(args.draw.bytes, args.inputs);
  // Force a canonical round-trip so the stored outcome is exactly what a verifier will recompute.
  const value = JSON.parse(canonicalJson(outcome.value)) as JsonValue;
  const bundle: ProofBundle<I> = {
    version: PROOF_BUNDLE_VERSION,
    resolverId: args.resolver.id,
    draw: serializeDraw(args.draw),
    inputs: { value: JSON.parse(canonicalJson(args.inputs)) as I, hash: hashJson(args.inputs) },
    outcome: { value, label: outcome.label },
    resolvedAt: args.resolvedAt ?? new Date().toISOString(),
  };
  return { bundle, outcome: bundle.outcome };
}

/** JSON text of a bundle, canonical, suitable for hashing and anchoring. */
export function serializeBundle(bundle: ProofBundle): string {
  return canonicalJson(bundle);
}

/** sha256 of the canonical bundle text; this is what gets anchored on-chain. */
export function bundleHash(bundle: ProofBundle): string {
  return sha256Hex(new TextEncoder().encode(serializeBundle(bundle)));
}

/** Parse JSON text into a bundle. Throws on malformed JSON; shape is checked by verifyBundle. */
export function parseBundle(text: string): ProofBundle {
  return JSON.parse(text) as ProofBundle;
}

export interface VerifyBundleOptions extends AttestationVerifyOptions {}

/**
 * Verify a proof bundle end to end. Never throws.
 *
 * Checks, in order:
 *  1. shape and version
 *  2. draw.providerId / requestedAt / receivedAt agree with the attestation
 *  3. attestation.bytesSha256 == sha256(draw bytes)
 *  4. attestation signature (per kind; see verifyAttestation)
 *  5. commitment recomputes
 *  6. inputs.hash == sha256(canonical(inputs.value))
 *  7. resolver.id == bundle.resolverId
 *  8. resolver(bytes, inputs) reproduces outcome.value and outcome.label
 */
export function verifyBundle<I extends JsonValue>(
  bundle: unknown,
  resolver: OutcomeResolver<I>,
  opts: VerifyBundleOptions = {},
): VerifyResult {
  try {
    if (!bundle || typeof bundle !== 'object') return fail('bundle is not an object');
    const b = bundle as Partial<ProofBundle<I>>;
    if (b.version !== PROOF_BUNDLE_VERSION) return fail(`unsupported bundle version: ${String(b.version)}`);
    if (typeof b.resolverId !== 'string' || !b.resolverId) return fail('bundle.resolverId missing');
    if (!isIsoTimestamp(b.resolvedAt)) return fail('bundle.resolvedAt is not an ISO timestamp');

    // --- draw shape
    const d = b.draw;
    if (!d || typeof d !== 'object') return fail('bundle.draw missing');
    if (!isHex(d.bytesHex) || d.bytesHex.length === 0) return fail('draw.bytesHex is not hex');
    if (typeof d.providerId !== 'string' || !d.providerId) return fail('draw.providerId missing');
    if (!isIsoTimestamp(d.requestedAt)) return fail('draw.requestedAt is not an ISO timestamp');
    if (!isIsoTimestamp(d.receivedAt)) return fail('draw.receivedAt is not an ISO timestamp');
    if (!isHex(d.commitment) || d.commitment.length !== 64) return fail('draw.commitment is not a sha256 hex digest');
    if (!d.attestation || typeof d.attestation !== 'object') return fail('draw.attestation missing');
    const bytes = hexToBytes(d.bytesHex);

    // --- draw <-> attestation binding
    const att = d.attestation;
    if (att.providerId !== d.providerId) return fail('attestation.providerId does not match draw.providerId');
    if (att.requestedAt !== d.requestedAt) return fail('attestation.requestedAt does not match draw.requestedAt');
    if (att.receivedAt !== d.receivedAt) return fail('attestation.receivedAt does not match draw.receivedAt');
    if (att.bytesSha256 !== sha256Hex(bytes)) return fail('attestation.bytesSha256 does not match draw bytes');

    // --- attestation signature
    const attResult = verifyAttestation(att, opts);
    if (!attResult.ok) return attResult;

    // --- commitment
    const expectedCommitment = computeCommitment({
      providerId: d.providerId,
      requestedAt: d.requestedAt,
      bytes,
      attestation: att,
    });
    if (expectedCommitment !== d.commitment) return fail('commitment does not recompute');

    // --- inputs
    if (!b.inputs || typeof b.inputs !== 'object') return fail('bundle.inputs missing');
    if (!isHex(b.inputs.hash) || b.inputs.hash.length !== 64) return fail('inputs.hash is not a sha256 hex digest');
    if (b.inputs.value === undefined) return fail('inputs.value missing');
    if (hashJson(b.inputs.value) !== b.inputs.hash) return fail('inputs.hash does not match inputs.value');

    // --- resolver
    if (resolver.id !== b.resolverId) {
      return fail(`bundle.resolverId is "${b.resolverId}" but the supplied resolver is "${resolver.id}"`);
    }
    if (!b.outcome || typeof b.outcome !== 'object') return fail('bundle.outcome missing');
    if (typeof b.outcome.label !== 'string') return fail('outcome.label missing');
    if (b.outcome.value === undefined) return fail('outcome.value missing');

    const recomputed = resolver.resolve(bytes, b.inputs.value);
    if (canonicalJson(recomputed.value) !== canonicalJson(b.outcome.value)) {
      return fail('outcome.value does not match what the resolver derives from the draw and inputs');
    }
    if (recomputed.label !== b.outcome.label) return fail('outcome.label does not match the resolver');

    return { ok: true };
  } catch (err) {
    return fail(`verification threw: ${(err as Error)?.message ?? String(err)}`);
  }
}

function fail(reason: string): VerifyResult {
  return { ok: false, reason };
}
