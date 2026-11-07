'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Countdown, colors } from '@qsd/ui-tokens';
import type { StackAnchor, StackPose, StackSceneProps, StackPartId } from '@qsd/scene/stack';
import { HOME, STORY } from '@/copy';
import { routes } from '@/lib/links';
import { Dial } from './Dial';
import { Scrubber } from './Scrubber';
import { hasWebGL, reducedMotion, useMediaQuery, useScrollProgress } from './useStory';

const CHAPTERS = 4;
/** Callout labels, in the column they hang from. */
const LEFT: StackPartId[] = ['intake', 'witness', 'chains', 'tree', 'superposition'];
const RIGHT: StackPartId[] = ['core', 'decay', 'measure', 'daughter', 'share', 'cables'];

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
const VOID = hexToRgb(colors.void);
const PAPER = hexToRgb(colors.paper);
const mix = (t: number): string => `rgb(${VOID.map((v, i) => Math.round(v + ((PAPER[i] as number) - v) * t)).join(',')})`;

export interface StackStoryProps {
  /** The next-burn countdown target, or null with the reason it is unavailable (rendered in the hero). */
  nextBurn: string | null;
  burnReason: string;
}

/**
 * The home-page story: a sticky stage (the 3D quantum stack, the hero dial,
 * the blueprint callouts, the scrubber) under four scroll chapters. The
 * scene is loaded only when WebGL exists; otherwise the chapters stand on
 * their own with the dial as the hero graphic.
 */
