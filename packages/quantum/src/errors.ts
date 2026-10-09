/**
 * Thrown when a measurement cannot be performed because the quantum source is
 * unreachable, misconfigured, or returned something unusable. The `message` is
 * plain English and safe to show in the UI. It never contains the API key.
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

  constructor(
    providerId: string,
    code: MeasurementUnavailableError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.providerId = providerId;
    this.code = code;
  }
}

/**
 * Thrown when UNSAFE_DEV_RANDOM is constructed or used with NODE_ENV=production,
 * or when createProviderFromEnv() is asked for it in production.
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

/** Safe to read NODE_ENV in browsers and workers where `process` is undefined. */
export function currentNodeEnv(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (globalThis as any).process;
    const v = p?.env?.NODE_ENV;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function isProduction(): boolean {
  return currentNodeEnv() === 'production';
}
