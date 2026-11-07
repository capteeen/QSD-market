'use client';
import { forwardRef } from 'react';

const TICKS = 56;

/** The tick-mark scroll scrubber at the bottom right; the host moves the red indicator via the ref (CSS variable --p). */
export const Scrubber = forwardRef<HTMLDivElement>(function Scrubber(_, ref) {
  return (
    <div ref={ref} className="qsd-scrub" aria-hidden="true">
      {Array.from({ length: TICKS }, (_, i) => (
        <i key={i} className="qsd-scrub__tick" style={{ ['--i' as string]: i / (TICKS - 1) }} />
      ))}
      <i className="qsd-scrub__cursor" />
    </div>
  );
});
