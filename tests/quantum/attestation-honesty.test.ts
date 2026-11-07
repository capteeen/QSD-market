/**
 * Spec §4: "Each draw returns … provider signature/attestation … No draw is
 * accepted without an attestation." Spec §10: check every claim.
 *
 * These tests probe the gap between what README/physics.md say an attestation
 * proves and what verify() actually checks. Tests marked FINDING fail by
 * design while the finding is open.
 */
import { describe, expect, it } from 'vitest';
import {
  AnuQuantumNumbersProvider,
  verify,
  verifyAttestation,
  computeCommitment,
  hashJson,
  sha256Hex,
  bytesToHex,
  signWitnessAttestation,
  ed25519SignerFromSeed,
  ephemeralEd25519Signer,
  createQrngClient,
  recordEvents,
  type ProofBundle,
  type OutcomeResolver,
  type ProviderSignedAttestation,
  type WitnessSignedAttestation,
} from '@qsd/quantum';
import { ed25519 } from '@noble/curves/ed25519';

type Inputs = { coin: string; p: number };
const resolver: OutcomeResolver<Inputs> = {
  id: 'h-resolver/v1',
  resolve: (bytes, inputs) => (bytes[0]! / 256 < inputs.p ? { value: { kind: 'collapse' }, label: 'collapse' } : { value: { kind: 'survive' }, label: 'survive' }),
};
const INPUTS: Inputs = { coin: 'COIN', p: 0.5 };

