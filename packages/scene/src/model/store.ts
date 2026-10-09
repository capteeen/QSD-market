/**
 * `createSceneStore()` — a zustand vanilla store around `sceneReducer`.
 *
 * `dispatch` is synchronous and O(1). Subscribers are notified on every
 * accepted event; the renderer reads `getState()` inside its frame loop and
 * the side panel coalesces notifications to one React update per animation
 * frame, so 274 432 chainStep events in 3.5 s do not cause 274 432 renders.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createInitialState, sceneReducer } from './reducer.js';
import type { Observable, SceneEvent, SceneState, Stage } from './types.js';

export interface SceneStore extends StoreApi<SceneState> {
  dispatch(event: SceneEvent): SceneState;
  /** Dispatch many events; subscribers are notified once at the end. */
  dispatchMany(events: Iterable<SceneEvent>): SceneState;
  /** Subscribe an observable source; returns its unsubscribe. */
  connect<E extends SceneEvent>(source: Observable<E>): () => void;
  reset(): void;
}

export interface SceneStoreOptions {
  /**
   * Start at a later stage by dispatching `skipStage` once. Used by the
   * MeasurementScene / CollapseScene which only show a slice of the sequence.
   * It is recorded in `state.skipped`, like any user skip.
   */
  startStage?: Stage;
}

export function createSceneStore(opts: SceneStoreOptions = {}): SceneStore {
  const base = createStore<SceneState>(() => createInitialState());
  const store = base as SceneStore;

  store.dispatch = (event) => {
    const next = sceneReducer(base.getState(), event);
    base.setState(next, true);
    return next;
  };

  store.dispatchMany = (events) => {
    let s = base.getState();
    for (const e of events) s = sceneReducer(s, e);
    base.setState(s, true);
    return s;
  };

  store.connect = (source) => source.subscribe((e) => void store.dispatch(e));

  store.reset = () => {
    base.setState(createInitialState(), true);
    if (opts.startStage !== undefined && opts.startStage > 1) store.dispatch({ type: 'skipStage', to: opts.startStage });
  };

  if (opts.startStage !== undefined && opts.startStage > 1) store.dispatch({ type: 'skipStage', to: opts.startStage });
  return store;
}

/**
 * Replay a recorded stream through a fresh reducer and return the final
 * state. For Agent H: feed a recorded stream and compare; feed an empty
 * stream and get `createInitialState()` back (deep-equal).
 */
export function replayEvents(events: Iterable<SceneEvent>, store?: SceneStore): SceneState {
  if (store) return store.dispatchMany(events);
  let s = createInitialState();
  for (const e of events) s = sceneReducer(s, e);
  return s;
}
