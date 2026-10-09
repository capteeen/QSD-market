/**
 * The product video, as a page. A 1920×1080 stage with the site's own
 * quantum stack (@qsd/scene/stack), the hero dial, the blueprint callouts
 * and three terminal panels, driven by one clock: `window.__seek(t)` sets the
 * virtual time (performance.now is overridden by the render script), moves
 * the scroll progress the scene reads, and lays out every overlay for that
 * instant. The render script then screenshots the frame. Nothing here is
 * live data: the terminals print a real XMSS verification run in this page
 * and protocol constants, as the site's panels do.
 */
import { StrictMode, useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@qsd/ui-tokens/tokens.css';
import './video.css';
import { StackScene, kf, type StackAnchor, type StackPartId, type StackPose } from '@qsd/scene/stack';
import { LEN, W, signatureBytesForHeight } from '@qsd/crypto';
import { HALF_LIFE_PRESETS, MEASUREMENT_RESOLVER_ID, PROTOCOL_PARAMS, RESOLVER_DRAW_BYTES, decayProgressFor } from '@qsd/protocol';
import { runXmss, type XmssRun } from './xmssRun.js';

declare global {
  interface Window {
    __seek: (t: number) => Promise<void>;
    __ready: boolean;
    __error?: string;
  }
}

export const DURATION = 20;

// ── timeline ───────────────────────────────────────────────────────────
/** Scroll progress of the stack scene at time t (seconds). */
const progressAt = (t: number): number =>
  kf(t / DURATION, [
    [0, 0.02],
    [3.6 / DURATION, 0.17],
    [7.0 / DURATION, 0.42],
    [8.4 / DURATION, 0.56],
    [9.0 / DURATION, 0.6],
    [12.0 / DURATION, 0.72],
    [13.4 / DURATION, 0.84],
    [16.4 / DURATION, 0.98],
    [1, 0.99],
  ]);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number): number => x * x;

/** Presence 0…1 of a block that enters over [in0,in1] and leaves over [out0,out1]. */
function presence(t: number, in0: number, in1: number, out0: number, out1: number): { a: number; y: number } {
  if (t < in0 || t > out1) return { a: 0, y: 18 };
  if (t < in1) {
    const k = easeOut(clamp01((t - in0) / (in1 - in0)));
    return { a: k, y: 18 * (1 - k) };
  }
  if (t > out0) {
    const k = easeIn(clamp01((t - out0) / (out1 - out0)));
    return { a: 1 - k, y: -10 * k };
  }
  return { a: 1, y: 0 };
}

interface Block {
  el: HTMLElement;
  in0: number;
  in1: number;
  out0: number;
  out1: number;
}

const LEFT: StackPartId[] = ['intake', 'witness', 'chains', 'tree', 'superposition'];
const RIGHT: StackPartId[] = ['core', 'decay', 'measure', 'daughter', 'share', 'cables'];
const PARTS: Record<StackPartId, string> = {
  intake: 'quantum draw',
  witness: 'witness signature',
  cables: 'attested bytes',
  chains: 'WOTS+ chains',
  tree: 'Merkle root',
  superposition: 'superposition ranges',
  core: 'launch identity',
  decay: 'decay clock',
  measure: 'measurement',
  daughter: 'daughter coin',
  share: 'holder share',
};

/** The scene canvas is rendered larger than the stage and scaled down so the exploded stack never clips (see .v-scene). */
const SCENE_SCALE = 0.88;
const SCENE_DY = 28;
const VOID = [0x25, 0x24, 0x23];
const PAPER = [0xd9, 0xd7, 0xd2];
const mix = (t: number): string => `rgb(${VOID.map((v, i) => Math.round(v + ((PAPER[i] as number) - v) * t)).join(',')})`;

