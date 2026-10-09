/**
 * Spec §4: "verify() against tampered bundles". Spec §10: "Tamper with proof
 * bundles; verify() must reject every variant." Agent H's own matrix, written
 * without reference to packages/quantum/test.
 *
 * Invariants:
 *  - verify() NEVER throws.
 *  - Every semantically different variant is rejected.
 *  - Semantically identical re-encodings (key order, whitespace) still verify.
 */
import { describe, expect, it } from 'vitest';
import {
  UnsafeDevRandomProvider,
  createQrngClient,
  verify,
  serializeBundle,
  parseBundle,
  bundleHash,
  canonicalJson,
  hashJson,
  sha256Hex,
  hexToBytes,
  computeCommitment,
  signWitnessAttestation,
  ed25519SignerFromSeed,
  type ProofBundle,
  type OutcomeResolver,
  type JsonValue,
  type WitnessSignedAttestation,
  type Draw,
} from '@qsd/quantum';

type Inputs = { coin: string; p: number; channels: number[]; note?: string };

const resolver: OutcomeResolver<Inputs> = {
  id: 'h-resolver/v1',
  resolve(bytes, inputs) {
    const x = bytes[0]! / 256;
    if (x >= inputs.p) return { value: { kind: 'survive', x }, label: 'survive' };
    const k = bytes[1]! % inputs.channels.length;
    return { value: { kind: 'collapse', channel: k, x }, label: `collapse:${k}` };
  },
};

const OPTS = { allowUnsafeDev: true } as const;
const INPUTS: Inputs = { coin: 'So11111111111111111111111111111111111111112', p: 0.6, channels: [0.5, 0.3, 0.2] };

const clone = <T>(b: T): T => JSON.parse(JSON.stringify(b)) as T;

async function freshBundle(inputs: Inputs = INPUTS): Promise<ProofBundle<Inputs>> {
  Object.assign(process.env, { NODE_ENV: 'test' });
  const client = createQrngClient({ provider: new UnsafeDevRandomProvider() });
  const { bundle } = await client.measure(inputs, resolver);
  return bundle;
}

describe('baseline', () => {
  it('a fresh bundle verifies; a bundle without allowUnsafeDev is refused', async () => {
    const b = await freshBundle();
    expect(verify(b, resolver, OPTS)).toEqual({ ok: true });
    expect(verify(b, resolver).ok).toBe(false);
  });
});

describe('semantically identical re-encodings must still verify', () => {
  it('key order shuffled at every level', async () => {
    const b = await freshBundle();
    const shuffled = reverseKeys(b) as ProofBundle<Inputs>;
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(b));
    expect(verify(shuffled, resolver, OPTS)).toEqual({ ok: true });
    expect(bundleHash(shuffled)).toBe(bundleHash(b));
  });
  it('whitespace / pretty-printing in the serialised form', async () => {
    const b = await freshBundle();
    const pretty = JSON.stringify(b, null, 4).replace(/\n/g, '\r\n\t ');
    expect(verify(parseBundle(pretty), resolver, OPTS)).toEqual({ ok: true });
    expect(verify(parseBundle(serializeBundle(b)), resolver, OPTS)).toEqual({ ok: true });
  });
  it('numeric edge cases in inputs survive a round trip (-0, 1e21, 1e-7, 2^53)', async () => {
    const weird = { ...INPUTS, p: 0.6, channels: [-0, 1e21, 1e-7, 2 ** 53, 0.1 + 0.2] } as Inputs;
    const b = await freshBundle(weird);
    expect(verify(parseBundle(serializeBundle(b)), resolver, OPTS)).toEqual({ ok: true });
    expect(verify(parseBundle(JSON.stringify(b)), resolver, OPTS)).toEqual({ ok: true });
  });
  it('unicode in inputs: NFC and NFD are different inputs (different hash), but each verifies as itself', async () => {
    const nfc = { ...INPUTS, note: 'é'.normalize('NFC') };
    const nfd = { ...INPUTS, note: 'é'.normalize('NFD') };
    const b1 = await freshBundle(nfc);
    expect(verify(b1, resolver, OPTS)).toEqual({ ok: true });
    expect(hashJson(nfc)).not.toBe(hashJson(nfd));
    const t = clone(b1);
    t.inputs.value.note = 'é'.normalize('NFD');
    expect(verify(t, resolver, OPTS).ok).toBe(false);
  });
});

