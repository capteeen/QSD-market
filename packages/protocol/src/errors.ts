export class ProtocolError extends Error {
  override readonly name: string = 'ProtocolError';
  constructor(message: string) {
    super(message);
  }
}

/** Thrown for a transition the coin's state does not allow. */
export class InvalidStateError extends ProtocolError {
  override readonly name = 'InvalidStateError';
  constructor(
    message: string,
    readonly state: string,
  ) {
    super(message);
  }
}

/** Thrown for a proof bundle that does not belong to this coin at this moment. */
export class BundleMismatchError extends ProtocolError {
  override readonly name = 'BundleMismatchError';
}

export class NotImplementedError extends ProtocolError {
  override readonly name = 'NotImplementedError';
  constructor(what: string, reason: string) {
    super(`${what} is not implemented: ${reason}`);
  }
}