function anuBody(bytes: Uint8Array): string {
  return JSON.stringify({ success: true, type: 'hex8', length: String(bytes.length), data: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')) });
}

function fabricateWitnessBundle(bytes: Uint8Array, witnessSeed: Uint8Array): ProofBundle<Inputs> {
  const witness = ed25519SignerFromSeed(witnessSeed);
  const body = anuBody(bytes);
  const requestedAt = '2026-10-09T09:00:00.000Z';
  const receivedAt = '2026-10-09T09:00:00.100Z';
  const attestation = signWitnessAttestation(
    {
      kind: 'witness-signed',
      providerId: 'anu-quantum-numbers',
      requestedAt,
      receivedAt,
      bytesSha256: sha256Hex(bytes),
      transport: 'https',
      response: { status: 200, headers: {}, body, bodySha256: sha256Hex(new TextEncoder().encode(body)), url: 'https://api.quantumnumbers.com.au?length=32&type=hex8&size=1' },
    },
    witness,
  );
  const commitment = computeCommitment({ providerId: 'anu-quantum-numbers', requestedAt, bytes, attestation });
  return {
    version: 1,
    resolverId: resolver.id,
    draw: { bytesHex: bytesToHex(bytes), providerId: 'anu-quantum-numbers', requestedAt, receivedAt, attestation, commitment },
    inputs: { value: INPUTS, hash: hashJson(INPUTS) },
    outcome: resolver.resolve(bytes, INPUTS),
    resolvedAt: receivedAt,
  };
}

describe('witness-signed: who can produce an accepted bundle?', () => {
  it('FINDING H-Q1 (HIGH): with default options, verify() accepts a bundle fabricated from scratch by ANYONE with any key', () => {
    // No network, no ANU, no QSD key: pick the bytes you want, sign with a random key.
    const chosen = new Uint8Array(32); // bytes[0] = 0 → forces "collapse" under this resolver
    const attackerSeed = globalThis.crypto.getRandomValues(new Uint8Array(32)); // a key nobody published
    const forged = fabricateWitnessBundle(chosen, attackerSeed);
    const r = verify(forged, resolver); // the README's "anyone can run" call, no trusted keys
    // Required: the default verifier must not vouch for an unknown witness.
    expect(r.ok, 'verify() with no trusted key set must not return ok for a self-signed witness attestation').toBe(false);
  });

  it('with trustedWitnessKeys the forged bundle is rejected, and the honest one accepted', () => {
    const honestSeed = new Uint8Array(32).fill(1);
    const honestKey = ed25519SignerFromSeed(honestSeed).publicKey;
    const honest = fabricateWitnessBundle(new Uint8Array(32).fill(200), honestSeed);
    const forged = fabricateWitnessBundle(new Uint8Array(32), new Uint8Array(32).fill(2));
    expect(verify(honest, resolver, { trustedWitnessKeys: [honestKey] })).toEqual({ ok: true });
    expect(verify(forged, resolver, { trustedWitnessKeys: [honestKey] }).ok).toBe(false);
  });

  it('H-Q3 (HIGH, design): the witness key holder can grind — draw many times, publish the favourable one; verify() cannot tell', () => {
    const seed = new Uint8Array(32).fill(3);
    const key = ed25519SignerFromSeed(seed).publicKey;
    // "Operator" produces two perfectly valid attested draws for the same inputs and keeps the one it likes.
    const survive = fabricateWitnessBundle(new Uint8Array(32).fill(255), seed);
    const collapse = fabricateWitnessBundle(new Uint8Array(32).fill(0), seed);
    expect(verify(survive, resolver, { trustedWitnessKeys: [key] })).toEqual({ ok: true });
    expect(verify(collapse, resolver, { trustedWitnessKeys: [key] })).toEqual({ ok: true });
    // Nothing in either bundle binds the request to the inputs (inputs.hash is not in the attestation or commitment),
    // nor proves it was the only request. This is a protocol-level gap, recorded for Agents E/G and the physics copy.
    expect(JSON.stringify(survive.draw.attestation)).not.toContain(survive.inputs.hash);
    expect(survive.draw.commitment).toBe(computeCommitment({ providerId: survive.draw.providerId, requestedAt: survive.draw.requestedAt, bytes: new Uint8Array(32).fill(255), attestation: survive.draw.attestation }));
  });
});

describe('provider-signed: what does verify() actually check?', () => {
  it('FINDING H-Q2 (MEDIUM): a provider signature over an UNRELATED message passes; signedMessage is never bound to the body or the bytes', () => {
    const providerSk = new Uint8Array(32).fill(7);
    const providerPk = bytesToHex(ed25519.getPublicKey(providerSk));
    const bytes = new Uint8Array(32).fill(0);
    const body = anuBody(bytes);
    const unrelated = new TextEncoder().encode('hello world'); // what the "provider" actually signed
    const att: ProviderSignedAttestation = {
      kind: 'provider-signed',
      providerId: 'signing-provider',
      requestedAt: '2026-10-09T09:00:00.000Z',
      receivedAt: '2026-10-09T09:00:00.100Z',
      bytesSha256: sha256Hex(bytes),
      scheme: 'ed25519',
      publicKey: providerPk,
      signedMessage: bytesToHex(unrelated),
      signature: bytesToHex(ed25519.sign(unrelated, providerSk)),
      response: { status: 200, headers: {}, body, bodySha256: sha256Hex(new TextEncoder().encode(body)), url: 'https://example' },
    };
    const r = verifyAttestation(att, { trustedProviderKeys: [providerPk] });
    // Required: a provider-signed attestation must bind the signed message to the response body / bytes.
    expect(r.ok, 'provider-signed attestation with a signature over an unrelated message must be rejected').toBe(false);
  });
});

describe('ANU provider: attestation contents vs claims', () => {
  const witness = ed25519SignerFromSeed(new Uint8Array(32).fill(11));
  const bytes = new Uint8Array(16).map((_, i) => 0x10 + i);
  const body = anuBody(bytes);
  function fakeFetch(headers: Record<string, string> = {}): typeof fetch {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
      // make the key visible to the test so we can assert it never leaks
      (fakeFetch as unknown as { lastInit?: RequestInit | undefined }).lastInit = init;
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json', date: 'Thu, 09 Oct 2026 09:00:00 GMT', 'x-amzn-requestid': 'req-123', 'x-api-key': 'ECHOED-KEY', authorization: 'Bearer ECHOED', ...headers } });
    }) as typeof fetch;
  }

  it('a draw through a mocked ANU endpoint verifies only under the published witness key; the attestation is what the README says', async () => {
    const p = new AnuQuantumNumbersProvider({ apiKey: 'THE-SECRET-API-KEY', witness, fetch: fakeFetch() });
    const client = createQrngClient({ provider: p });
    const rec = recordEvents(client.bus);
    const { bundle, draw } = await client.measure(INPUTS, resolver, { nBytes: 16 });
    rec.stop();
    expect(draw.attestation.kind).toBe('witness-signed');
    const a = draw.attestation as WitnessSignedAttestation;
    expect(a.response.body).toBe(body);
    expect(a.response.headers).toEqual({ 'content-type': 'application/json', date: 'Thu, 09 Oct 2026 09:00:00 GMT', 'x-amzn-requestid': 'req-123' });
    expect(a.witnessPublicKey).toBe(witness.publicKey);
    expect(verify(bundle, resolver, { trustedWitnessKeys: [witness.publicKey] })).toEqual({ ok: true });
    expect(verify(bundle, resolver, { trustedWitnessKeys: [ephemeralEd25519Signer().publicKey] }).ok).toBe(false);
    // event order and payload equality
    expect(rec.events.map((e) => e.type)).toEqual(['entropyRequested', 'entropyArrived', 'commitmentComputed', 'outcomeResolved']);
    const arrived = rec.events[1] as { bytes: Uint8Array; attestation: unknown };
    expect(bytesToHex(arrived.bytes)).toBe(bundle.draw.bytesHex);
    expect((rec.events[2] as { hash: string }).hash).toBe(bundle.draw.commitment);
  });

  it('the attestation binds the body but nothing from ANU signs it: a different body with the same bytes is an equally valid attestation', async () => {
    // Shows concretely that "witness-signed" proves the witness's statement, not ANU's.
    const p1 = new AnuQuantumNumbersProvider({ apiKey: 'k', witness, fetch: fakeFetch({ 'x-amzn-requestid': 'A' }) });
    const p2 = new AnuQuantumNumbersProvider({ apiKey: 'k', witness, fetch: fakeFetch({ 'x-amzn-requestid': 'B' }) });
    const d1 = await p1.draw(16);
    const d2 = await p2.draw(16);
    expect(bytesToHex(d1.bytes)).toBe(bytesToHex(d2.bytes));
    expect(d1.commitment).not.toBe(d2.commitment); // commitments differ only because the witness statement differs
    expect(verifyAttestation(d1.attestation, { trustedWitnessKeys: [witness.publicKey] }).ok).toBe(true);
    expect(verifyAttestation(d2.attestation, { trustedWitnessKeys: [witness.publicKey] }).ok).toBe(true);
  });

  it('timestamps are operator-asserted: an attestation with requestedAt in 1999 verifies', async () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = function () { return '1999-12-31T23:59:59.000Z'; };
    try {
      const p = new AnuQuantumNumbersProvider({ apiKey: 'k', witness, fetch: fakeFetch() });
      const d = await p.draw(16);
      expect(d.requestedAt).toBe('1999-12-31T23:59:59.000Z');
      expect(verifyAttestation(d.attestation, { trustedWitnessKeys: [witness.publicKey] }).ok).toBe(true);
    } finally {
      Date.prototype.toISOString = original;
    }
  });
});