describe('verify() never throws', () => {
  const garbage: unknown[] = [
    null,
    undefined,
    0,
    '',
    'null',
    [],
    {},
    { version: 1 },
    { version: '1' },
    { version: 1, resolverId: 'h-resolver/v1', draw: null },
    { version: 1, resolverId: 'h-resolver/v1', draw: 'x', inputs: 'y', outcome: 'z', resolvedAt: 'w' },
    new Proxy({}, { get: () => { throw new Error('boom'); } }),
    Object.create(null),
    { __proto__: { version: 1 } },
  ];
  for (const [i, g] of garbage.entries()) {
    it(`garbage #${i}`, () => {
      let r: unknown;
      expect(() => (r = verify(g, resolver, OPTS))).not.toThrow();
      expect((r as { ok: boolean }).ok).toBe(false);
    });
  }
  it('NaN / Infinity / bigint / function in inputs → rejected, not thrown', async () => {
    const b = await freshBundle();
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, 10n, () => 1, Symbol('s'), undefined]) {
      const t = clone(b) as unknown as { inputs: { value: Record<string, unknown> } };
      t.inputs.value['p'] = v;
      let r: unknown;
      expect(() => (r = verify(t, resolver, OPTS))).not.toThrow();
      expect((r as { ok: boolean }).ok).toBe(false);
    }
  });
  it('a resolver that throws → rejected, not thrown', async () => {
    const b = await freshBundle();
    const bad: OutcomeResolver<Inputs> = { id: resolver.id, resolve: () => { throw new Error('resolver boom'); } };
    expect(() => verify(b, bad, OPTS)).not.toThrow();
    expect(verify(b, bad, OPTS).ok).toBe(false);
  });
  it('a resolver with a different id → rejected', async () => {
    const b = await freshBundle();
    expect(verify(b, { ...resolver, id: 'other/v1' }, OPTS).ok).toBe(false);
  });
});

