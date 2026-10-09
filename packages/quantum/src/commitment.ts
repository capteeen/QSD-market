import { canonicalJson, lengthPrefixed, sha256Hex, utf8 } from './encoding.js';
import type { Attestation, Hex } from './types.js';

/** Domain separator so a commitment can never collide with another QSD hash. */
export const COMMITMENT_DOMAIN = 'qsd.market/quantum/commitment/v1';

/**
 * commitment = sha256( LP(DOMAIN) || LP(providerId) || LP(requestedAt) || LP(bytes) || LP(canonical(attestation)) )
 * where LP() is a 4-byte big-endian length prefix.
 *
 * The attestation (including its signature) is part of the commitment, so the
 * commitment binds the bytes to exactly one attested response.
 */
export function computeCommitment(args: {
  providerId: string;
  requestedAt: string;
  bytes: Uint8Array;
  attestation: Attestation;
}): Hex {
  return sha256Hex(
    lengthPrefixed([
      utf8(COMMITMENT_DOMAIN),
      utf8(args.providerId),
      utf8(args.requestedAt),
      args.bytes,
      utf8(canonicalJson(args.attestation)),
    ]),
  );
}