// ── dial ───────────────────────────────────────────────────────────────
const ARCS = [
  { from: -88, to: -2, color: 'var(--qsd-probability)' },
  { from: 2, to: 44, color: 'var(--qsd-collapse)' },
  { from: 48, to: 88, color: 'var(--qsd-decay)' },
  { from: 92, to: 134, color: 'var(--qsd-teal)' },
  { from: 138, to: 178, color: 'var(--qsd-ice)' },
  { from: 182, to: 268, color: 'var(--qsd-violet)' },
];
function arcPath(r: number, a0: number, a1: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = 50 + r * Math.cos(rad(a0));
  const y0 = 50 + r * Math.sin(rad(a0));
  const x1 = 50 + r * Math.cos(rad(a1));
  const y1 = 50 + r * Math.sin(rad(a1));
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
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
function Dial({ hollow, children, id }: { hollow: boolean; children?: ReactNode; id: string }): ReactElement {
  return (
    <div className="qsd-dial" data-dial={id} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="qsd-dial__svg">
        <circle cx="50" cy="50" r="48.6" fill="none" stroke="var(--qsd-border)" strokeWidth="0.5" />
        <g>
          {ARCS.map((a) => (
            <path key={a.from} d={arcPath(48.6, a.from, a.to)} fill="none" stroke={a.color} strokeWidth="1.1" />
          ))}
        </g>
        <circle cx="50" cy="50" r="45.4" fill="none" stroke="var(--qsd-border)" strokeWidth="0.35" />
        <g className="qsd-dial__ring" data-ring="outer">{ticks(44.6, 120, 2.6, 0.32, 'var(--qsd-collapse)', 0.75)}</g>
        <circle cx="50" cy="50" r="41.2" fill="none" stroke="var(--qsd-border)" strokeWidth="0.35" />
        <g className="qsd-dial__ring" data-ring="inner">{ticks(40.2, 72, 1.6, 0.3, 'var(--qsd-muted)', 0.6)}</g>
        <path d={arcPath(37.6, 196, 238)} fill="none" stroke="var(--qsd-muted)" strokeWidth="4.2" opacity="0.35" />
        <g className="qsd-dial__ring" data-ring="peach">
          <path d={arcPath(34.6, 22, 62)} fill="none" stroke="var(--qsd-rim)" strokeWidth="0.5" />
          <path d={arcPath(36.4, 26, 58)} fill="none" stroke="var(--qsd-rim)" strokeWidth="0.5" />
          <path d={arcPath(38.2, 30, 54)} fill="none" stroke="var(--qsd-rim)" strokeWidth="0.5" />
        </g>
        <circle cx="50" cy="50" r="33.4" fill="none" stroke="var(--qsd-border)" strokeWidth="0.3" strokeDasharray="0.6 1.6" />
        {hollow ? null : <g>{ticks(29, 36, 0.01, 0.6, 'var(--qsd-dead)')}</g>}
      </svg>
      {children ? <div className="qsd-dial__center">{children}</div> : null}
    </div>
  );
}
function spinDial(root: HTMLElement, t: number): void {
  const set = (ring: string, deg: number) => {
    const g = root.querySelector<SVGGElement>(`[data-ring="${ring}"]`);
    if (g) g.style.transform = `rotate(${deg.toFixed(3)}deg)`;
  };
  set('outer', (360 * t) / 140);
  set('inner', (-360 * t) / 90);
  set('peach', (360 * t) / 60);
}

// ── terminal pieces ────────────────────────────────────────────────────
function Term({ path, meta, lines, id }: { path: string; meta: string; lines: ReactNode[]; id: string }): ReactElement {
  return (
    <section className="qsd-term" data-term={id}>
      <header className="qsd-term__bar">
        <span className="qsd-term__dots">
          <i />
          <i />
          <i />
        </span>
        <span className="qsd-term__title">qsd@lab: {path}</span>
        <span className="qsd-term__meta">
          <span className="qsd-term__live" data-live />
          {meta}
        </span>
      </header>
      <div className="qsd-term__body">
        {lines.map((l, i) => (
          <div key={i} className={`qsd-term__line${i === 0 ? ' qsd-term__cmd' : ''}`} data-line={i} data-shown="false">
            {l}
          </div>
        ))}
      </div>
    </section>
  );
}
const Cmd = ({ children }: { children: ReactNode }): ReactElement => (
  <>
    <span className="qsd-term__prompt">qsd@lab</span>
    <span className="qsd-term__dim">:~$</span> {children}
  </>
);
const Kv = ({ k, children, tone }: { k: string; children: ReactNode; tone?: string }): ReactElement => (
  <span className="qsd-term__kv" style={{ display: 'grid' }}>
    <span className="qsd-term__dim">{k}</span>
    <span className="qsd-term__v" data-tone={tone ?? 'plain'}>
      {children}
    </span>
  </span>
);
const Comment = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="qsd-term__dim">
    <span className="qsd-term__caret">&gt;</span> {children}
  </span>
);
const Tag = ({ tone, children }: { tone: 'ok' | 'warn'; children: ReactNode }): ReactElement => (
  <>
    <span className="qsd-term__tag" data-tone={tone}>
      [{tone === 'ok' ? ' OK ' : 'WARN'}]
    </span>{' '}
    {children}
  </>
);
const hex = (b: Uint8Array, n?: number): string => {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return n ? s.slice(0, n) : s;
};

