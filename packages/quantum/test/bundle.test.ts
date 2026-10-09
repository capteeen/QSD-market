import { beforeAll, describe, expect, it } from 'vitest';
import {
  bundleHash,
  createQrngClient,
  deserializeDraw,
  hashJson,
  parseBundle,
  serializeBundle,
  sha256Hex,
  UnsafeDevRandomProvider,
  verify,
  verifyBundle,
  type ProofBundle,
  type UnsafeDevAttestation,
} from '../src/index.js';
import { sampleInputs, testResolver, withNodeEnv, type TestInputs } from './helpers.js';

let provider: UnsafeDevRandomProvider;
let bundle: ProofBundle<TestInputs>;
const opts = { allowUnsafeDev: true };

beforeAll(async () => {
  provider = withNodeEnv('test', () => new UnsafeDevRandomProvider());
  const client = createQrngClient({ provider });
  const r = await client.measure(sampleInputs, testResolver);
  bundle = r.bundle;
});

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('proof bundle round trip', () => {
  it('verifies as produced', () => {
    expect(verifyBundle(bundle, testResolver, opts)).toEqual({ ok: true });
    expect(verify(bundle, testResolver, opts)).toEqual({ ok: true });
  });

  it('survives JSON.stringify / JSON.parse', () => {
    const text = JSON.stringify(bundle);
    const back = JSON.parse(text) as ProofBundle<TestInputs>;
    expect(verifyBundle(back, testResolver, opts)).toEqual({ ok: true });
    expect(back).toEqual(bundle);
  });

  it('survives canonical serializeBundle / parseBundle and hashes stably', () => {
    const text = serializeBundle(bundle);
    const back = parseBundle(text);
    expect(verifyBundle(back, testResolver, opts)).toEqual({ ok: true });
    expect(bundleHash(back)).toBe(bundleHash(bundle));
    // key order must not matter
    const reordered = Object.fromEntries(Object.entries(back).reverse()) as unknown as ProofBundle;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(back));
    expect(bundleHash(reordered)).toBe(bundleHash(bundle));
  });

  it('draw deserialises to the same bytes', () => {
    const d = deserializeDraw(bundle.draw);
    expect(sha256Hex(d.bytes)).toBe(bundle.draw.attestation.bytesSha256);
    expect(d.bytes.length).toBe(32);
  });

  it('inputs hash is sha256(canonical(inputs))', () => {
    expect(bundle.inputs.hash).toBe(hashJson(sampleInputs));
  });

  it('carries the resolver id and version', () => {
    expect(bundle.resolverId).toBe('test-resolver/v1');
    expect(bundle.version).toBe(1);
  });

  it('rejects unsafe-dev bundles unless explicitly allowed', () => {
    const r = verifyBundle(bundle, testResolver);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsafe-dev/);
  });
});

describe('verify() rejects every tamper variant', () => {
  const cases: Array<[string, (b: ProofBundle<TestInputs>) => void, RegExp]> = [
    [
      'bytes',
      (b) => {
        const first = (parseInt(b.draw.bytesHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0');
        b.draw.bytesHex = first + b.draw.bytesHex.slice(2);
      },
      /bytesSha256 does not match draw bytes/,
    ],
    [
      'bytes with bytesSha256 recomputed (signature catches it)',
      (b) => {
        const first = (parseInt(b.draw.bytesHex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0');
        b.draw.bytesHex = first + b.draw.bytesHex.slice(2);
        b.draw.attestation.bytesSha256 = sha256Hex(Uint8Array.from(Buffer.from(b.draw.bytesHex, 'hex')));
      },
      /signature does not verify/,
    ],
    ['commitment', (b) => { b.draw.commitment = 'ab' + b.draw.commitment.slice(2); }, /commitment does not recompute/],
    ['inputs value', (b) => { b.inputs.value.decayProgress = 0.99; }, /inputs.hash does not match/],
    [
      'inputs value with hash recomputed (outcome no longer derives)',
      (b) => {
        // Flip the outcome kind deterministically: x in [0,1), so decayProgress=0 forces
        // survive and decayProgress=1 forces collapse, whatever the draw was.
        const wasSurvive = (b.outcome.value as { kind: string }).kind === 'survive';
        b.inputs.value.decayProgress = wasSurvive ? 1 : 0;
        b.inputs.hash = hashJson(b.inputs.value);
      },
      /outcome.value does not match/,
    ],
    ['inputs hash', (b) => { b.inputs.hash = '00' + b.inputs.hash.slice(2); }, /inputs.hash does not match/],
    [
      'outcome value',
      (b) => {
        b.outcome.value = { kind: 'tunnel' };
      },
      /outcome.value does not match/,
    ],
    ['outcome label', (b) => { b.outcome.label = 'something-else'; }, /outcome.label does not match/],
    [
      'attestation signature',
      (b) => {
        b.draw.attestation.signature = '00'.repeat(64);
      },
      /signature does not verify/,
    ],
    [
      'attestation key',
      (b) => {
        (b.draw.attestation as UnsafeDevAttestation).ephemeralPublicKey = '11'.repeat(32);
      },
      /signature does not verify/,
    ],
    ['providerId on draw', (b) => { b.draw.providerId = 'anu-quantum-numbers'; }, /providerId does not match/],
    [
      'providerId on both draw and attestation',
      (b) => {
        b.draw.providerId = 'anu-quantum-numbers';
        b.draw.attestation.providerId = 'anu-quantum-numbers';
      },
      /signature does not verify|must have providerId/,
    ],
    ['requestedAt on draw', (b) => { b.draw.requestedAt = '2020-01-01T00:00:00.000Z'; }, /requestedAt does not match/],
    [
      'requestedAt on both',
      (b) => {
        b.draw.requestedAt = '2020-01-01T00:00:00.000Z';
        b.draw.attestation.requestedAt = '2020-01-01T00:00:00.000Z';
      },
      /signature does not verify/,
    ],
    ['receivedAt on draw', (b) => { b.draw.receivedAt = '2030-01-01T00:00:00.000Z'; }, /receivedAt does not match/],
    ['resolverId', (b) => { b.resolverId = 'other-resolver/v9'; }, /resolverId/],
    ['version', (b) => { (b as { version: number }).version = 2; }, /unsupported bundle version/],
    ['resolvedAt', (b) => { b.resolvedAt = 'yesterday'; }, /resolvedAt/],
    ['attestation kind', (b) => { (b.draw.attestation as { kind: string }).kind = 'witness-signed'; }, /./],
  ];

  for (const [name, mutate, reason] of cases) {
    it(`tampered ${name}`, () => {
      const t = clone(bundle);
      mutate(t);
      const r = verifyBundle(t, testResolver, opts);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
    });
  }

  it('rejects a resolver with a different id', () => {
    const r = verifyBundle(bundle, { ...testResolver, id: 'other' }, opts);
    expect(r.ok).toBe(false);
  });

  it('never throws on garbage input', () => {
    for (const g of [null, undefined, 42, 'bundle', [], {}, { version: 1 }, { version: 1, draw: {} }]) {
      const r = verifyBundle(g, testResolver, opts);
      expect(r.ok).toBe(false);
    }
  });

  it('never throws when the resolver throws', () => {
    const throwing = {
      id: testResolver.id,
      resolve: () => {
        throw new Error('boom');
      },
    };
    const r = verifyBundle(bundle, throwing, opts);
    expect(r).toEqual({ ok: false, reason: 'verification threw: boom' });
  });
});
