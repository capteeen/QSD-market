import type { ReactElement } from 'react';

export type ProofStatus = 'verified' | 'unverified' | 'invalid' | 'pending' | 'unavailable';

export interface ProofBadgeProps {
  status: ProofStatus;
  /** Why the proof is in this state. Required for every non-verified status. */
  reason?: string;
  /** Override the visible word. Defaults to the status itself. */
  label?: string;
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

/**
 * Proof status pill. Colours: probability cyan for verified, decay amber
 * for pending, collapse magenta for invalid, dead grey for unavailable,
 * muted for unverified. The circle is a quantum object; the pill is a card.
 */
export function ProofBadge({ status, reason, label, className }: ProofBadgeProps): ReactElement {
  const token = proofStatusToken[status];
  const text = label ?? status;
  const needsReason = status !== 'verified';
  const shownReason = reason ?? (needsReason ? 'no reason given' : undefined);

  return (
    <span
      className={['qsd-badge', `qsd-badge--${token}`, `text-${token}`, className].filter(Boolean).join(' ')}
      data-status={status}
      data-token={token}
      role="status"
      aria-label={shownReason ? `proof ${text}: ${shownReason}` : `proof ${text}`}
    >
      <span className="qsd-badge__dot" aria-hidden="true" />
      <span>{text}</span>
      {shownReason ? <span className="qsd-badge__reason">{shownReason}</span> : null}
    </span>
  );
}
