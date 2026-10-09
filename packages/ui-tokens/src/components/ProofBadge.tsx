import type { ReactElement } from 'react';

export type ProofStatus = 'verified' | 'unverified' | 'invalid' | 'pending' | 'unavailable';

/**
 * How the QRNG draw inside a proof bundle was attested. Mirrors the
 * attestation variants in `@qsd/quantum` and docs/physics.md:
 *
 * - `provider-signed` — the provider itself signed the response with a published key.
 * - `witness-signed`  — the QSD protocol key signed a statement over the captured
 *                       response. Proves what QSD received, not that the provider sent it.
 * - `unsafe-dev`      — UNSAFE_DEV_RANDOM, local tests only. Never a real draw.
 */
export type AttestationKind = 'provider-signed' | 'witness-signed' | 'unsafe-dev';

export interface ProofBadgeProps {
  status: ProofStatus;
  /** Why the proof is in this state. Required for every non-verified status. */
  reason?: string;
  /** Override the visible word. Defaults to the status itself. */
  label?: string;
  /**
   * The attestation kind from the proof bundle, rendered as a mono label after
   * the status (e.g. "verified · witness-signed"). physics.md: "The UI shows
   * the attestation kind on every collapse." Omit when there is no bundle.
   * `unsafe-dev` renders in the collapse colour with a warning.
   */
  attestationKind?: AttestationKind | undefined;
  className?: string;
}

/** Maps each proof status to the colour token that represents it. */
export const proofStatusToken: Record<ProofStatus, 'probability' | 'decay' | 'collapse' | 'dead' | 'muted'> = {
  verified: 'probability',
  pending: 'decay',
  invalid: 'collapse',
  unverified: 'muted',
  unavailable: 'dead',
};

/** Human copy for each attestation kind. Never describes witness-signed as provider-signed. */
export const attestationKindLabel: Record<AttestationKind, string> = {
  'provider-signed': 'provider-signed',
  'witness-signed': 'witness-signed',
  'unsafe-dev': 'unsafe-dev',
};

export const UNSAFE_DEV_WARNING = 'dev randomness, not a quantum draw';

/**
 * Proof status pill. Colours: probability cyan for verified, decay amber
 * for pending, collapse magenta for invalid, dead grey for unavailable,
 * muted for unverified. The circle is a quantum object; the pill is a card.
 */
export function ProofBadge({ status, reason, label, attestationKind, className }: ProofBadgeProps): ReactElement {
  const token = proofStatusToken[status];
  const text = label ?? status;
  const needsReason = status !== 'verified';
  const shownReason = reason ?? (needsReason ? 'no reason given' : undefined);
  const unsafe = attestationKind === 'unsafe-dev';
  const kindText = attestationKind ? attestationKindLabel[attestationKind] : undefined;
  const ariaParts = [`proof ${text}`, kindText, unsafe ? UNSAFE_DEV_WARNING : undefined, shownReason].filter(Boolean);

  return (
    <span
      className={['qsd-badge', `qsd-badge--${token}`, `text-${token}`, className].filter(Boolean).join(' ')}
      data-status={status}
      data-token={token}
      data-attestation={attestationKind ?? 'none'}
      role="status"
      aria-label={ariaParts.join(': ')}
    >
      <span className="qsd-badge__dot" aria-hidden="true" />
      <span>{text}</span>
      {kindText ? (
        <>
          <span className="qsd-badge__sep" aria-hidden="true">
            ·
          </span>
          <span className="qsd-badge__kind qsd-mono" data-unsafe={unsafe ? 'true' : 'false'}>
            {kindText}
          </span>
        </>
      ) : null}
      {unsafe ? <span className="qsd-badge__warning">{UNSAFE_DEV_WARNING}</span> : null}
      {shownReason ? <span className="qsd-badge__reason">{shownReason}</span> : null}
    </span>
  );
}
