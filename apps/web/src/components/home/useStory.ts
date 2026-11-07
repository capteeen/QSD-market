'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';

export function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof WebGLRenderingContext === 'undefined' && typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scroll progress 0 … 1 through a tall container with a sticky viewport
 * inside it, kept in a ref (read by the render loop) and mirrored to a
 * coarse state (chapter index) for the DOM.
 */
export function useScrollProgress(container: RefObject<HTMLElement>, chapters: number): { progress: React.MutableRefObject<number>; chapter: number; visible: boolean } {
  const progress = useRef(0);
  const [chapter, setChapter] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let raf = 0;
    const measure = (): void => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const total = Math.max(1, rect.height - vh);
      const p = Math.min(1, Math.max(0, -rect.top / total));
      progress.current = p;
      setChapter(Math.min(chapters - 1, Math.floor(p * chapters + 1e-6)));
      setVisible(rect.bottom > 0 && rect.top < vh);
    };
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [container, chapters]);
  return { progress, chapter, visible };
}

export function useMediaQuery(q: string, initial = false): boolean {
  const [m, setM] = useState(initial);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(q);
    const on = (): void => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
