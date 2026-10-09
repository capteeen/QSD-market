/** Thrown when a one-time key index would be used a second time. */
export class KeyReuseError extends Error {
  override readonly name = "KeyReuseError";
  constructor(
    readonly index: number,
    readonly rootHex: string,
    detail?: string,
  ) {
    super(
      `one-time key ${index} of identity ${rootHex.slice(0, 16)}… has already been used` +
        (detail ? `: ${detail}` : "") +
        ". A WOTS+ leaf can never be reused.",
    );
  }
}

/** Thrown when every one-time key of an identity has been consumed. */
export class KeysExhaustedError extends Error {
  override readonly name = "KeysExhaustedError";
  constructor(readonly rootHex: string) {
    super(`identity ${rootHex.slice(0, 16)}… has no unused one-time keys left`);
  }
}

/** Thrown for malformed inputs (wrong lengths, bad state objects, etc). */
export class CryptoInputError extends Error {
  override readonly name = "CryptoInputError";
}

/** Thrown when an operation is not available yet; the reason is always given. */
export class NotImplementedError extends Error {
  override readonly name = "NotImplementedError";
  constructor(what: string, reason: string) {
    super(`${what} is not implemented: ${reason}`);
  }
}
