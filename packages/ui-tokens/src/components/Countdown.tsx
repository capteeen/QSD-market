import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Unavailable } from './Unavailable.js';

export interface CountdownProps {
  /** Absolute target as an ISO-8601 timestamp. `undefined` → "no scheduled time". */
  target?: string | undefined;
  /** Why there is no target. */
  unavailable?: { reason: string };
  /** Text shown once the target has passed. Default "00:00:00". */
  elapsedLabel?: string;
  /** Called once when the countdown reaches zero. */
  onElapsed?: () => void;
  /** Injectable clock for tests. Default `Date.now`. */
  now?: () => number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Formats a non-negative millisecond remainder as HH:MM:SS (hours may exceed 99). */
export function formatHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Parses an ISO timestamp; returns undefined if invalid. */
export function parseTarget(target: string | undefined): number | undefined {
  if (!target) return undefined;
  const t = Date.parse(target);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * Mono HH:MM:SS countdown to an absolute time. Ticks once per second via
 * setInterval (rAF is wasteful for 1Hz). Each change fades slowly in.
 */
export function Countdown({
  target,
  unavailable,
  elapsedLabel = '00:00:00',
  onElapsed,
  now = () => Date.now(),
  size = 'md',
  className,
}: CountdownProps): ReactElement {
  const targetMs = parseTarget(target);
  const [remaining, setRemaining] = useState<number | undefined>(() =>
    targetMs === undefined ? undefined : targetMs - now(),
  );
  const [fading, setFading] = useState(false);
  const elapsedFired = useRef(false);

  useEffect(() => {
    if (targetMs === undefined) {
      setRemaining(undefined);
      return undefined;
    }
    elapsedFired.current = false;
    const tick = (): void => {
      const r = targetMs - now();
      setRemaining(r);
      setFading(true);
      if (r <= 0 && !elapsedFired.current) {
        elapsedFired.current = true;
        onElapsed?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // `now` and `onElapsed` are intentionally not deps: callers pass inline fns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMs]);

  // Clear the fade shortly after each tick so the next tick fades again.
  useEffect(() => {
    if (!fading) return undefined;
    const id = setTimeout(() => setFading(false), 50);
    return () => clearTimeout(id);
  }, [fading, remaining]);

  const base = ['qsd-countdown', 'qsd-mono', className].filter(Boolean).join(' ');

  if (targetMs === undefined) {
    return (
      <span className={base} data-size={size} data-unavailable="true">
        <Unavailable
          label="no scheduled time"
          reason={unavailable?.reason ?? (target ? 'target timestamp is not valid ISO-8601' : 'no target was given')}
        />
      </span>
    );
  }

  const elapsed = (remaining ?? 0) <= 0;

  return (
    <time
      className={base}
      dateTime={target}
      data-size={size}
      data-fading={fading ? 'true' : 'false'}
      data-elapsed={elapsed ? 'true' : 'false'}
      aria-live="off"
      title={target}
    >
      {elapsed ? elapsedLabel : formatHMS(remaining ?? 0)}
    </time>
  );
}
