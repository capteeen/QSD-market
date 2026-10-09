'use client';
import type { CSSProperties, ReactNode } from 'react';
import { Dial } from './Dial';

export interface FeatureSectionProps {
  id: string;
  /** Inline style carrying `--accent`, the colour of the headline and arrows (a ui-tokens variable). */
  accent: CSSProperties;
  eyebrow: string;
  title: string;
  body: string;
  arrows: readonly string[];
  /** What sits at the centre of the dial (an abstract figure, never data). */
  centre: ReactNode;
  /** The live terminal at the bottom right. */
  terminal: ReactNode;
}

/** One dark feature section in the animejs.com layout: headline + arrow list left, the dial centre, a terminal card bottom right. */
export function FeatureSection({ id, accent, eyebrow, title, body, arrows, centre, terminal }: FeatureSectionProps) {
  return (
    <section id={id} className="qsd-feature" data-theme="darkfield" style={accent}>
      <div className="qsd-feature__inner">
        <div className="qsd-feature__copy">
          <span className="qsd-eyebrow">{eyebrow}</span>
          <h2 className="qsd-feature__title">{title}</h2>
          <p className="qsd-feature__body">{body}</p>
          <hr className="qsd-feature__rule" />
          <ul className="qsd-arrows">
            {arrows.map((a) => (
              <li key={a}>
                <span aria-hidden="true">→</span> {a}
              </li>
            ))}
          </ul>
        </div>
        <div className="qsd-feature__dial">
          <Dial>{centre}</Dial>
        </div>
        <div className="qsd-feature__term">{terminal}</div>
      </div>
    </section>
  );
}

/* ── abstract dial centres (decoration only, no data) ── */

export function RangesFigure() {
  return (
    <div className="qsd-fig qsd-fig--ranges" aria-hidden="true">
      <i style={{ ['--a' as string]: 0.18, ['--b' as string]: 0.66 }} />
      <i style={{ ['--a' as string]: 0.3, ['--b' as string]: 0.52 }} />
      <i style={{ ['--a' as string]: 0.1, ['--b' as string]: 0.86 }} />
      <i style={{ ['--a' as string]: 0.42, ['--b' as string]: 0.6 }} />
    </div>
  );
}

export function HalfLifeFigure() {
  return (
    <div className="qsd-fig qsd-fig--halflife" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" className="qsd-fig__track" />
        <circle cx="50" cy="50" r="40" className="qsd-fig__arc" />
        <circle cx="50" cy="50" r="30" className="qsd-fig__track" />
        <circle cx="50" cy="50" r="30" className="qsd-fig__arc qsd-fig__arc--slow" />
      </svg>
    </div>
  );
}

export function DotGridFigure() {
  return (
    <div className="qsd-fig qsd-fig--grid" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => (
        <i key={i} style={{ ['--d' as string]: `${(i % 6) * 90 + Math.floor(i / 6) * 140}ms` }} />
      ))}
    </div>
  );
}

export function DaughterFigure() {
  return (
    <div className="qsd-fig qsd-fig--daughter" aria-hidden="true">
      <span className="qsd-fig__mother" />
      <span className="qsd-fig__flow" />
      <span className="qsd-fig__child" />
    </div>
  );
}
