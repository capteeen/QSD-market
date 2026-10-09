import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  ed25519SignerFromSeed,
  ephemeralEd25519Signer,
  sha256Hex,
  signUnsafeDevAttestation,
  signWitnessAttestation,
  verifyAttestation,
  type ProviderSignedAttestation,
  type WitnessSignedAttestation,
} from '../src/index.js';

const body = '{"success":true,"type":"hex8","length":"2","data":["ab","cd"]}';
const bytes = new Uint8Array([0xab, 0xcd]);

function makeWitness(signer = ephemeralEd25519Signer()): WitnessSignedAttestation {
  return signWitnessAttestation(
    {
      kind: 'witness-signed',
      providerId: 'anu-quantum-numbers',
      requestedAt: '2026-10-09T07:40:52.000Z',
      receivedAt: '2026-10-09T07:40:52.400Z',
      bytesSha256: sha256Hex(bytes),
      transport: 'https',
      response: {
        status: 200,
        headers: { date: 'Thu, 09 Oct 2026 07:40:52 GMT' },
        body,
        bodySha256: sha256Hex(new TextEncoder().encode(body)),
        url: 'https://api.quantumnumbers.com.au?length=2&type=hex8&size=1',
      },
    },
    signer,
  );
}

describe('witness-signed attestation', () => {
  it('verifies when untouched', () => {
    expect(verifyAttestation(makeWitness())).toEqual({ ok: true });
  });

  it('rejects a flipped signature byte', () => {
    const a = makeWitness();
    const sig = a.signature;
    const flipped = (parseInt(sig.slice(0, 2), 16) ^ 0x01).toString(16).padStart(2, '0') + sig.slice(2);
    const r = verifyAttestation({ ...a, signature: flipped });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/witness signature does not verify/);
  });

  it('rejects a signature from a different key', () => {
    const a = makeWitness();
    const other = makeWitness(ephemeralEd25519Signer());
    const r = verifyAttestation({ ...a, signature: other.signature });
    expect(r.ok).toBe(false);
  });

  it('rejects a key substitution (signature valid for other key but statement unchanged)', () => {
    const a = makeWitness();
    const r = verifyAttestation({ ...a, witnessPublicKey: ephemeralEd25519Signer().publicKey });
    expect(r.ok).toBe(false);
  });

  it('rejects when any signed field is altered', () => {
    const a = makeWitness();
    for (const mutated of [
      { ...a, requestedAt: '2026-10-09T07:40:51.000Z' },
      { ...a, receivedAt: '2026-10-09T07:40:53.000Z' },
      { ...a, providerId: 'someone-else' },
      { ...a, bytesSha256: sha256Hex(new Uint8Array([1])) },
      { ...a, response: { ...a.response, status: 201 } },
      { ...a, response: { ...a.response, headers: { date: 'x' } } },
    ]) {
      expect(verifyAttestation(mutated).ok).toBe(false);
    }
  });

  it('rejects a body edit even if bodySha256 is recomputed', () => {
    const a = makeWitness();
    const newBody = body.replace('ab', 'ac');
    const r = verifyAttestation({
      ...a,
      response: { ...a.response, body: newBody, bodySha256: sha256Hex(new TextEncoder().encode(newBody)) },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a body edit when bodySha256 is not recomputed', () => {
    const a = makeWitness();
    const r = verifyAttestation({ ...a, response: { ...a.response, body: body + ' ' } });
    expect(r).toEqual({ ok: false, reason: 'attestation.response.bodySha256 does not match body' });
  });

  it('enforces the trusted witness key set when supplied', () => {
    const signer = ephemeralEd25519Signer();
    const a = makeWitness(signer);
    expect(verifyAttestation(a, { trustedWitnessKeys: [signer.publicKey] }).ok).toBe(true);
    const r = verifyAttestation(a, { trustedWitnessKeys: [ephemeralEd25519Signer().publicKey] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not in the trusted witness key set/);
  });

  it('rejects receivedAt before requestedAt', () => {
    const a = makeWitness();
    expect(verifyAttestation({ ...a, receivedAt: '2026-10-09T07:40:51.000Z' }).ok).toBe(false);
  });

  it('is deterministic for a fixed seed', () => {
    const seed = new Uint8Array(32).fill(7);
    const a1 = makeWitness(ed25519SignerFromSeed(seed));
    const a2 = makeWitness(ed25519SignerFromSeed(seed));
    expect(a1).toEqual(a2);
  });
});

describe('provider-signed attestation', () => {
  function makeProviderSigned(): ProviderSignedAttestation {
    // Simulates a provider that signs its raw response body with Ed25519.
    const providerKey = ephemeralEd25519Signer();
    const msg = new TextEncoder().encode(body);
    return {
      kind: 'provider-signed',
      providerId: 'hypothetical-signing-provider',
      requestedAt: '2026-10-09T07:40:52.000Z',
      receivedAt: '2026-10-09T07:40:52.400Z',
      bytesSha256: sha256Hex(bytes),
      scheme: 'ed25519',
      publicKey: providerKey.publicKey,
      signedMessage: bytesToHex(msg),
      signature: bytesToHex(providerKey.sign(msg)),
      response: {
        status: 200,
        headers: {},
        body,
        bodySha256: sha256Hex(msg),
        url: 'https://example.invalid/qrng',
      },
    };
  }

  it('verifies a correct signature', () => {
    expect(verifyAttestation(makeProviderSigned())).toEqual({ ok: true });
  });

  it('rejects a bad signature', () => {
    const a = makeProviderSigned();
    const r = verifyAttestation({ ...a, signature: 'ff' + a.signature.slice(2) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/provider signature does not verify/);
  });

  it('rejects an altered signed message', () => {
    const a = makeProviderSigned();
    const r = verifyAttestation({ ...a, signedMessage: a.signedMessage.slice(0, -2) + '00' });
    expect(r.ok).toBe(false);
  });

  it('rejects unsupported schemes', () => {
    const a = makeProviderSigned();
    const r = verifyAttestation({ ...a, scheme: 'rsa-pss' as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported provider signature scheme/);
  });

  it('enforces the trusted provider key set when supplied', () => {
    const a = makeProviderSigned();
    expect(verifyAttestation(a, { trustedProviderKeys: [a.publicKey] }).ok).toBe(true);
    expect(verifyAttestation(a, { trustedProviderKeys: ['00'.repeat(32)] }).ok).toBe(false);
  });
});

describe('unsafe-dev attestation', () => {
  function makeDev(signer = ephemeralEd25519Signer()) {
    return signUnsafeDevAttestation(
      {
        kind: 'unsafe-dev',
        providerId: 'UNSAFE_DEV_RANDOM',
        requestedAt: '2026-10-09T07:40:52.000Z',
        receivedAt: '2026-10-09T07:40:52.000Z',
        bytesSha256: sha256Hex(bytes),
        warning: 'dev only',
      },
      signer,
    );
  }

  it('is rejected by default', () => {
    const r = verifyAttestation(makeDev());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsafe-dev attestation is not accepted/);
  });

  it('verifies only when explicitly allowed', () => {
    expect(verifyAttestation(makeDev(), { allowUnsafeDev: true })).toEqual({ ok: true });
  });

  it('rejects a bad signature even when allowed', () => {
    const a = makeDev();
    const r = verifyAttestation({ ...a, signature: '00'.repeat(64) }, { allowUnsafeDev: true });
    expect(r.ok).toBe(false);
  });
});

describe('verifyAttestation never throws', () => {
  it('handles garbage', () => {
    for (const g of [null, undefined, 1, 'x', [], {}, { kind: 'witness-signed' }, { kind: 'nope' }]) {
      const r = verifyAttestation(g);
      expect(r.ok).toBe(false);
    }
  });
});