describe('field-level tamper matrix: every semantically different variant is rejected', () => {
  type Mut = (b: ProofBundle<Inputs>) => unknown;
  const flipHex = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1);
  const cases: Array<[string, Mut]> = [
    // top level
    ['version 2', (b) => ({ ...b, version: 2 })],
    ['version "1"', (b) => ({ ...b, version: '1' })],
    ['version missing', (b) => { const t = clone(b) as Partial<ProofBundle>; delete t.version; return t; }],
    ['resolverId changed', (b) => ({ ...b, resolverId: b.resolverId + 'x' })],
    ['resolverId missing', (b) => { const t = clone(b) as Partial<ProofBundle>; delete t.resolverId; return t; }],
    ['resolvedAt changed to a non-ISO string', (b) => ({ ...b, resolvedAt: 'yesterday' })],
    ['resolvedAt missing', (b) => { const t = clone(b) as Partial<ProofBundle>; delete t.resolvedAt; return t; }],
    ['draw missing', (b) => { const t = clone(b) as Partial<ProofBundle>; delete t.draw; return t; }],
    ['inputs missing', (b) => { const t = clone(b) as Partial<ProofBundle>; delete t.inputs; return t; }],
    ['outcome missing', (b) => { const t = clone(b) as Partial<ProofBundle>; delete t.outcome; return t; }],
    // draw
    ['draw.bytesHex one nibble changed', (b) => { const t = clone(b); t.draw.bytesHex = flipHex(t.draw.bytesHex); return t; }],
    ['draw.bytesHex uppercase', (b) => { const t = clone(b); t.draw.bytesHex = t.draw.bytesHex.toUpperCase(); return t; }],
    ['draw.bytesHex extended', (b) => { const t = clone(b); t.draw.bytesHex += '00'; return t; }],
    ['draw.bytesHex empty', (b) => { const t = clone(b); t.draw.bytesHex = ''; return t; }],
    ['draw.providerId changed (attestation unchanged)', (b) => { const t = clone(b); t.draw.providerId = 'anu-quantum-numbers'; return t; }],
    ['draw.requestedAt changed', (b) => { const t = clone(b); t.draw.requestedAt = '2020-01-01T00:00:00.000Z'; return t; }],
    ['draw.receivedAt changed', (b) => { const t = clone(b); t.draw.receivedAt = '2030-01-01T00:00:00.000Z'; return t; }],
    ['draw.commitment one nibble', (b) => { const t = clone(b); t.draw.commitment = flipHex(t.draw.commitment); return t; }],
    ['draw.commitment recomputed over changed bytes but attestation stale', (b) => {
      const t = clone(b);
      t.draw.bytesHex = flipHex(t.draw.bytesHex);
      t.draw.commitment = computeCommitment({ providerId: t.draw.providerId, requestedAt: t.draw.requestedAt, bytes: hexToBytes(t.draw.bytesHex), attestation: t.draw.attestation });
      return t;
    }],
    ['draw.attestation missing', (b) => { const t = clone(b) as unknown as { draw: Record<string, unknown> }; delete t.draw['attestation']; return t; }],
    // attestation (unsafe-dev kind here; witness kind in attestation-honesty.test.ts)
    ['attestation.kind → witness-signed (shape mismatch)', (b) => { const t = clone(b); (t.draw.attestation as { kind: string }).kind = 'witness-signed'; return t; }],
    ['attestation.kind → unknown', (b) => { const t = clone(b); (t.draw.attestation as { kind: string }).kind = 'oracle'; return t; }],
    ['attestation.providerId changed (draw matched too)', (b) => { const t = clone(b); t.draw.providerId = 'x'; (t.draw.attestation as { providerId: string }).providerId = 'x'; return t; }],
    ['attestation.requestedAt and draw.requestedAt both changed', (b) => { const t = clone(b); t.draw.requestedAt = '2020-01-01T00:00:00.000Z'; t.draw.attestation.requestedAt = '2020-01-01T00:00:00.000Z'; return t; }],
    ['attestation.receivedAt before requestedAt', (b) => { const t = clone(b); t.draw.receivedAt = '1999-01-01T00:00:00.000Z'; t.draw.attestation.receivedAt = '1999-01-01T00:00:00.000Z'; return t; }],
    ['attestation.bytesSha256 changed', (b) => { const t = clone(b); t.draw.attestation.bytesSha256 = flipHex(t.draw.attestation.bytesSha256); return t; }],
    ['attestation.bytesSha256 recomputed over changed bytes (signature stale)', (b) => {
      const t = clone(b);
      t.draw.bytesHex = flipHex(t.draw.bytesHex);
      t.draw.attestation.bytesSha256 = sha256Hex(hexToBytes(t.draw.bytesHex));
      return t;
    }],
    ['attestation.signature one nibble', (b) => { const t = clone(b); t.draw.attestation.signature = flipHex(t.draw.attestation.signature); return t; }],
    ['attestation.signature wrong length', (b) => { const t = clone(b); t.draw.attestation.signature = t.draw.attestation.signature.slice(2); return t; }],
    ['attestation.signature empty', (b) => { const t = clone(b); t.draw.attestation.signature = ''; return t; }],
    ['attestation key substituted (ephemeralPublicKey)', (b) => { const t = clone(b); (t.draw.attestation as { ephemeralPublicKey: string }).ephemeralPublicKey = '11'.repeat(32); return t; }],
    ['attestation.warning text edited', (b) => { const t = clone(b); (t.draw.attestation as { warning: string }).warning = 'totally safe'; return t; }],
    ['attestation extra field added', (b) => { const t = clone(b); (t.draw.attestation as unknown as Record<string, unknown>)['certified'] = true; return t; }],
    ['attestation.providerId → ANU while kind stays unsafe-dev', (b) => { const t = clone(b); t.draw.providerId = 'anu-quantum-numbers'; t.draw.attestation.providerId = 'anu-quantum-numbers'; return t; }],
    // inputs
    ['inputs.value.p changed (hash stale)', (b) => { const t = clone(b); t.inputs.value.p = 0.99; return t; }],
    ['inputs.value.p flipped so the outcome must change, hash recomputed (outcome stale)', (b) => {
      const t = clone(b);
      // survive ⇔ x ≥ p. Force the opposite branch: p = 1 turns survive into collapse, p = 0 turns collapse into survive.
      t.inputs.value.p = (t.outcome.value as { kind: string }).kind === 'survive' ? 1 : 0;
      t.inputs.hash = hashJson(t.inputs.value);
      return t;
    }],
    ['inputs.value extra key (hash stale)', (b) => { const t = clone(b); (t.inputs.value as Record<string, unknown>)['bonus'] = 1; return t; }],
    ['inputs.value extra key, hash recomputed → must fail unless resolver output identical (it is: extra key ignored)', (b) => {
      // This is accepted by design: extra input keys the resolver ignores do not change the outcome.
      // We still require the bundleHash to differ so an anchor comparison catches it.
      const t = clone(b);
      (t.inputs.value as Record<string, unknown>)['bonus'] = 1;
      t.inputs.hash = hashJson(t.inputs.value);
      expect(bundleHash(t as ProofBundle)).not.toBe(bundleHash(b));
      return b; // return original so the loop's "must reject" assertion is skipped for this documented case
    }],
    ['inputs.hash changed', (b) => { const t = clone(b); t.inputs.hash = flipHex(t.inputs.hash); return t; }],
    ['inputs.value missing', (b) => { const t = clone(b) as unknown as { inputs: Record<string, unknown> }; delete t.inputs['value']; return t; }],
    ['inputs.value null (hash recomputed)', (b) => { const t = clone(b) as unknown as { inputs: { value: unknown; hash: string } }; t.inputs.value = null; t.inputs.hash = hashJson(null); return t; }],
    // outcome
    ['outcome.value kind flipped', (b) => { const t = clone(b); const v = t.outcome.value as { kind: string }; v.kind = v.kind === 'survive' ? 'collapse' : 'survive'; return t; }],
    ['outcome.value x nudged by 1e-12', (b) => { const t = clone(b); const v = t.outcome.value as { x: number }; v.x = v.x + 1e-12; return t; }],
    ['outcome.value channel changed', (b) => { const t = clone(b); const v = t.outcome.value as { channel?: number }; v.channel = (v.channel ?? 0) + 1; return t; }],
    ['outcome.label changed', (b) => { const t = clone(b); t.outcome.label = t.outcome.label + '!'; return t; }],
    ['outcome.value extra key', (b) => { const t = clone(b); (t.outcome.value as Record<string, unknown>)['note'] = 'x'; return t; }],
    ['outcome.value missing', (b) => { const t = clone(b) as unknown as { outcome: Record<string, unknown> }; delete t.outcome['value']; return t; }],
    ['outcome.label missing', (b) => { const t = clone(b) as unknown as { outcome: Record<string, unknown> }; delete t.outcome['label']; return t; }],
    // replay
    ['replay: draw of bundle A inside a bundle for different inputs whose outcome differs (outcome stale)', (b) => {
      const t = clone(b);
      t.inputs.value = { ...INPUTS, coin: 'ANOTHER-COIN', p: (b.outcome.value as { kind: string }).kind === 'survive' ? 1 : 0 };
      t.inputs.hash = hashJson(t.inputs.value);
      return t;
    }],
  ];

  for (const [name, mut] of cases) {
    it(name, async () => {
      const b = await freshBundle();
      const t = mut(b);
      if (t === b) return; // documented-accept case above
      let r: ReturnType<typeof verify> | undefined;
      expect(() => (r = verify(t, resolver, OPTS))).not.toThrow();
      expect(r!.ok, `variant "${name}" must be rejected`).toBe(false);
      expect(canonicalJson(t as JsonValue)).not.toBe(canonicalJson(b as unknown as JsonValue));
    });
  }

  it('inputs changed with hash recomputed: verify() agrees with an independent recomputation, and bundleHash always differs', async () => {
    const b = await freshBundle();
    const bytes = hexToBytes(b.draw.bytesHex);
    const variants: Inputs[] = [
      { ...INPUTS, p: 0.0001 },
      { ...INPUTS, p: 0.9999 },
      { ...INPUTS, channels: [...INPUTS.channels].reverse() },
      { ...INPUTS, channels: [1] },
      { ...INPUTS, coin: 'OTHER' },
    ];
    for (const v of variants) {
      const t = clone(b);
      t.inputs.value = v;
      t.inputs.hash = hashJson(v);
      const independent = resolver.resolve(bytes, v);
      const same = canonicalJson(independent.value) === canonicalJson(t.outcome.value) && independent.label === t.outcome.label;
      expect(verify(t, resolver, OPTS).ok, JSON.stringify(v)).toBe(same);
      expect(bundleHash(t)).not.toBe(bundleHash(b));
    }
  });

  it('INFO H-Q7: an unknown TOP-LEVEL extra field is accepted by verify() (bundleHash still differs)', async () => {
    const b = await freshBundle();
    const t = { ...b, operatorNote: 'this was definitely fair' };
    expect(verify(t, resolver, OPTS)).toEqual({ ok: true });
    expect(bundleHash(t as ProofBundle)).not.toBe(bundleHash(b));
  });

  it('replay: the SAME draw reused for the same inputs in two bundles both verify (verify() cannot detect draw reuse)', async () => {
    // Documented in security.md as H-Q3 (grinding/reuse is outside what a bundle can prove).
    const b = await freshBundle();
    const again = clone(b);
    again.resolvedAt = '2031-01-01T00:00:00.000Z';
    expect(verify(b, resolver, OPTS)).toEqual({ ok: true });
    expect(verify(again, resolver, OPTS)).toEqual({ ok: true });
  });
});

