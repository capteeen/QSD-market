/**
 * Spec §4: "A dev-only provider … UNSAFE_DEV_RANDOM … is impossible to enable
 * when NODE_ENV=production (test this)." Spec §10: "Attempt to enable the dev
 * random provider in production. Must be impossible."
 *
 * Tests that FAIL here are real gaps in the guard; see /docs/security.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProviderFromEnv,
  createQrngClient,
  ProductionGuardError,
  UnsafeDevRandomProvider,
  UNSAFE_DEV_RANDOM_ID,
  verify,
  signUnsafeDevAttestation,
  ephemeralEd25519Signer,
  computeCommitment,
  sha256Hex,
  nowIso,
  type Draw,
  type QrngProvider,
  type OutcomeResolver,
} from '@qsd/quantum';

const resolver: OutcomeResolver<{ n: number }> = {
  id: 'h-test/v1',
  resolve: (bytes, inputs) => ({ value: { pick: bytes[0]! % inputs.n }, label: `pick-${bytes[0]! % inputs.n}` }),
};

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.NODE_ENV;
});
afterEach(() => {
  if (savedEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
  else Object.assign(process.env, { NODE_ENV: savedEnv });
});

describe('guard: exact NODE_ENV=production', () => {
  it('constructor throws ProductionGuardError', () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
  });

  it('constructed in test, then NODE_ENV flipped to production: draw() throws', async () => {
    Object.assign(process.env, { NODE_ENV: 'test' });
    const p = new UnsafeDevRandomProvider();
    Object.assign(process.env, { NODE_ENV: 'production' });
    await expect(p.draw(8)).rejects.toThrow(ProductionGuardError);
    // and through the client too
    const client = createQrngClient({ provider: p });
    await expect(client.measure({ n: 3 }, resolver)).rejects.toThrow(ProductionGuardError);
  });

  it('createProviderFromEnv({QSD_QRNG_PROVIDER:"UNSAFE_DEV_RANDOM"}) throws', () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    expect(() => createProviderFromEnv({ QSD_QRNG_PROVIDER: 'UNSAFE_DEV_RANDOM' })).toThrow(ProductionGuardError);
    expect(() => createProviderFromEnv({ QSD_QRNG_PROVIDER: ' UNSAFE_DEV_RANDOM ' })).toThrow(ProductionGuardError);
  });

  it('an injected env claiming NODE_ENV=test cannot override the real production env', () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    expect(() =>
      createProviderFromEnv({ QSD_QRNG_PROVIDER: 'UNSAFE_DEV_RANDOM', NODE_ENV: 'test' }),
    ).toThrow(ProductionGuardError);
  });

  it('createProviderFromEnv never silently returns the dev provider when the real provider is misconfigured', () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    expect(() => createProviderFromEnv({})).toThrow();
    expect(() => createProviderFromEnv({ QSD_QRNG_API_KEY: 'k' })).toThrow();
    expect(() => createProviderFromEnv({ QSD_QRNG_PROVIDER: 'unsafe_dev_random' })).toThrow();
  });
});

describe('guard: case / whitespace variants of NODE_ENV', () => {
  // Node, Next.js, Vercel, Docker images all set the literal 'production'. The
  // guard compares with ===. These variants are reported as LOW (H-Q5): a
  // misconfigured platform can leave the dev provider constructible.
  for (const v of ['Production', 'PRODUCTION', ' production', 'production ', 'prod']) {
    it(`FINDING H-Q5 (LOW): NODE_ENV=${JSON.stringify(v)} should still be treated as production`, () => {
      Object.assign(process.env, { NODE_ENV: v });
      expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
    });
  }
});

describe('guard: fail-open when NODE_ENV is absent or process is absent', () => {
  it('FINDING H-Q4 (HIGH): with NODE_ENV unset the dev provider is constructible and usable', async () => {
    // A bare `node worker.js` in a container that forgot NODE_ENV gets non-quantum randomness.
    // The guard is "deny if production" not "allow only if development/test".
    Reflect.deleteProperty(process.env, 'NODE_ENV');
    expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
  });

  it('FINDING H-Q4 (HIGH): when globalThis.process is missing (browser bundle), the guard is inert', async () => {
    // Bundlers replace the literal token `process.env.NODE_ENV`; the guard reads
    // `(globalThis as any).process?.env?.NODE_ENV` dynamically, which is not replaced.
    // In a browser there is no `process`, so isProduction() is false in a production build.
    const realProcess = globalThis.process;
    try {
      // @ts-expect-error simulate a browser global scope
      delete globalThis.process;
      expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
    } finally {
      globalThis.process = realProcess;
    }
  });

  it('Object.defineProperty / replacing globalThis.process bypasses the guard (INFO: equivalent to code execution)', () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    const realProcess = globalThis.process;
    try {
      globalThis.process = { env: { NODE_ENV: 'test' } } as unknown as NodeJS.Process;
      // Anyone who can do this can do anything; documented, not a finding.
      expect(() => new UnsafeDevRandomProvider()).not.toThrow();
    } finally {
      globalThis.process = realProcess;
    }
    expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
  });
});

describe('a hand-rolled provider claiming the UNSAFE_DEV_RANDOM id', () => {
  it('createQrngClient accepts any object with id+draw, but verify() rejects its unsafe-dev bundles without allowUnsafeDev', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    const signer = ephemeralEd25519Signer();
    const fake: QrngProvider = {
      id: UNSAFE_DEV_RANDOM_ID,
      attestationKind: 'unsafe-dev',
      async draw(nBytes): Promise<Draw> {
        const bytes = new Uint8Array(nBytes).fill(7);
        const requestedAt = nowIso();
        const attestation = signUnsafeDevAttestation(
          { kind: 'unsafe-dev', providerId: 'UNSAFE_DEV_RANDOM', requestedAt, receivedAt: requestedAt, bytesSha256: sha256Hex(bytes), warning: 'x' },
          signer,
        );
        return { bytes, providerId: this.id, requestedAt, receivedAt: requestedAt, attestation, commitment: computeCommitment({ providerId: this.id, requestedAt, bytes, attestation }) };
      },
    };
    const client = createQrngClient({ provider: fake }); // no guard on the client side — by design, the guard is on the provider
    const { bundle } = await client.measure({ n: 5 }, resolver);
    expect(verify(bundle, resolver)).toEqual({ ok: false, reason: expect.stringContaining('unsafe-dev') });
    expect(verify(bundle, resolver, { allowUnsafeDev: true })).toEqual({ ok: true });
    // A production verifier that passes trusted witness keys still rejects it:
    expect(verify(bundle, resolver, { trustedWitnessKeys: ['00'.repeat(32)] }).ok).toBe(false);
  });

  it('a hand-rolled provider that returns NO attestation is refused by the client', async () => {
    const bare = {
      id: 'rogue',
      attestationKind: 'witness-signed',
      async draw(nBytes: number) {
        const bytes = new Uint8Array(nBytes);
        return { bytes, providerId: 'rogue', requestedAt: nowIso(), receivedAt: nowIso(), commitment: '00'.repeat(32) } as unknown as Draw;
      },
    } as QrngProvider;
    await expect(createQrngClient({ provider: bare }).draw(4)).rejects.toThrow(/without an attestation/);
  });
});
