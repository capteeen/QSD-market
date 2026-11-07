/**
 * React plumbing: the scene store, the quality controller and a tiny UI store
 * (hover) travel through context. Canvas components read the store inside
 * `useFrame` via `getState()` — no React re-render per event. The HTML side
 * panel uses `useSceneSnapshot`, which coalesces store notifications to one
 * React update per animation frame.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { SceneState } from '../model/types.js';
import type { SceneStore } from '../model/store.js';
import { createQualityController, type QualityController, type QualityLevel, type QualityProfile } from './quality.js';

export type Hover =
  | { kind: 'link'; chainIdx: number; depth: number }
  | { kind: 'leaf'; leaf: number }
  | { kind: 'node'; level: number; index: number }
  | { kind: 'stop'; chainIdx: number }
  | { kind: 'auth'; level: number }
  | null;

export interface UiState {
  hover: Hover;
  setHover(h: Hover): void;
}

export function createUiStore(): StoreApi<UiState> {
  return createStore<UiState>((set) => ({ hover: null, setHover: (hover) => set({ hover }) }));
}

export interface SceneContextValue {
  store: SceneStore;
  quality: QualityController;
  ui: StoreApi<UiState>;
}

const SceneContext = createContext<SceneContextValue | null>(null);

export interface SceneProviderProps {
  store: SceneStore;
  quality?: 'auto' | QualityLevel;
  qualityController?: QualityController;
  /** Re-provide an existing context value (R3F's <Canvas> is a separate React root, so context must be bridged). */
  value?: SceneContextValue;
  children?: ReactNode;
}

export function SceneProvider({ store, quality = 'auto', qualityController, value: given, children }: SceneProviderProps): ReactElement {
  const created = useMemo<SceneContextValue>(
    () => given ?? { store, quality: qualityController ?? createQualityController({ mode: quality }), ui: createUiStore() },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, qualityController, given],
  );
  useEffect(() => {
    if (!given && !qualityController) created.quality.setMode(quality);
  }, [quality, qualityController, created.quality, given]);
  return <SceneContext.Provider value={created}>{children}</SceneContext.Provider>;
}

export function useSceneContext(): SceneContextValue {
  const v = useContext(SceneContext);
  if (!v) throw new Error('@qsd/scene: component rendered outside <SceneProvider>');
  return v;
}

export function useSceneStore(): SceneStore {
  return useSceneContext().store;
}

/** The quality profile as React state (re-renders only when the level changes). */
export function useQualityProfile(): QualityProfile {
  const { quality } = useSceneContext();
  return useStore(quality, (s) => s.profile);
}

export function useHover(): Hover {
  const { ui } = useSceneContext();
  return useStore(ui, (s) => s.hover);
}

/**
 * Snapshot of the scene state for HTML, updated at most once per animation
 * frame (or immediately in environments without requestAnimationFrame).
 */
export function useSceneSnapshot(): SceneState {
  const store = useSceneStore();
  const [snap, setSnap] = useState<SceneState>(() => store.getState());
  const scheduled = useRef(false);
  useEffect(() => {
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => (cb(), 0);
    const unsub = store.subscribe(() => {
      if (scheduled.current) return;
      scheduled.current = true;
      raf(() => {
        scheduled.current = false;
        setSnap(store.getState());
      });
    });
    setSnap(store.getState());
    return unsub;
  }, [store]);
  return snap;
}
