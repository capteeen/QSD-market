'use client';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * A terminal-style panel. Every line printed in one must come from a real
 * operation (a hash computed in the browser, an API field, a wallet the user
 * connected) or say plainly that the data is not available. Colours come from
 * the ui-tokens CSS variables (see styles/terminal.css).
 */

export const TERM_USER = 'qsd';
export const TERM_HOST = 'lab';

export function Terminal({
  path,
  meta,
  children,
  className,
  live,
  testId,
}: {
  /** Working directory shown in the title bar, e.g. "~/verify". */
  path: string;
  /** Right-hand title bar text, e.g. "xmss-sha256 · w=16". */
  meta?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  /** Shows a pulsing dot in the title bar while something is running. */
  live?: boolean;
  testId?: string;
}) {
  return (
    <section className={`qsd-term ${className ?? ''}`} data-testid={testId} aria-label={`terminal ${path}`}>
      <header className="qsd-term__bar" data-term-chrome="">
        <span>
          {TERM_USER}@{TERM_HOST}: {path}
        </span>
        <span className="qsd-term__meta">
          {live ? <span className="qsd-term__live" aria-hidden="true" /> : null}
          {meta}
        </span>
      </header>
      <div className="qsd-term__body" role="log" aria-live="polite">
        {children}
      </div>
    </section>
  );
}

/** `qsd@lab:~$ command` */
export function Cmd({ children, cursor }: { children: ReactNode; cursor?: boolean }) {
  return (
    <div className="qsd-term__line qsd-term__cmd" data-term-chrome="">
      <span className="qsd-term__prompt">
        {TERM_USER}@{TERM_HOST}
      </span>
      <span className="qsd-term__dim">:~$</span> {children}
      {cursor ? <Cursor /> : null}
    </div>
  );
}

export function Cursor() {
  return <span className="qsd-term__cursor" aria-hidden="true" />;
}

/** Plain output. */
export function Out({ children, dim, className }: { children: ReactNode; dim?: boolean; className?: string }) {
  return <div className={`qsd-term__line ${dim ? 'qsd-term__dim' : ''} ${className ?? ''}`}>{children}</div>;
}

/** `# comment` */
export function Comment({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <div className="qsd-term__line qsd-term__comment" data-active={active ? 'true' : 'false'}>
      <span className="qsd-term__caret">{active ? '>' : ' '}</span> {children}
    </div>
  );
}

/** label value, aligned. */
export function Kv({ k, children, tone }: { k: ReactNode; children: ReactNode; tone?: Tone }) {
  return (
    <div className="qsd-term__line qsd-term__kv">
      <span className="qsd-term__dim">{k}</span>
      <span className="qsd-term__v" data-tone={tone ?? 'plain'}>
        {children}
      </span>
    </div>
  );
}

export type Tone = 'plain' | 'ok' | 'warn' | 'fail' | 'dim';

/** `[ OK ]` / `[WARN]` / `[FAIL]` / `[ -- ]` status line. */
export function Status({ tone, children }: { tone: Exclude<Tone, 'plain'>; children: ReactNode }) {
  const tag = tone === 'ok' ? ' OK ' : tone === 'warn' ? 'WARN' : tone === 'fail' ? 'FAIL' : ' -- ';
  return (
    <div className="qsd-term__line">
      <span className="qsd-term__tag" data-tone={tone}>
        [{tag}]
      </span>{' '}
      {children}
    </div>
  );
}

export function Rule() {
  return <div className="qsd-term__rule" aria-hidden="true" />;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reveals `total` lines one at a time, like output arriving. The data is
 * already real and complete; this only paces how it is printed. Restarts when
 * `key` changes. Reduced-motion users get everything at once.
 */
export function useReveal(total: number, key: unknown, stepMs = 45): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(total);
      return;
    }
    setShown(0);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= total) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, total, stepMs]);
  return Math.min(shown, total);
}

/** Prints a list of lines progressively; the cursor sits on the last line while printing. */
export function Reveal({ lines, revealKey, stepMs }: { lines: ReactNode[]; revealKey: unknown; stepMs?: number }) {
  const shown = useReveal(lines.length, revealKey, stepMs);
  return (
    <>
      {lines.slice(0, shown).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {shown < lines.length ? <Cursor /> : null}
    </>
  );
}

export function hex(b: Uint8Array, chars?: number): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return chars ? s.slice(0, chars) : s;
}

export function trunc(s: string, head = 24): string {
  return s.length > head ? `${s.slice(0, head)}…` : s;
}
