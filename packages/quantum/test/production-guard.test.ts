import { describe, expect, it } from 'vitest';
import {
  createProviderFromEnv,
  ENV,
  ProductionGuardError,
  QuantumConfigError,
  UnsafeDevRandomProvider,
  UNSAFE_DEV_RANDOM_ID,
  ANU_PROVIDER_ID,
  AnuQuantumNumbersProvider,
  unsafeDevPermission,
  isProduction,
} from '../src/index.js';
import { withEnv, withEnvAsync, withNodeEnv } from './helpers.js';

const DEV_OK = { NODE_ENV: 'development', QSD_ALLOW_UNSAFE_DEV: '1' };

describe('UNSAFE_DEV_RANDOM guard is fail-closed', () => {
  it('is named exactly UNSAFE_DEV_RANDOM', () => {
    expect(UNSAFE_DEV_RANDOM_ID).toBe('UNSAFE_DEV_RANDOM');
    withNodeEnv('test', () => {
      expect(new UnsafeDevRandomProvider().id).toBe('UNSAFE_DEV_RANDOM');
    });
  });

  it('constructor throws when NODE_ENV=production', () => {
    withNodeEnv('production', () => {
      expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
    });
  });

  for (const v of ['Production', 'PRODUCTION', ' production', 'production ', 'prod', 'staging', 'dev', 'TEST ', '']) {
    it(`treats NODE_ENV=${JSON.stringify(v)} as production`, () => {
      withNodeEnv(v, () => {
        // 'TEST ' normalises to 'test' and is allowed; everything else here is denied.
        if (v.trim().toLowerCase() === 'test') {
          expect(() => new UnsafeDevRandomProvider()).not.toThrow();
        } else {
          expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
        }
      });
    });
  }

  it('NODE_ENV unset is production', () => {
    withNodeEnv(undefined, () => {
      expect(isProduction()).toBe(true);
      expect(unsafeDevPermission()).toEqual({ allowed: false, reason: expect.stringContaining('not set') });
      expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
    });
  });

  it('no `process` object at all (browser bundle) is production', () => {
    const real = globalThis.process;
    try {
      // @ts-expect-error simulate a browser global scope
      delete globalThis.process;
      expect(isProduction()).toBe(true);
      expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
    } finally {
      globalThis.process = real;
    }
  });

  it('NODE_ENV=test is allowed on its own; development needs QSD_ALLOW_UNSAFE_DEV=1', () => {
    withEnv({ NODE_ENV: 'test', QSD_ALLOW_UNSAFE_DEV: undefined }, () => {
      expect(() => new UnsafeDevRandomProvider()).not.toThrow();
    });
    withEnv({ NODE_ENV: 'development', QSD_ALLOW_UNSAFE_DEV: undefined }, () => {
      expect(() => new UnsafeDevRandomProvider()).toThrow(/QSD_ALLOW_UNSAFE_DEV=1/);
    });
    withEnv({ NODE_ENV: 'development', QSD_ALLOW_UNSAFE_DEV: 'true' }, () => {
      expect(() => new UnsafeDevRandomProvider()).toThrow(ProductionGuardError);
    });
    withEnv(DEV_OK, () => {
      expect(() => new UnsafeDevRandomProvider()).not.toThrow();
    });
  });

  it('draw() refuses if the environment flips to production after construction', async () => {
    const provider = withEnv(DEV_OK, () => new UnsafeDevRandomProvider());
    await withEnvAsync(DEV_OK, async () => {
      const d = await provider.draw(8);
      expect(d.bytes.length).toBe(8);
    });
    await withEnvAsync({ NODE_ENV: 'production' }, async () => {
      await expect(provider.draw(8)).rejects.toThrow(ProductionGuardError);
    });
    await withEnvAsync({ NODE_ENV: undefined }, async () => {
      await expect(provider.draw(8)).rejects.toThrow(ProductionGuardError);
    });
    await withEnvAsync({ NODE_ENV: 'development', QSD_ALLOW_UNSAFE_DEV: undefined }, async () => {
      await expect(provider.draw(8)).rejects.toThrow(ProductionGuardError);
    });
  });

  it('the dev attestation carries no draw binding, even when one is requested', async () => {
    await withEnvAsync({ NODE_ENV: 'test' }, async () => {
      const d = await new UnsafeDevRandomProvider().draw(8, undefined, { inputsHash: 'ab'.repeat(32), nonce: 'cd' });
      expect(d.attestation.inputsHash).toBeUndefined();
      expect(d.attestation.nonce).toBeUndefined();
    });
  });

  it('does not leak anything through JSON', () => {
    withNodeEnv('test', () => {
      const p = new UnsafeDevRandomProvider();
      expect(JSON.parse(JSON.stringify(p))).toEqual({ id: 'UNSAFE_DEV_RANDOM', attestationKind: 'unsafe-dev', publicKey: p.publicKey });
    });
  });
});