/** The XMSS verify panel from the site: a real key, signature and verification made in this page. */
function xmssLines(run: XmssRun): ReactNode[] {
  const shownChains = 5;
  const cells = (d: number): ReactNode => (
    <span className="qsd-term__cells">
      {Array.from({ length: W }, (_, k) => (
        <i key={k} className="qsd-term__cell" data-k={k < d ? 'signer' : k === d ? 'sig' : 'verify'} />
      ))}
    </span>
  );
  return [
    <Cmd key="c">xmss verify --live</Cmd>,
    <Comment key="g">fresh key generated in this browser · height {run.height} · {run.leaves} leaves</Comment>,
    <Kv key="root" k="public root">{`${hex(run.expectedRoot, 40)}…`}</Kv>,
    <Kv key="msg" k="msg">{`${hex(run.message, 40)}…`}</Kv>,
    <Kv key="leaf" k="leaf">{`${run.index} of ${run.leaves} · signature ${run.signatureBytes.toLocaleString()} B`}</Kv>,
    <Comment key="s"># sign σ[i] = H^d[i](sk[i]) · verify pk[i] =? H^({W - 1}-d[i])(σ[i])</Comment>,
    ...run.startDepths.slice(0, shownChains).map((d, i) => (
      <span key={`ch${i}`}>
        <span className="qsd-term__dim">{`chain ${String(i).padStart(2)}  `}</span>
        {cells(d)}
        <span className="qsd-term__dim">{`tip ${hex(run.tips[i] as Uint8Array, 16)}…`}</span>
      </span>
    )),
    <span key="more" className="qsd-term__dim">{`… ${LEN - shownChains} more chains · ${run.verifyChainSteps.toLocaleString()} verifier hashes in all`}</span>,
    <Kv key="r" k="recomputed root">{`${hex(run.computedRoot, 40)}…`}</Kv>,
    <Tag key="ok" tone={run.valid ? 'ok' : 'warn'}>
      {run.valid ? `signature verified · ${run.signatureBytes.toLocaleString()} B · sha-256 only · ${run.ms.toFixed(1)} ms in this browser` : 'signature rejected'}
    </Tag>,
  ];
}

