'use client';
import type { CSSProperties, ReactNode } from 'react';

/**
 * The dial: concentric tick rings with six coloured arcs, in the manner of
 * the animejs.com gauge. Decorative chrome around a centre object; it reads
 * no data. Colours are ui-tokens variables so a section can set its accent.
 */
const ARCS: { from: number; to: number; color: string }[] = [
  { from: -88, to: -2, color: 'var(--qsd-probability)' },
  { from: 2, to: 44, color: 'var(--qsd-collapse)' },
  { from: 48, to: 88, color: 'var(--qsd-decay)' },
  { from: 92, to: 134, color: 'var(--qsd-teal)' },
  { from: 138, to: 178, color: 'var(--qsd-ice)' },
  { from: 182, to: 268, color: 'var(--qsd-violet)' },
];

const TICK_OUTER = 'var(--qsd-collapse)';
const TICK_INNER = 'var(--qsd-muted)';
const TICK_DOTS = 'var(--qsd-dead)';

function arcPath(r: number, a0: number, a1: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = 50 + r * Math.cos(rad(a0));
  const y0 = 50 + r * Math.sin(rad(a0));
  const x1 = 50 + r * Math.cos(rad(a1));
  const y1 = 50 + r * Math.sin(rad(a1));
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

function ticks(r: number, count: number, len: number, w: number, color: string, opacity = 1): ReactNode {
  const out: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push(<line key={i} x1={50 + r * c} y1={50 + r * s} x2={50 + (r - len) * c} y2={50 + (r - len) * s} stroke={color} strokeWidth={w} opacity={opacity} />);
  }
  return out;
}

export interface DialProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Idle rotation of the tick rings (decorative; off with reduced motion via CSS). */
  spinning?: boolean;
  /** Draw only the rings (the hero: the 3D object sits in the middle). */
  hollow?: boolean;
}

export function Dial({ children, className, style, spinning = true, hollow = false }: DialProps) {
  return (
    <div className={`qsd-dial ${className ?? ''}`} style={style} data-spinning={spinning ? 'true' : 'false'} data-hollow={hollow ? 'true' : 'false'} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="qsd-dial__svg">
        <circle cx="50" cy="50" r="48.6" fill="none" stroke="var(--qsd-border)" strokeWidth="0.5" />
        <g className="qsd-dial__arcs">
          {ARCS.map((a) => (
            <path key={a.from} d={arcPath(48.6, a.from, a.to)} fill="none" stroke={a.color} strokeWidth="1.1" strokeLinecap="butt" />
          ))}
        </g>
        <circle cx="50" cy="50" r="45.4" fill="none" stroke="var(--qsd-border)" strokeWidth="0.35" />
        <g className="qsd-dial__ring qsd-dial__ring--outer">{ticks(44.6, 120, 2.6, 0.32, TICK_OUTER, 0.75)}</g>
        <circle cx="50" cy="50" r="41.2" fill="none" stroke="var(--qsd-border)" strokeWidth="0.35" />
        <g className="qsd-dial__ring qsd-dial__ring--inner">{ticks(40.2, 72, 1.6, 0.3, TICK_INNER, 0.6)}</g>
        <path d={arcPath(37.6, 196, 238)} fill="none" stroke="var(--qsd-muted)" strokeWidth="4.2" opacity="0.35" strokeLinecap="butt" />
        <g className="qsd-dial__ring qsd-dial__ring--peach">
          <path d={arcPath(34.6, 22, 62)} fill="none" stroke="var(--qsd-rim)" strokeWidth="0.5" />
          <path d={arcPath(36.4, 26, 58)} fill="none" stroke="var(--qsd-rim)" strokeWidth="0.5" />
          <path d={arcPath(38.2, 30, 54)} fill="none" stroke="var(--qsd-rim)" strokeWidth="0.5" />
        </g>
        <circle cx="50" cy="50" r="33.4" fill="none" stroke="var(--qsd-border)" strokeWidth="0.3" strokeDasharray="0.6 1.6" />
        {hollow ? null : <g className="qsd-dial__dots">{ticks(29, 36, 0.01, 0.6, TICK_DOTS)}</g>}
      </svg>
      {children ? <div className="qsd-dial__center">{children}</div> : null}
    </div>
  );
}
