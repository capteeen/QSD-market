import type { ReactElement } from 'react';

export const UNAVAILABLE_DASH = '—'; // em dash

export interface UnavailableProps {
  /** Why the value is missing. Always shown — never hide the reason. */
  reason: string;
  /** Short word after the dash. Defaults to "not available". */
  label?: string;
  className?: string;
}

/**
 * The one honest fallback. Renders `—  <label>` plus the reason.
 * Contains no digits by construction. Every component in this kit uses it
 * instead of a placeholder number.
 */
export function Unavailable({ reason, label = 'not available', className }: UnavailableProps): ReactElement {
  return (
    <span className={['qsd-unavailable', className].filter(Boolean).join(' ')} data-unavailable="true" role="status">
      <span aria-hidden="true">{UNAVAILABLE_DASH}</span>
      {'  '}
      <span>{label}</span>
      {reason ? (
        <>
          {' '}
          <span className="qsd-unavailable__reason">({reason})</span>
        </>
      ) : null}
    </span>
  );
}