/** The decay curve panel from the site: protocol math at the 6-hour preset, not a coin. */
function decayLines(): ReactNode[] {
  const HL = PROTOCOL_PARAMS.HALF_LIFE_MIN_SEC * 6;
  const hours = [0, 1, 3, 6, 12, 24, 48];
  const pct = (x: number): string => `${(x * 100).toFixed(1).padStart(5)} %`;
  return [
    <Cmd key="c">decay --curve</Cmd>,
    <Comment key="e">decayProgress = 1 − 2^(−quiet / half-life) · protocol constants</Comment>,
    <Kv key="hl" k="half-life">{`${HL / 3600} h (${HALF_LIFE_PRESETS.find((x) => x.halfLifeSec === HL)?.label ?? ''})`}</Kv>,
    <span key="h" className="qsd-term__dim">{'quiet   progress                 state'}</span>,
    ...hours.map((h) => {
      const quiet = h * 3600;
      const p = decayProgressFor(quiet, HL);
      const due = quiet >= PROTOCOL_PARAMS.AUTO_MEASURE_HALF_LIVES * HL;
      return (
        <span key={h}>
          <span className="qsd-term__dim">{`${String(h).padStart(2)} h  `}</span>
          <span className="qsd-term__bar-inline" style={{ ['--p' as string]: p }} />
          {` ${pct(p)}  `}
          <span className={due ? 'qsd-term__v' : 'qsd-term__dim'} data-tone={due ? 'warn' : 'dim'}>
            {due ? 'auto-measure due' : 'quiet'}
          </span>
        </span>
      );
    }),
    <span key="z" className="qsd-term__dim">{`a buy worth x of market cap removes min(${PROTOCOL_PARAMS.ZENO_RESET_CAP_BPS / 100} %, ${PROTOCOL_PARAMS.ZENO_K}·x) of the quiet time`}</span>,
  ];
}

/** The public resolver panel from the site: the rule, from its own constants. Draws nothing. */
function resolverLines(): ReactNode[] {
  const ppm = (x: number): string => `${(x / 10_000).toFixed(1)} %`;
  const bps = (x: number): string => `${(x / 100).toFixed(x % 100 ? 1 : 0)} %`;
  return [
    <Cmd key="c">resolver --describe</Cmd>,
    <Kv key="id" k="resolver">{MEASUREMENT_RESOLVER_ID}</Kv>,
    <Kv key="d" k="draw" tone="ice">{`${RESOLVER_DRAW_BYTES} bytes from the QRNG, witness-signed verbatim`}</Kv>,
    <span key="r1">{'u[0] < decayProgress        → collapse, else survive'}</span>,
    <span key="r2">{`u[1] < ${ppm(PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM)}                → tunnel (the coin re-emerges as itself)`}</span>,
    <span key="r3">{'u[2] picks the channel; u[3] picks the pool point in the channel’s band'}</span>,
    <Kv key="b" k="collapse burn">{bps(PROTOCOL_PARAMS.COLLAPSE_BURN_BPS)}</Kv>,
    <Kv key="m" k="measurer share">{bps(PROTOCOL_PARAMS.MEASURER_SHARE_OF_BURN_BPS)}</Kv>,
    <Comment key="n">the same bytes and inputs always give the same outcome; anyone can recompute it</Comment>,
    <Comment key="nc">no coin was measured by this panel; it prints the rule, not a draw</Comment>,
  ];
}

