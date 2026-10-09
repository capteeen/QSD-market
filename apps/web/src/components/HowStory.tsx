'use client';
/**
 * The scroll story on the home page: a pinned 3D illustration with one text
 * card per chapter scrolling over it. Scroll position drives the scene,
 * the pointer tilts it and pushes the cloud, a tap is a buy. Nothing here
 * reads live data; the on-screen label says so.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { StoryInput } from '@qsd/scene';
import { STORY } from '@/copy';
import { StoryScene } from '@/components/scenes';

const CHAPTERS = STORY.chapters.length;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export function HowStory(): ReactElement {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const input = useRef<StoryInput>({ progress: 0, pointer: null, pokes: 0 });
  const [chapter, setChapter] = useState(0);
  const [running, setRunning] = useState(false);
  const reduced = usePrefersReducedMotion();

  // scroll → progress (a ref, read by the render loop) and the active chapter (state)
  useEffect(() => {
    const measure = (): void => {
      const el = section.current;
      if (!el) return;
      const vh = window.innerHeight || 1;
      const scrolled = -el.getBoundingClientRect().top / vh;
      input.current.progress = Math.min(CHAPTERS, Math.max(0, scrolled + 0.6));
      setChapter(Math.min(CHAPTERS - 1, Math.max(0, Math.floor(scrolled + 0.5))));
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  // the render loop runs only while the story is on screen
  useEffect(() => {
    const el = section.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setRunning(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setRunning(Boolean(entry?.isIntersecting)), { rootMargin: '100px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // pointer anywhere over the story, in the stage's device coordinates
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const move = (e: PointerEvent): void => {
      const r = stage.current?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) return;
      input.current.pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
    };
    const leave = (): void => {
      input.current.pointer = null;
    };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);

  const buy = useCallback(() => {
    input.current.pokes += 1;
  }, []);

  const jump = (i: number): void => {
    const el = section.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY + i * window.innerHeight;
    window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <>
      <header className="mx-auto w-full max-w-6xl px-4 pt-14 sm:px-8">
        <span className="qsd-eyebrow">{STORY.eyebrow}</span>
        <h2 id="qsd-story-title" className="mt-2 text-2xl">
          {STORY.title}
        </h2>
      </header>
      <section ref={section} aria-labelledby="qsd-story-title" className="relative" style={{ height: `${CHAPTERS * 100}vh` }} data-chapter={chapter}>
        <div ref={stage} className="qsd-story-screen sticky top-0 w-full overflow-hidden" onClick={buy}>
          <StoryScene input={input} chapter={chapter} reducedMotion={reduced} running={running} className="absolute inset-0" />
          <nav aria-label={STORY.jumpLabel} className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-3 sm:right-6">
            {STORY.chapters.map((c, i) => (
              <button
                key={c.key}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  jump(i);
                }}
                aria-label={c.title}
                aria-current={i === chapter ? 'step' : undefined}
                className="qsd-story-dot"
                data-active={i === chapter ? 'true' : 'false'}
              />
            ))}
          </nav>
        </div>

        <ol className="pointer-events-none absolute inset-0 m-0 list-none p-0">
          {STORY.chapters.map((c, i) => (
            <li key={c.key} className="qsd-story-screen flex items-end px-4 pb-8 sm:items-center sm:px-8 sm:pb-0">
              <article className="qsd-glass qsd-story-card pointer-events-auto w-full max-w-md p-5 sm:p-6" data-active={i === chapter ? 'true' : 'false'}>
                <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                  <span>
                    {String(i + 1).padStart(2, '0')} / {String(CHAPTERS).padStart(2, '0')}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest">{STORY.label}</span>
                </div>
                <h3 className="mt-1 text-xl">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed">{c.body}</p>
                <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted">{c.visual}</p>
                {'action' in c ? (
                  <button type="button" className="qsd-btn mt-4" data-primary="true" onClick={buy}>
                    {c.action}
                  </button>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