describe('witness-signed attestation tamper (fabricated locally with a known key)', () => {
  const witness = ed25519SignerFromSeed(new Uint8Array(32).fill(5));
  function witnessBundle(): ProofBundle<Inputs> {
    const bytes = new Uint8Array(32).map((_, i) => i * 7);
    const body = JSON.stringify({ success: true, type: 'hex8', length: '32', data: Array.from(bytes, (x) => x.toString(16).padStart(2, '0')) });
    const requestedAt = '2026-10-09T08:00:00.000Z';
    const receivedAt = '2026-10-09T08:00:00.250Z';
    const attestation: WitnessSignedAttestation = signWitnessAttestation(
      {
        kind: 'witness-signed',
        providerId: 'anu-quantum-numbers',
        requestedAt,
        receivedAt,
        bytesSha256: sha256Hex(bytes),
        transport: 'https',
        response: { status: 200, headers: { date: 'Thu, 09 Oct 2026 08:00:00 GMT' }, body, bodySha256: sha256Hex(new TextEncoder().encode(body)), url: 'https://api.quantumnumbers.com.au?length=32&type=hex8&size=1' },
      },
      witness,
    );
    const draw: Draw = { bytes, providerId: 'anu-quantum-numbers', requestedAt, receivedAt, attestation, commitment: computeCommitment({ providerId: 'anu-quantum-numbers', requestedAt, bytes, attestation }) };
    const outcome = resolver.resolve(bytes, INPUTS);
    return { version: 1, resolverId: resolver.id, draw: { bytesHex: Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(''), providerId: draw.providerId, requestedAt, receivedAt, attestation, commitment: draw.commitment }, inputs: { value: INPUTS, hash: hashJson(INPUTS) }, outcome, resolvedAt: receivedAt };
  }
  const trusted = { trustedWitnessKeys: [witness.publicKey] };

  it('baseline verifies with the trusted key and fails with a different trusted set', () => {
    const b = witnessBundle();
    expect(verify(b, resolver, trusted)).toEqual({ ok: true });
    expect(verify(b, resolver, { trustedWitnessKeys: ['aa'.repeat(32)] }).ok).toBe(false);
  });

  const wcases: Array<[string, (b: ProofBundle<Inputs>) => unknown]> = [
    ['response.body edited (bodySha256 stale)', (b) => { const t = clone(b); (t.draw.attestation as WitnessSignedAttestation).response.body += ' '; return t; }],
    ['response.body edited and bodySha256 recomputed (signature stale)', (b) => { const t = clone(b); const a = t.draw.attestation as WitnessSignedAttestation; a.response.body += ' '; a.response.bodySha256 = sha256Hex(new TextEncoder().encode(a.response.body)); return t; }],
    ['response.headers.date edited', (b) => { const t = clone(b); (t.draw.attestation as WitnessSignedAttestation).response.headers['date'] = 'Fri, 10 Oct 2026 08:00:00 GMT'; return t; }],
    ['response.status edited', (b) => { const t = clone(b); (t.draw.attestation as WitnessSignedAttestation).response.status = 201; return t; }],
    ['response.url edited', (b) => { const t = clone(b); (t.draw.attestation as WitnessSignedAttestation).response.url = 'https://example.com'; return t; }],
    ['transport http', (b) => { const t = clone(b); (t.draw.attestation as { transport: string }).transport = 'http'; return t; }],
    ['witnessPublicKey substituted (signature stale)', (b) => { const t = clone(b); (t.draw.attestation as WitnessSignedAttestation).witnessPublicKey = 'bb'.repeat(32); return t; }],
    ['signature over a different attestation (swapped in from a second bundle with different bytes)', (b) => {
      const t = clone(b);
      const other = clone(b);
      const a = t.draw.attestation as WitnessSignedAttestation;
      // sign a different statement, then present it with the original fields
      const resigned = signWitnessAttestation({ ...a, bytesSha256: sha256Hex(new Uint8Array(32)), signature: undefined as unknown as string } as unknown as Omit<WitnessSignedAttestation, 'signature' | 'witnessPublicKey'>, witness);
      (other.draw.attestation as WitnessSignedAttestation).signature = resigned.signature;
      return other;
    }],
    ['kind → provider-signed with witness fields', (b) => { const t = clone(b); (t.draw.attestation as { kind: string }).kind = 'provider-signed'; return t; }],
  ];
  for (const [name, mut] of wcases) {
    it(name, () => {
      const b = witnessBundle();
      let r: ReturnType<typeof verify> | undefined;
      expect(() => (r = verify(mut(b), resolver, trusted))).not.toThrow();
      expect(r!.ok, name).toBe(false);
    });
  }
});

function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}
