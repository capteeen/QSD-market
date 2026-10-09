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
} from '../src/index.js';
import { withNodeEnv, withNodeEnvAsync } from './helpers.js';

describe('UNSAFE_DEV_RANDOM production guard', () => {
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

  it('constructor works in development and test', () => {
    withNodeEnv('development', () => expect(() => new UnsafeDevRandomProvider()).not.toThrow());
    withNodeEnv('test', () => expect(() => new UnsafeDevRandomProvider()).not.toThrow());
    withNodeEnv(undefined, () => expect(() => new UnsafeDevRandomProvider()).not.toThrow());
  });

  it('draw() refuses if NODE_ENV flips to production after construction', async () => {
    const provider = withNodeEnv('development', () => new UnsafeDevRandomProvider());
    await withNodeEnvAsync('development', async () => {
      const d = await provider.draw(8);
      expect(d.bytes.length).toBe(8);
    });
    await withNodeEnvAsync('production', async () => {
      await expect(provider.draw(8)).rejects.toThrow(ProductionGuardError);
    });
  });
});

describe('createProviderFromEnv', () => {
  it('refuses UNSAFE_DEV_RANDOM in production even when explicitly requested', () => {
    withNodeEnv('production', () => {
      expect(() => createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM' })).toThrow(
        ProductionGuardError,
      );
    });
  });

  it('returns the dev provider outside production when explicitly requested', () => {
    withNodeEnv('test', () => {
      const p = createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM' });
      expect(p).toBeInstanceOf(UnsafeDevRandomProvider);
    });
  });

  it('never returns the dev provider unless explicitly requested, even outside production', () => {
    withNodeEnv('development', () => {
      // No provider set, no key: must fail with a config error, NOT fall back to dev.
      expect(() => createProviderFromEnv({})).toThrow(QuantumConfigError);
      expect(() => createProviderFromEnv({})).not.toThrow(ProductionGuardError);
    });
  });

  it('defaults to the ANU provider and demands the key and witness seed', () => {
    withNodeEnv('production', () => {
      expect(() => createProviderFromEnv({})).toThrow(/QSD_QRNG_API_KEY/);
      expect(() => createProviderFromEnv({ [ENV.API_KEY]: 'k' })).toThrow(/QSD_WITNESS_SECRET_KEY/);
      expect(() =>
        createProviderFromEnv({ [ENV.API_KEY]: 'k', [ENV.WITNESS_SECRET_KEY]: 'zz' }),
      ).toThrow(/QSD_WITNESS_SECRET_KEY/);
      const p = createProviderFromEnv({
        [ENV.API_KEY]: 'k',
        [ENV.WITNESS_SECRET_KEY]: '11'.repeat(32),
      });
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

  it('reads NODE_ENV from the real process, not the injected env', () => {
    withNodeEnv('production', () => {
      expect(() =>
        createProviderFromEnv({ [ENV.PROVIDER]: 'UNSAFE_DEV_RANDOM', NODE_ENV: 'development' }),
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
