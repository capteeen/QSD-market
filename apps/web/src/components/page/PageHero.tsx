'use client';
import type { CSSProperties, ReactNode } from 'react';
import { Dial } from '@/components/home/Dial';

/** The accent variables a page can pick for its headline and arrows (ui-tokens colours). */
export const ACCENT = {
  probability: { ['--accent' as string]: 'var(--qsd-probability)' } as CSSProperties,
  collapse: { ['--accent' as string]: 'var(--qsd-collapse)' } as CSSProperties,
  decay: { ['--accent' as string]: 'var(--qsd-decay)' } as CSSProperties,
  teal: { ['--accent' as string]: 'var(--qsd-teal)' } as CSSProperties,
  ice: { ['--accent' as string]: 'var(--qsd-ice)' } as CSSProperties,
  violet: { ['--accent' as string]: 'var(--qsd-violet)' } as CSSProperties,
  text: { ['--accent' as string]: 'var(--qsd-text)' } as CSSProperties,
  ink: { ['--accent' as string]: 'var(--qsd-ink)' } as CSSProperties,
} as const;

export interface PageHeroProps {
  accent?: CSSProperties;
  eyebrow: string;
  title: string;
  body?: string | undefined;
  arrows?: readonly string[] | undefined;
  /** What sits at the centre of the dial (an abstract figure, never data). No dial when omitted. */
  figure?: ReactNode;
  /** Controls, filters or a status label shown under the body. */
  children?: ReactNode;
}

/** The page-level hero in the animejs.com layout: eyebrow, big accent headline, body, arrows, the dial at the right. */
export function PageHero({ accent, eyebrow, title, body, arrows, figure, children }: PageHeroProps) {
  return (
    <header className="qsd-phero" style={accent} data-dial={figure ? 'true' : 'false'}>
      <div className="qsd-phero__copy">
        <span className="qsd-eyebrow">{eyebrow}</span>
        <h1 className="qsd-phero__title">{title}</h1>
        {body ? <p className="qsd-phero__body">{body}</p> : null}
        {arrows && arrows.length > 0 ? (
          <ul className="qsd-arrows">
            {arrows.map((a) => (
              <li key={a}>
                <span aria-hidden="true">→</span> {a}
              </li>
            ))}
          </ul>
        ) : null}
        {children ? <div className="qsd-phero__meta">{children}</div> : null}
      </div>
      {figure ? (
        <div className="qsd-phero__dial">
          <Dial>{figure}</Dial>
        </div>
      ) : null}
    </header>
  );
}

/** The page shell: a dark page by default, paper with theme="brightfield". */
export function PageShell({ children, theme, className }: { children: ReactNode; theme?: 'brightfield' | undefined; className?: string | undefined }) {
  return (
    <div className={`qsd-page ${className ?? ''}`} data-theme={theme}>
      <div className="qsd-page__inner">{children}</div>
    </div>
  );
}
