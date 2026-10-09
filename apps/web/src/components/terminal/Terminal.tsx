'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TERM } from '@/copy';

/**
 * A terminal-style panel (from the terminal-UI work, PR #4). Every line
 * printed in one comes from a real operation run in this browser, a protocol
 * constant, or an API field, or it says plainly that the data is not
 * available. Colours are ui-tokens variables (styles/terminal.css).
 */
export function Terminal({ path, meta, children, className, live, testId }: { path: string; meta?: ReactNode; children: ReactNode; className?: string | undefined; live?: boolean; testId?: string }) {
  return (
    <section className={`qsd-term ${className ?? ''}`} data-testid={testId} aria-label={`${TERM.user}@${TERM.host} ${path}`}>
      <header className="qsd-term__bar" data-term-chrome="">
        <span className="qsd-term__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="qsd-term__title">
          {TERM.user}@{TERM.host}: {path}
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
        {TERM.user}@{TERM.host}
      </span>
      <span className="qsd-term__dim">:~$</span> {children}
      {cursor ? <Cursor /> : null}
    </div>
  );
}

export function Cursor() {
  return <span className="qsd-term__cursor" aria-hidden="true" />;
}

export function Out({ children, dim, className }: { children: ReactNode; dim?: boolean; className?: string }) {
  return <div className={`qsd-term__line ${dim ? 'qsd-term__dim' : ''} ${className ?? ''}`}>{children}</div>;
}

export function Comment({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <div className="qsd-term__line qsd-term__comment" data-active={active ? 'true' : 'false'}>
      <span className="qsd-term__caret">{active ? '>' : ' '}</span> {children}
    </div>
  );
}

export type Tone = 'plain' | 'ok' | 'warn' | 'fail' | 'dim';

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
 * already real and complete; this only paces how it is printed.
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

/**
 * True once the element has been on screen. Without IntersectionObserver
 * (an old browser, a test DOM) it stays false, so a panel that gates its
 * computation on it prints only its idle prompt.
 */
export function useInView<T extends HTMLElement>(margin = '0px 0px -20% 0px'): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen];
}

/** Idle body for a terminal that has not come on screen yet (no digits). */
export function Waiting({ cmd }: { cmd: string }) {
  return (
    <>
      <Cmd>{cmd}</Cmd>
      <Out dim>
        {TERM.waiting}
        <Cursor />
      </Out>
    </>
  );
}

/** Prompt identity, re-exported for pages that compose their own title bars. */
export const TERM_USER = TERM.user;
export const TERM_HOST = TERM.host;

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

export function trunc(s: string, head = 24): string {
  return s.length > head ? `${s.slice(0, head)}…` : s;
}

export function hex(b: Uint8Array, chars?: number): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return chars ? s.slice(0, chars) : s;
}
