/**
 * Error types for @qsd/solana. Every error message is safe to log: nothing in
 * this package puts a secret into an error. `redactSecrets()` is applied to
 * messages that embed upstream (RPC / HTTP) text as a second line of defence.
 */

export class ChainError extends Error {
  override readonly name: string = 'ChainError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(redactSecrets(message), options);
  }
}

/** Something the chain package cannot do yet, with the reason. Never a fake value. */
export class NotImplementedError extends ChainError {
  override readonly name = 'NotImplementedError';
  constructor(what: string, reason: string) {
    super(`not implemented: ${what} — ${reason}`);
  }
}

/** The chain / an external service is unreachable or refuses this operation on this cluster. */
export class ChainUnavailableError extends ChainError {
  override readonly name = 'ChainUnavailableError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(`chain unavailable: ${message}`, options);
  }
}

export class ChainConfigError extends ChainError {
  override readonly name = 'ChainConfigError';
}

export class KeyVaultError extends ChainError {
  override readonly name = 'KeyVaultError';
}

export class JournalError extends ChainError {
  override readonly name = 'JournalError';
}

export class WebhookAuthError extends ChainError {
  override readonly name = 'WebhookAuthError';
}

/** A transient failure (network, blockhash expiry, rate limit) that a retry may fix. */
export class TransientChainError extends ChainError {
  override readonly name = 'TransientChainError';
}

const SECRET_PATTERNS: RegExp[] = [
  /api-key=[^&\s"']+/gi,
  /x-api-key:\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._-]{8,}/g,
  /\b[0-9a-fA-F]{64}\b/g, // 32-byte hex (encryption keys, seeds)
  /\b[0-9a-fA-F]{128}\b/g, // 64-byte hex (ed25519 secret keys)
  /\b[1-9A-HJ-NP-Za-km-z]{85,90}\b/g, // base58 64-byte secret keys
];

/** Replace anything that looks like a key or token with a marker. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, '[redacted]');
  return out;
}

/** Message of an unknown thrown value, redacted. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return redactSecrets(e.message);
  return redactSecrets(String(e));
}

/** Heuristic: is this error worth retrying? */
export function isTransient(e: unknown): boolean {
  if (e instanceof TransientChainError) return true;
  const m = errorMessage(e).toLowerCase();
  return (
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('fetch failed') ||
    m.includes('blockhash not found') ||
    m.includes('block height exceeded') ||
    m.includes('node is behind') ||
    m.includes('503') ||
    m.includes('502')
  );
}

export class InvalidCollapseError extends ChainError {
  override readonly name = 'InvalidCollapseError';
}
