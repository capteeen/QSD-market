import {
  ephemeralEd25519Signer,
  signUnsafeDevAttestation,
  type Ed25519Signer,
} from '../attestation.js';
import { computeCommitment } from '../commitment.js';
import { nowIso, sha256Hex } from '../encoding.js';
import { isProduction, ProductionGuardError } from '../errors.js';
import type { Draw, DrawObserver, QrngProvider } from '../types.js';

export const UNSAFE_DEV_RANDOM_ID = 'UNSAFE_DEV_RANDOM' as const;

export const UNSAFE_DEV_WARNING =
  'UNSAFE_DEV_RANDOM: bytes come from the local CSPRNG (crypto.getRandomValues), NOT a quantum source. ' +
  'This attestation is signed by an ephemeral key with no evidential value. Development and tests only.';

const GUARD_MESSAGE =
  'UNSAFE_DEV_RANDOM cannot be used when NODE_ENV=production. ' +
  'Measurement requires a real quantum provider; there is no deterministic fallback.';

/**
 * Dev-only provider. Refuses to exist in production: the constructor throws if
 * NODE_ENV=production, and draw() re-checks so a provider constructed before
 * the environment flipped still refuses.
 */
export class UnsafeDevRandomProvider implements QrngProvider {
  readonly id = UNSAFE_DEV_RANDOM_ID;
  readonly attestationKind = 'unsafe-dev' as const;
  private readonly signer: Ed25519Signer;

  constructor() {
    if (isProduction()) throw new ProductionGuardError(GUARD_MESSAGE);
    this.signer = ephemeralEd25519Signer();
  }

  /** The ephemeral public key; useful for passing as a trusted key in tests. */
  get publicKey(): string {
    return this.signer.publicKey;
  }

  async draw(nBytes: number, observer?: DrawObserver): Promise<Draw> {
    if (isProduction()) throw new ProductionGuardError(GUARD_MESSAGE);
    if (!Number.isInteger(nBytes) || nBytes <= 0 || nBytes > 65536) {
      throw new RangeError(`UNSAFE_DEV_RANDOM: nBytes must be an integer in 1..65536, got ${String(nBytes)}`);
    }
    const requestedAt = nowIso();
    observer?.emit({ type: 'entropyRequested', providerId: this.id, nBytes, requestedAt });

    const bytes = new Uint8Array(nBytes);
    globalThis.crypto.getRandomValues(bytes);
    const receivedAt = laterThan(requestedAt);

    const attestation = signUnsafeDevAttestation(
      {
        kind: 'unsafe-dev',
        providerId: this.id,
        requestedAt,
        receivedAt,
        bytesSha256: sha256Hex(bytes),
        warning: UNSAFE_DEV_WARNING,
      },
      this.signer,
    );
    observer?.emit({ type: 'entropyArrived', bytes, attestation });

    const commitment = computeCommitment({ providerId: this.id, requestedAt, bytes, attestation });
    observer?.emit({ type: 'commitmentComputed', hash: commitment });

    return { bytes, providerId: this.id, requestedAt, receivedAt, attestation, commitment };
  }
}

/** Ensure receivedAt >= requestedAt even within the same millisecond. */
function laterThan(iso: string): string {
  const now = nowIso();
  return Date.parse(now) >= Date.parse(iso) ? now : iso;
}
