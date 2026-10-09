import type { ReactElement } from 'react';

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface EmptyStateProps {
  /** Mono uppercase eyebrow, e.g. "NO LIVE COINS". */
  eyebrow: string;
  /** Exactly one honest sentence about why there is nothing here. */
  sentence: string;
  /** Optional single action. */
  action?: EmptyStateAction;
  className?: string;
}

/**
 * Icon-less empty state. This is what every page renders when there is no
 * live data. It never suggests data exists that does not.
 */
export function EmptyState({ eyebrow, sentence, action, className }: EmptyStateProps): ReactElement {
  return (
    <div className={['qsd-empty', className].filter(Boolean).join(' ')} role="status" data-empty="true">
      <span className="qsd-eyebrow">{eyebrow}</span>
      <p className="qsd-empty__sentence">{sentence}</p>
      {action ? (
        action.href ? (
          <a className="qsd-empty__action" href={action.href} onClick={action.onClick}>
            {action.label}
          </a>
        ) : (
          <button type="button" className="qsd-empty__action" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