describe('createProviderFromEnv', () => {
  it('refuses UNSAFE_DEV_RANDOM in production even when explicitly requested', () => {
    withNodeEnv('production', () => {
      expect(() => createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM' })).toThrow(ProductionGuardError);
    });
    withNodeEnv(undefined, () => {
      expect(() => createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM' })).toThrow(ProductionGuardError);
    });
  });

  it('returns the dev provider only when explicitly requested in a permitted env', () => {
    withNodeEnv('test', () => {
      expect(createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM' })).toBeInstanceOf(UnsafeDevRandomProvider);
    });
    withEnv(DEV_OK, () => {
      expect(createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM' })).toBeInstanceOf(UnsafeDevRandomProvider);
    });
    withEnv({ NODE_ENV: 'development', QSD_ALLOW_UNSAFE_DEV: undefined }, () => {
      expect(() => createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM' })).toThrow(ProductionGuardError);
    });
  });

  it('never returns the dev provider unless explicitly requested, even in a permitted env', () => {
    withNodeEnv('test', () => {
      expect(() => createProviderFromEnv({})).toThrow(QuantumConfigError);
      expect(() => createProviderFromEnv({})).not.toThrow(ProductionGuardError);
    });
  });

  it('defaults to the ANU provider and demands the key and witness seed', () => {
    withNodeEnv('production', () => {
      expect(() => createProviderFromEnv({})).toThrow(/QSD_QRNG_API_KEY/);
      expect(() => createProviderFromEnv({ [ENV.API_KEY]: 'k' })).toThrow(/QSD_WITNESS_SECRET_KEY/);
      expect(() => createProviderFromEnv({ [ENV.API_KEY]: 'k', [ENV.WITNESS_SECRET_KEY]: 'zz' })).toThrow(
        /QSD_WITNESS_SECRET_KEY/,
      );
      const p = createProviderFromEnv({ [ENV.API_KEY]: 'k', [ENV.WITNESS_SECRET_KEY]: '11'.repeat(32) });
      expect(p).toBeInstanceOf(AnuQuantumNumbersProvider);
      expect(p.id).toBe(ANU_PROVIDER_ID);
      expect(p.attestationKind).toBe('witness-signed');
    });
  });

  it('rejects unknown provider names', () => {
    withNodeEnv('test', () => {
      expect(() => createProviderFromEnv({ [ENV.PROVIDER]: 'random-org' })).toThrow(QuantumConfigError);
    });
  });

  it('reads NODE_ENV and QSD_ALLOW_UNSAFE_DEV from the real process, not the injected env', () => {
    withNodeEnv('production', () => {
      expect(() =>
        createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM', NODE_ENV: 'test', QSD_ALLOW_UNSAFE_DEV: '1' }),
      ).toThrow(ProductionGuardError);
    });
    withEnv({ NODE_ENV: 'development', QSD_ALLOW_UNSAFE_DEV: undefined }, () => {
      expect(() =>
        createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM', QSD_ALLOW_UNSAFE_DEV: '1' }),
      ).toThrow(ProductionGuardError);
    });
  });

  it('error messages never contain the API key', () => {
    withNodeEnv('test', () => {
      try {
        createProviderFromEnv({ [ENV.API_KEY]: 'SUPER-SECRET-KEY', [ENV.WITNESS_SECRET_KEY]: 'bad' });
        throw new Error('expected throw');
      } catch (e) {
        expect(String((e as Error).message)).not.toContain('SUPER-SECRET-KEY');
      }
    });
  });
});
