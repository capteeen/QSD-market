import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Unavailable } from './Unavailable.js';

export interface HashDisplayProps {
  /** Hex or base58 string. `undefined` or empty renders "no hash". */
  hash?: string | undefined;
  /** Characters kept at the start. Default 8. */
  head?: number;
  /** Characters kept at the end. Default 6. */
  tail?: number;
  /** Show the full string instead of the middle-ellipsis. */
  full?: boolean;
  /** Hide the copy button. */
  copyable?: boolean;
  /** Why there is no hash. Shown in the empty state. */
  unavailable?: { reason: string };
  /** Called after a successful copy. */
  onCopied?: (hash: string) => void;
  /** How long the "copied" feedback stays, in ms. Default 1400 (viscous). */
  feedbackMs?: number;
  className?: string;
}

export function truncateMiddle(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/**
 * Renders a hash with a middle ellipsis, the full value in `title`, and a
 * copy button with "copied" feedback. Empty → "no hash" (never a dummy hash).
 */
export function HashDisplay({
  hash,
  head = 8,
  tail = 6,
  full = false,
  copyable = true,
  unavailable,
  onCopied,
  feedbackMs = 1400,
  className,
}: HashDisplayProps): ReactElement {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    if (!hash) return;
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(hash);
      setCopied('copied');
      onCopied?.(hash);
    } catch {
      setCopied('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied('idle'), feedbackMs);
  }, [hash, onCopied, feedbackMs]);

  if (!hash) {
    return (
      <span className={['qsd-hash', className].filter(Boolean).join(' ')} data-empty="true">
        <Unavailable label="no hash" reason={unavailable?.reason ?? 'nothing has been hashed yet'} />
      </span>
    );
  }

  const shown = full ? hash : truncateMiddle(hash, head, tail);

  return (
    <span className={['qsd-hash', className].filter(Boolean).join(' ')}>
      <code className="qsd-hash__text qsd-mono" title={hash} aria-label={hash}>
        {shown}
      </code>
      {copyable ? (
        <button
          type="button"
          className="qsd-hash__copy"
          onClick={() => void copy()}
          data-copied={copied === 'copied' ? 'true' : 'false'}
          aria-live="polite"
        >
          {copied === 'copied' ? 'copied' : copied === 'failed' ? 'copy failed' : 'copy'}
        </button>
      ) : null}
    </span>
  );
}
