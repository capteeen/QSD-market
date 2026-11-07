import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { Unavailable } from './Unavailable.js';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Small uppercase mono label above the title, e.g. "PROOF BUNDLE". */
  eyebrow?: string;
  /** Space Grotesk 600 heading. */
  title?: ReactNode;
  /** When true the panel carries the magenta-white computation glow. */
  computing?: boolean;
  /**
   * When set, the panel renders a dashed border and the unavailable state
   * instead of children. Use it when the data behind the panel is missing.
   */
  unavailable?: { reason: string; label?: string };
  children?: ReactNode;
}

/**
 * Glass panel: translucent surface, refractive cyan edge, 2px square-cornered
 * border (slide-mount framing). Chrome, not spectacle.
 */
export function Panel({
  eyebrow,
  title,
  computing = false,
  unavailable,
  children,
  className,
  ...rest
}: PanelProps): ReactElement {
  return (
    <section
      {...rest}
      className={['qsd-panel', className].filter(Boolean).join(' ')}
      data-computing={computing ? 'true' : 'false'}
      data-unavailable={unavailable ? 'true' : 'false'}
      aria-busy={computing || undefined}
    >
      {eyebrow ? <div className="qsd-eyebrow">{eyebrow}</div> : null}
      {title ? (
        <h2 className="qsd-heading" style={{ margin: '0.25rem 0 0.75rem', fontSize: 'var(--text-lg)' }}>
          {title}
        </h2>
      ) : null}
      {unavailable ? (
        <Unavailable reason={unavailable.reason} {...(unavailable.label ? { label: unavailable.label } : {})} />
      ) : (
        children
      )}
    </section>
  );
}