// ── the stage ──────────────────────────────────────────────────────────
function Stage(): ReactElement {
  const progress = useRef(0.02);
  const stage = useRef<HTMLDivElement>(null);
  const run = useMemo(() => runXmss(3), []);
  const xmss = useMemo(() => xmssLines(run), [run]);
  const decay = useMemo(() => decayLines(), []);
  const resolver = useMemo(() => resolverLines(), []);
  const pose = useRef<{ anchors: readonly StackAnchor[]; pose: StackPose } | null>(null);

  const onAnchors = (anchors: readonly StackAnchor[], p: StackPose): void => {
    pose.current = { anchors: anchors.map((a) => ({ ...a, x: a.x * SCENE_SCALE, y: a.y * SCENE_SCALE + SCENE_DY, r: a.r * SCENE_SCALE })), pose: { ...p } };
    layoutScene();
  };

  /** Everything that follows the scene's own frame: background, dial, callouts. */
  const layoutScene = (): void => {
    const st = stage.current;
    const cur = pose.current;
    if (!st || !cur) return;
    const { anchors, pose: p } = cur;
    const bg = st.querySelector<HTMLElement>('.v-bg');
    if (bg) bg.style.backgroundColor = mix(p.mode);
    st.querySelector<HTMLElement>('.v-header')?.setAttribute('data-paper', p.mode > 0.5 ? 'true' : 'false');
    const center = anchors.find((a) => a.id === 'center');
    const dial = st.querySelector<HTMLElement>('.v-dial');
    if (dial && center) {
      const d = center.r * 2.35;
      dial.style.opacity = String(p.dial);
      dial.style.transform = `translate(${(center.x - d / 2).toFixed(1)}px, ${(center.y - d / 2).toFixed(1)}px)`;
      dial.style.width = dial.style.height = `${d.toFixed(1)}px`;
    }
    const svg = st.querySelector<SVGSVGElement>('.v-lines');
    if (svg) {
      svg.style.opacity = String(p.callouts);
      const sr = st.getBoundingClientRect();
      for (const a of anchors) {
        if (a.id === 'center') continue;
        const label = st.querySelector<HTMLElement>(`.qsd-callout[data-part="${a.id}"]`);
        const path = svg.querySelector<SVGPathElement>(`[data-line="${a.id}"]`);
        if (!label || !path) continue;
        const lr = label.getBoundingClientRect();
        const left = LEFT.includes(a.id);
        const x0 = (left ? lr.right : lr.left) - sr.left + (left ? 10 : -10);
        const y0 = lr.top - sr.top + lr.height / 2;
        const bend = left ? Math.max(x0 + 40, a.x - Math.abs(a.y - y0)) : Math.min(x0 - 40, a.x + Math.abs(a.y - y0));
        path.setAttribute('d', `M ${x0.toFixed(1)} ${y0.toFixed(1)} H ${bend.toFixed(1)} L ${a.x.toFixed(1)} ${a.y.toFixed(1)}`);
        path.style.opacity = a.visible ? '1' : '0';
        const dot = svg.querySelector<SVGCircleElement>(`[data-dot="${a.id}"]`);
        if (dot) {
          dot.setAttribute('cx', a.x.toFixed(1));
          dot.setAttribute('cy', a.y.toFixed(1));
        }
        label.style.opacity = String(p.callouts);
      }
    }
  };

  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    const q = <T extends Element>(sel: string): T => {
      const el = st.querySelector<T>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    };
    const blocks: Block[] = [
      { el: q('[data-block="hero"]'), in0: 0.25, in1: 1.0, out0: 3.3, out1: 3.75 },
      { el: q('[data-block="launch"]'), in0: 3.9, in1: 4.5, out0: 6.9, out1: 7.3 },
      { el: q('[data-term-wrap="xmss"]'), in0: 4.3, in1: 4.9, out0: 6.9, out1: 7.3 },
      { el: q('[data-block="decay"]'), in0: 7.6, in1: 8.2, out0: 10.1, out1: 10.5 },
      { el: q('[data-term-wrap="decay"]'), in0: 7.9, in1: 8.5, out0: 10.1, out1: 10.5 },
      { el: q('[data-block="measure"]'), in0: 10.7, in1: 11.3, out0: 13.0, out1: 13.4 },
      { el: q('[data-term-wrap="resolver"]'), in0: 11.0, in1: 11.6, out0: 13.0, out1: 13.4 },
      { el: q('[data-block="collapse"]'), in0: 13.6, in1: 14.2, out0: 16.3, out1: 16.8 },
    ];
    const terms: { el: HTMLElement; start: number; step: number }[] = [
      { el: q('[data-term="xmss"]'), start: 4.45, step: 0.11 },
      { el: q('[data-term="decay"]'), start: 8.05, step: 0.11 },
      { el: q('[data-term="resolver"]'), start: 11.15, step: 0.11 },
    ];
    const scrub = q<HTMLElement>('.v-scrub');
    const end = q<HTMLElement>('.v-end');
    const heroDial = q<HTMLElement>('.v-dial .qsd-dial');
    const endDial = q<HTMLElement>('.v-end .qsd-dial');

    const layout = (t: number): void => {
      for (const b of blocks) {
        const { a, y } = presence(t, b.in0, b.in1, b.out0, b.out1);
        b.el.style.opacity = a.toFixed(3);
        b.el.style.transform = `translateY(${y.toFixed(2)}px)`;
      }
      for (const tm of terms) {
        const n = Math.floor((t - tm.start) / tm.step);
        const lines = tm.el.querySelectorAll<HTMLElement>('[data-line]');
        lines.forEach((l, i) => l.setAttribute('data-shown', i < n ? 'true' : 'false'));
        const live = tm.el.querySelector<HTMLElement>('[data-live]');
        if (live) live.style.opacity = n < lines.length ? String(0.4 + 0.6 * Math.abs(Math.sin(t * 2.2))) : '0';
      }
      const p = progressAt(t);
      scrub.style.setProperty('--p', p.toFixed(4));
      scrub.style.opacity = t > 3.9 && t < 16.5 ? '1' : '0';
      spinDial(heroDial, t);
      spinDial(endDial, t);
      const e = presence(t, 16.7, 17.4, 99, 100);
      end.style.opacity = e.a.toFixed(3);
      const endIn = clamp01((t - 16.9) / 0.9);
      end.querySelector<HTMLElement>('.v-end__mark')!.style.opacity = easeOut(endIn).toFixed(3);
      end.querySelector<HTMLElement>('.v-end__mark')!.style.transform = `translateY(${(12 * (1 - easeOut(endIn))).toFixed(2)}px)`;
      end.querySelector<HTMLElement>('.v-end__foot')!.style.opacity = easeOut(clamp01((t - 17.6) / 0.8)).toFixed(3);
    };

    const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
    window.__seek = async (t: number): Promise<void> => {
      (window as unknown as { __now: number }).__now = t * 1000;
      progress.current = progressAt(t);
      layout(t);
      // the scene renders on its own animation frame with the new clock; a
      // second frame catches anything that read the previous one
      await raf();
      await raf();
      layoutScene();
      await raf();
    };
    layout(0);
    window.__ready = true;
  }, []);

  const label = (id: StackPartId, side: 'left' | 'right'): ReactNode => (
    <span key={id} className="qsd-callout" data-side={side} data-part={id}>
      {PARTS[id]}
    </span>
  );

  return (
    <div ref={stage} className="v-stage">
      <div className="v-bg" />
      <div className="v-scene">
        <StackScene progress={progress} layout="desktop" running onAnchors={onAnchors} />
      </div>
      <div className="v-dial">
        <Dial hollow id="hero" />
      </div>
      <svg className="v-lines" aria-hidden="true">
        {[...LEFT, ...RIGHT].map((id) => (
          <g key={id}>
            <path data-line={id} d="" />
            <circle data-dot={id} r="2.5" />
          </g>
        ))}
      </svg>
      <div className="v-labels v-labels--left">{LEFT.map((id) => label(id, 'left'))}</div>
      <div className="v-labels v-labels--right">{RIGHT.map((id) => label(id, 'right'))}</div>

      <header className="v-header" data-paper="false">
        <span className="qsd-logo">
          <span className="qsd-logo__word">QSD</span>
          <span className="qsd-logo__dot" />
        </span>
        <nav className="v-nav">
          <span>Field</span>
          <span>Measure</span>
          <span>Burns</span>
          <span>How it works</span>
          <span>Me</span>
        </nav>
        <span className="v-url">qsd.market</span>
      </header>

      {/* hero */}
      <div className="v-copy v-copy--top" data-block="hero">
        <span className="v-eyebrow">Quantum State Decay · a pump.fun launchpad on Solana</span>
        <h1 className="v-title v-title--hero">Your coin dies. Your bag doesn’t.</h1>
        <p className="v-body">A coin that stops trading decays; when a measurement resolves to collapse, a daughter coin is born and every holder of the mother receives a share of it at birth.</p>
        <div className="v-ctas">
          <span className="qsd-btn" data-primary="true">launch a coin</span>
          <span className="qsd-btn">how it works ↓</span>
        </div>
      </div>

      {/* 01 launch (dark, pulled apart) */}
      <div className="v-copy v-copy--bottom" data-block="launch" style={{ ['--v-accent' as string]: 'var(--qsd-collapse)' }}>
        <span className="v-eyebrow">
          <b>01</b> · launch
        </span>
        <h2 className="v-title">
          Launch <em>in superposition.</em>
        </h2>
        <p className="v-body">A coin launches on pump.fun with its parameters published as ranges and a hash-based identity you can verify.</p>
        <ul className="v-arrows">
          <li>parameters published as ranges</li>
          <li>hash-based launch identity</li>
          <li>anchored on Solana</li>
        </ul>
      </div>
      <div className="v-term" data-term-wrap="xmss">
        <Term id="xmss" path="~/identity" meta="xmss · fresh key each run" lines={xmss} />
      </div>

      {/* 02 decay (paper, blueprint) */}
      <div className="v-copy v-copy--top" data-block="decay" data-ink="true" style={{ ['--v-accent' as string]: 'var(--qsd-decay)' }}>
        <span className="v-eyebrow">
          <b>02</b> · decay
        </span>
        <h2 className="v-title">
          Quiet time
          <br />
          <em>decays it.</em>
        </h2>
        <p className="v-body">A half-life is published at launch. While nobody buys, the coin loses health; every buy resets part of the quiet time.</p>
        <span className="v-tag">illustration · not live data</span>
      </div>
      <div className="v-term" data-term-wrap="decay">
        <Term id="decay" path="~/decay" meta="protocol math · no coin" lines={decay} />
      </div>

      {/* 03 measure (paper) */}
      <div className="v-copy v-copy--top" data-block="measure" data-ink="true" style={{ ['--v-accent' as string]: 'var(--qsd-ice)' }}>
        <span className="v-eyebrow">
          <b>03</b> · measure
        </span>
        <h2 className="v-title">
          Anyone can <em>measure.</em>
        </h2>
        <p className="v-body">Bytes from a hardware quantum random number generator, witness-signed, resolved by a public rule anyone can recompute.</p>
        <ul className="v-arrows">
          <li>bytes from a hardware QRNG</li>
          <li>witness-signed response</li>
          <li>public, deterministic resolver</li>
        </ul>
      </div>
      <div className="v-term" data-term-wrap="resolver">
        <Term id="resolver" path="~/measure" meta="public resolver · constants only" lines={resolver} />
      </div>

      {/* 04 collapse (paper, reassembled) */}
      <div className="v-copy v-copy--bottom" data-block="collapse" data-ink="true" style={{ ['--v-accent' as string]: 'var(--qsd-probability)' }}>
        <span className="v-eyebrow">
          <b>04</b> · collapse
        </span>
        <h2 className="v-title">
          Collapse births
          <br />
          <em>a daughter.</em>
        </h2>
        <p className="v-body">A daughter coin launches automatically, shaped by how the mother died, and every holder of the mother gets a share at birth. The position survives the coin.</p>
        <ul className="v-arrows">
          <li>parameters follow how the mother died</li>
          <li>every holder gets a share at birth</li>
          <li>a new coin, which can fail</li>
        </ul>
      </div>

      <div className="v-scrub">
        {Array.from({ length: 41 }, (_, i) => (
          <i key={i} />
        ))}
        <b />
      </div>

      {/* end card */}
      <div className="v-end">
        <div className="v-end__dial">
          <Dial hollow={false} id="end" />
          <div className="v-end__mark">
            <div>
              <img className="v-end__logo" src="/logo-wordmark.png" alt="QSD" width={606} height={374} />
              <div className="v-end__url">qsd.market</div>
              <div className="v-end__line">Your coin dies. Your bag doesn’t.</div>
            </div>
          </div>
        </div>
        <div className="v-end__foot">A daughter coin is a new coin and can fail. QSD guarantees a share of the next attempt, not a return. Coins launch on pump.fun (Solana). A meme, not an investment.</div>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
window.addEventListener('error', (e) => {
  window.__error = String(e.message);
});
createRoot(root).render(
  <StrictMode>
    <Stage />
  </StrictMode>,
);
