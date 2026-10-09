import { ed25519SignerFromSeed } from '../attestation.js';
import { hexToBytes, isHex } from '../encoding.js';
import { isProduction, ProductionGuardError, QuantumConfigError } from '../errors.js';
import type { QrngProvider } from '../types.js';
import { ANU_PROVIDER_ID, AnuQuantumNumbersProvider } from './anu.js';
import { UNSAFE_DEV_RANDOM_ID, UnsafeDevRandomProvider } from './unsafeDev.js';

/** Exact environment variable names read by createProviderFromEnv(). */
export const ENV = {
  /** Which provider to construct: 'anu-quantum-numbers' (default) or 'UNSAFE_DEV_RANDOM'. */
  PROVIDER: 'QSD_QRNG_PROVIDER',
  /** API key for the real provider. Never logged. */
  API_KEY: 'QSD_QRNG_API_KEY',
  /** Optional endpoint override for the real provider. */
  ENDPOINT: 'QSD_QRNG_ENDPOINT',
  /** 64-hex-char (32-byte) Ed25519 seed for the witness key. Never logged. */
  WITNESS_SECRET_KEY: 'QSD_WITNESS_SECRET_KEY',
} as const;

export type EnvLike = Record<string, string | undefined>;

function readEnv(env?: EnvLike): EnvLike {
  if (env) return env;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (globalThis as any).process;
  return (p?.env ?? {}) as EnvLike;
}

/**
 * Construct a provider from environment variables.
 *
 * - QSD_QRNG_PROVIDER unset or 'anu-quantum-numbers': requires QSD_QRNG_API_KEY
 *   and QSD_WITNESS_SECRET_KEY.
 * - QSD_QRNG_PROVIDER='UNSAFE_DEV_RANDOM': only when NODE_ENV !== 'production';
 *   otherwise throws ProductionGuardError. There is no other way to get the
 *   dev provider from the environment.
 *
 * `env` may be injected for tests; NODE_ENV is always read from the real
 * process so the production guard cannot be bypassed by injection.
 */
export function createProviderFromEnv(env?: EnvLike): QrngProvider {
  const e = readEnv(env);
  const requested = (e[ENV.PROVIDER] ?? ANU_PROVIDER_ID).trim();

  if (requested === UNSAFE_DEV_RANDOM_ID) {
    if (isProduction()) {
      throw new ProductionGuardError(
        `${ENV.PROVIDER}=${UNSAFE_DEV_RANDOM_ID} is not allowed when NODE_ENV=production. ` +
          'Configure a real quantum provider.',
      );
    }
    return new UnsafeDevRandomProvider();
  }

  if (requested === ANU_PROVIDER_ID) {
    const apiKey = e[ENV.API_KEY];
    if (!apiKey) {
      throw new QuantumConfigError(`${ENV.API_KEY} is not set; the ANU Quantum Numbers provider needs an API key.`);
    }
    const seedHex = e[ENV.WITNESS_SECRET_KEY];
    if (!seedHex || !isHex(seedHex) || seedHex.length !== 64) {
      throw new QuantumConfigError(
        `${ENV.WITNESS_SECRET_KEY} must be a 64-character hex string (32-byte Ed25519 seed).`,
      );
    }
    const endpoint = e[ENV.ENDPOINT];
    return new AnuQuantumNumbersProvider({
      apiKey,
      witness: ed25519SignerFromSeed(hexToBytes(seedHex)),
      ...(endpoint ? { endpoint } : {}),
    });
  }

  throw new QuantumConfigError(
    `${ENV.PROVIDER}="${requested}" is not a known provider. Known: ${ANU_PROVIDER_ID}, ${UNSAFE_DEV_RANDOM_ID} (dev only).`,
  );
}