export function StackStory({ nextBurn, burnReason }: StackStoryProps) {
  const container = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const dial = useRef<HTMLDivElement>(null);
  const lines = useRef<SVGSVGElement>(null);
  const scrub = useRef<HTMLDivElement>(null);
  const labels = useRef<Map<string, HTMLElement>>(new Map());
  const wide = useMediaQuery('(min-width: 900px)', true);
  const { progress, chapter, visible } = useScrollProgress(container, CHAPTERS);
  const [Scene, setScene] = useState<ComponentType<StackSceneProps> | null>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    setStill(reducedMotion());
    if (!hasWebGL()) return;
    let on = true;
    import('@qsd/scene/stack').then((m) => on && setScene(() => m.StackScene)).catch(() => undefined);
    return () => {
      on = false;
    };
  }, []);

  const onAnchors = useCallback((anchors: readonly StackAnchor[], pose: StackPose) => {
    const st = stage.current;
    if (!st) return;
    if (bg.current) bg.current.style.backgroundColor = mix(pose.mode);
    const center = anchors.find((a) => a.id === 'center');
    if (dial.current && center) {
      const d = center.r * 2.35;
      dial.current.style.opacity = String(pose.dial);
      dial.current.style.transform = `translate(${(center.x - d / 2).toFixed(1)}px, ${(center.y - d / 2).toFixed(1)}px)`;
      dial.current.style.width = dial.current.style.height = `${d.toFixed(1)}px`;
    }
    const svg = lines.current;
    if (svg) {
      svg.style.opacity = String(pose.callouts);
      const sr = st.getBoundingClientRect();
      for (const a of anchors) {
        if (a.id === 'center') continue;
        const label = labels.current.get(a.id);
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
        label.style.opacity = String(pose.callouts);
      }
    }
    if (scrub.current) {
      scrub.current.style.setProperty('--p', String(progress.current));
      scrub.current.style.opacity = progress.current > 0.12 ? '1' : '0';
    }
  }, [progress]);

  const setLabel = (id: string) => (el: HTMLElement | null) => {
    if (el) labels.current.set(id, el);
    else labels.current.delete(id);
  };

  const label = (id: StackPartId, side: 'left' | 'right'): ReactNode => (
    <span key={id} ref={setLabel(id)} className="qsd-callout" data-side={side} data-part={id}>
      {STORY.parts[id]}
    </span>
  );

  return (
    <section ref={container} className="qsd-story" style={{ height: `${CHAPTERS * 100}vh` }} data-chapter={chapter} data-scene={Scene ? 'webgl' : 'none'}>
      <div ref={stage} className="qsd-story__stage">
        <div ref={bg} className="qsd-story__bg" />
        {Scene ? (
          <div className="qsd-story__scene">
            <Scene progress={progress} layout={wide ? 'desktop' : 'mobile'} reducedMotion={still} running={visible} onAnchors={onAnchors} />
          </div>
        ) : null}
        <div ref={dial} className="qsd-story__dial" style={Scene ? undefined : { opacity: chapter === 0 ? 1 : 0 }}>
          <Dial hollow={!!Scene} spinning={!still}>
            {Scene ? null : <span className="qsd-story__coreGlyph" aria-hidden="true" />}
          </Dial>
        </div>
        {wide && Scene ? (
          <>
            <svg ref={lines} className="qsd-story__lines" aria-hidden="true">
              {[...LEFT, ...RIGHT].map((id) => (
                <g key={id}>
                  <path data-line={id} d="" />
                  <circle data-dot={id} r="2.5" />
                </g>
              ))}
            </svg>
            <div className="qsd-story__labels qsd-story__labels--left">{LEFT.map((id) => label(id, 'left'))}</div>
            <div className="qsd-story__labels qsd-story__labels--right">{RIGHT.map((id) => label(id, 'right'))}</div>
          </>
        ) : null}
        <Scrubber ref={scrub} />
      </div>

      {/* chapter 0 — hero */}
      <div className="qsd-chapter qsd-chapter--hero" data-theme="darkfield">
        <div className="qsd-chapter__inner">
          <div className="qsd-hero">
            <span className="qsd-eyebrow">{STORY.heroEyebrow}</span>
            <h1 className="qsd-hero__title">{STORY.heroTitle}</h1>
            <p className="qsd-hero__sub">{HOME.sentence}</p>
            <div className="qsd-hero__ctas">
              <Link href={routes.launch} className="qsd-btn" data-primary="true">
                {STORY.heroCtaLaunch}
              </Link>
              <Link href={routes.how} className="qsd-btn">
                {STORY.heroCtaHow} <span aria-hidden="true">↓</span>
              </Link>
            </div>
            <div className="qsd-hero__burn">
              <span className="qsd-eyebrow">{HOME.nextBurnLabel}</span>
              <Countdown size="sm" {...(nextBurn ? { target: nextBurn } : { unavailable: { reason: burnReason } })} />
            </div>
          </div>
          <span className="qsd-hero__scroll" aria-hidden="true">
            {STORY.heroScroll}
          </span>
        </div>
      </div>

      {/* chapter 1 — pulled apart */}
      <div className="qsd-chapter qsd-chapter--apart" data-theme="darkfield">
        <div className="qsd-chapter__inner qsd-chapter__inner--bottom">
          <div className="qsd-chapter__copy">
            <span className="qsd-eyebrow">{STORY.apartEyebrow}</span>
            <h2 className="qsd-chapter__title">{STORY.apartTitle}</h2>
            <p className="qsd-chapter__body">{STORY.apartBody}</p>
          </div>
        </div>
      </div>

      {/* chapter 2 — the blueprint */}
      <div className="qsd-chapter qsd-chapter--blueprint" data-theme="brightfield">
        <div className="qsd-chapter__inner">
          <div className="qsd-chapter__copy">
            <span className="qsd-eyebrow">{STORY.blueprintEyebrow}</span>
            <h2 className="qsd-chapter__title">{STORY.blueprintTitle}</h2>
            <p className="qsd-chapter__body">{STORY.blueprintBody}</p>
            <span className="qsd-tag">{STORY.illustration}</span>
          </div>
          {!wide || !Scene ? (
            <ul className="qsd-partlist">
              {[...LEFT, ...RIGHT].map((id) => (
                <li key={id}>{STORY.parts[id]}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {/* chapter 3 — reassembled */}
      <div className="qsd-chapter qsd-chapter--rebuilt" data-theme="brightfield">
        <div className="qsd-chapter__inner qsd-chapter__inner--bottom">
          <div className="qsd-chapter__copy">
            <span className="qsd-eyebrow">{STORY.rebuiltEyebrow}</span>
            <h2 className="qsd-chapter__title">{STORY.rebuiltTitle}</h2>
            <p className="qsd-chapter__body">{STORY.rebuiltBody}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
