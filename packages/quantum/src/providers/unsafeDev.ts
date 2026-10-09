import {
  ephemeralEd25519Signer,
  signUnsafeDevAttestation,
  type Ed25519Signer,
} from '../attestation.js';
import { computeCommitment } from '../commitment.js';
import { nowIso, sha256Hex } from '../encoding.js';
import { ProductionGuardError, unsafeDevPermission } from '../errors.js';
import type { Draw, DrawBinding, DrawObserver, QrngProvider } from '../types.js';

export const UNSAFE_DEV_RANDOM_ID = 'UNSAFE_DEV_RANDOM' as const;

export const UNSAFE_DEV_WARNING =
  'UNSAFE_DEV_RANDOM: bytes come from the local CSPRNG (crypto.getRandomValues), NOT a quantum source. ' +
  'This attestation is signed by an ephemeral key with no evidential value. Development and tests only.';

function guard(): void {
  const p = unsafeDevPermission();
  if (!p.allowed) {
    throw new ProductionGuardError(
      `UNSAFE_DEV_RANDOM is not permitted here: ${p.reason}. ` +
        'It is allowed only with NODE_ENV=test, or NODE_ENV=development plus QSD_ALLOW_UNSAFE_DEV=1. ' +
        'Measurement requires a real quantum provider; there is no deterministic fallback.',
    );
  }
}

/**
 * Dev-only provider. Fail-closed: the constructor throws unless the
 * environment positively permits it (see unsafeDevPermission), and draw()
 * re-checks so a provider constructed before the environment changed still
 * refuses.
 */
export class UnsafeDevRandomProvider implements QrngProvider {
  readonly id = UNSAFE_DEV_RANDOM_ID;
  readonly attestationKind = 'unsafe-dev' as const;
  readonly #signer: Ed25519Signer;

  constructor() {
    guard();
    this.#signer = ephemeralEd25519Signer();
  }

  /** The ephemeral public key; useful for passing as a trusted key in tests. */
  get publicKey(): string {
    return this.#signer.publicKey;
  }

  /**
   * Note: the dev attestation deliberately carries NO draw binding. It has no
   * evidential value, so binding it would only let a dev bundle pass a
   * `requireInputBinding` verifier by accident. `_binding` is accepted for
   * interface compatibility and ignored.
   */
  async draw(nBytes: number, observer?: DrawObserver, _binding?: DrawBinding): Promise<Draw> {
    guard();
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
      this.#signer,
    );
    observer?.emit({ type: 'entropyArrived', bytes, attestation });

    const commitment = computeCommitment({ providerId: this.id, requestedAt, bytes, attestation });
    observer?.emit({ type: 'commitmentComputed', hash: commitment });

    return { bytes, providerId: this.id, requestedAt, receivedAt, attestation, commitment };
  }

  toJSON(): { id: string; attestationKind: string; publicKey: string } {
    return { id: this.id, attestationKind: this.attestationKind, publicKey: this.publicKey };
  }
}

/** Ensure receivedAt >= requestedAt even within the same millisecond. */
function laterThan(iso: string): string {
  const now = nowIso();
  return Date.parse(now) >= Date.parse(iso) ? now : iso;
}
