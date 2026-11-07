/**
 * Thrown when a measurement cannot be performed because the quantum source is
 * unreachable, misconfigured, or returned something unusable. The `message` is
 * fixed copy plus, at most, a sanitised excerpt (no HTML-significant or control
 * characters, bounded length) and is safe to show in the UI. The raw provider
 * text, if any, is in `detail` and must NOT be rendered. Neither ever contains
 * the API key.
 */
export class MeasurementUnavailableError extends Error {
  override readonly name = 'MeasurementUnavailableError';
  readonly providerId: string;
  /** Machine-readable cause, for logging and tests. */
  readonly code:
    | 'network'
    | 'http-status'
    | 'bad-response'
    | 'attestation-failed'
    | 'config'
    | 'not-implemented';
  /** Raw third-party text (e.g. the provider's `message` field). Not for the UI. */
  readonly detail: string | undefined;

  constructor(
    providerId: string,
    code: MeasurementUnavailableError['code'],
    message: string,
    options?: { cause?: unknown; detail?: string },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.providerId = providerId;
    this.code = code;
    this.detail = options?.detail;
  }
}

/**
 * Thrown when UNSAFE_DEV_RANDOM is constructed or used outside an explicitly
 * permitted development/test environment, or when createProviderFromEnv() is
 * asked for it there.
 */
export class ProductionGuardError extends Error {
  override readonly name = 'ProductionGuardError';
  constructor(message: string) {
    super(message);
  }
}

/** Thrown for provider/resolver/configuration misuse that is a programming error. */
export class QuantumConfigError extends Error {
  override readonly name = 'QuantumConfigError';
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when a spec'd feature cannot be implemented yet. Carries the reason. */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';
  constructor(what: string, reason: string) {
    super(`${what} is not implemented: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Environment / production guard
// ---------------------------------------------------------------------------

/** Env var that, together with NODE_ENV=development, permits UNSAFE_DEV_RANDOM. */
export const ALLOW_UNSAFE_DEV_ENV = 'QSD_ALLOW_UNSAFE_DEV';

function realProcessEnv(): Record<string, string | undefined> | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (globalThis as any).process;
    const env = p?.env;
    return env && typeof env === 'object' ? (env as Record<string, string | undefined>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * NODE_ENV, normalised (trimmed, lower-cased). `undefined` when `process`
 * or `process.env.NODE_ENV` is missing (browser bundles, bare containers).
 */
export function currentNodeEnv(): string | undefined {
  const v = realProcessEnv()?.['NODE_ENV'];
  if (typeof v !== 'string') return undefined;
  const n = v.trim().toLowerCase();
  return n.length ? n : undefined;
}

export type DevPermission = { allowed: true } | { allowed: false; reason: string };

/**
 * Fail-closed permission check for the dev provider. The dev provider is
 * permitted ONLY with positive evidence of a non-production environment:
 *
 *   NODE_ENV = "test"                                   -> allowed
 *   NODE_ENV = "development" and QSD_ALLOW_UNSAFE_DEV=1 -> allowed
 *   anything else, including NODE_ENV unset, "prod",
 *   "Production", or no `process` object at all         -> production (denied)
 *
 * Always read from the real process, never from an injected env object.
 */
export function unsafeDevPermission(): DevPermission {
  const env = realProcessEnv();
  if (!env) {
    return { allowed: false, reason: 'no process environment is available (treated as production)' };
  }
  const nodeEnv = currentNodeEnv();
  if (nodeEnv === undefined) {
    return { allowed: false, reason: 'NODE_ENV is not set (treated as production)' };
  }
  if (nodeEnv === 'test') return { allowed: true };
  if (nodeEnv === 'development') {
    if ((env[ALLOW_UNSAFE_DEV_ENV] ?? '').trim() === '1') return { allowed: true };
    return {
      allowed: false,
      reason: `NODE_ENV=development also requires ${ALLOW_UNSAFE_DEV_ENV}=1`,
    };
  }
  return { allowed: false, reason: `NODE_ENV=${JSON.stringify(nodeEnv)} is treated as production` };
}

/** True unless the environment positively permits the dev provider. */
export function isProduction(): boolean {
  return !unsafeDevPermission().allowed;
}
