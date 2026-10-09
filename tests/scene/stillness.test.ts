/**
 * SPEC §7 CORE RULE: "If no event arrives, nothing moves. There is no
 * timeline-based fake animation." SPEC §10: "feed an empty stream and check
 * the scene stays still."
 *
 * Model-level stillness: an un-dispatched store, 60 s of fake time, every
 * clock/timer hook the package could possibly use is driven, and the state
 * must be deep-equal and at stage 1. Render-level stillness is in
 * render-headless.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneSceneState, createInitialState, createSceneStore, createSoundEngine, replayEvents, type SceneState } from '@qsd/scene';

function snapshot(s: SceneState): unknown {
  const c = cloneSceneState(s);
  return JSON.parse(
    JSON.stringify(c, (_k, v) => (v instanceof Uint8Array || v instanceof Int8Array || v instanceof Uint16Array ? Array.from(v as ArrayLike<number>) : typeof v === 'bigint' ? v.toString() : v)),
  );
}

describe('empty stream (item 2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replayEvents([]) deep-equals createInitialState() and stays at stage 1', () => {
    expect(snapshot(replayEvents([]))).toEqual(snapshot(createInitialState()));
    expect(replayEvents([]).stage).toBe(1);
  });

  it('a store with nothing dispatched does not change over 60 s of fake time, with timers and rAF driven', () => {
    const store = createSceneStore();
    const before = snapshot(store.getState());
    const ref = store.getState();
    let notifications = 0;
    const unsub = store.subscribe(() => notifications++);

    // Drive every clock the package could be using: timers, rAF (if any), microtasks.
    const raf: (() => void)[] = [];
    (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame = (cb) => (raf.push(cb), raf.length);
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000);
      while (raf.length) raf.shift()!();
    }
    vi.runOnlyPendingTimers();
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;

    expect(notifications).toBe(0);
    expect(store.getState()).toBe(ref); // same object: nothing produced a new state
    expect(snapshot(store.getState())).toEqual(before);
    expect(store.getState().stage).toBe(1);
    expect(store.getState().version).toBe(0);
    expect(store.getState().events.accepted).toBe(0);
    unsub();
  });

  it('connecting silent observables moves nothing; disconnecting stops delivery', () => {
    const store = createSceneStore();
    const listeners: ((e: unknown) => void)[] = [];
    const silent = { subscribe: (l: (e: never) => void) => (listeners.push(l as never), () => void listeners.splice(listeners.indexOf(l as never), 1)) };
    const off = store.connect(silent as never);
    vi.advanceTimersByTime(60_000);
    expect(store.getState().version).toBe(0);
    off();
    expect(listeners).toHaveLength(0);
  });

  it('the sound engine emits the collapse tone only when resolvedCount increments — never from time alone', () => {
    const tones: number[] = [];
    const starts: number[] = [];
    // minimal AudioContext stub
    class FakeParam {
      value = 0;
      setValueAtTime() {
        return this;
      }
      exponentialRampToValueAtTime() {
        return this;
      }
      setTargetAtTime() {
        return this;
      }
    }
    class FakeNode {
      frequency = new FakeParam();
      gain = new FakeParam();
      Q = new FakeParam();
      type = '';
      connect(n: unknown) {
        return n;
      }
      start(t?: number) {
        starts.push(t ?? -1);
      }
      stop(t?: number) {
        if (t !== undefined) tones.push(t);
      }
    }
    class FakeCtx {
      state = 'running';
      currentTime = 0;
      destination = {};
      createGain() {
        return new FakeNode();
      }
      createOscillator() {
        return new FakeNode();
      }
      createBiquadFilter() {
        return new FakeNode();
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }
    const engine = createSoundEngine(FakeCtx as unknown as typeof AudioContext);
    void engine.enable();
    const s = createInitialState();
    const tonesBefore = tones.length;
    for (let i = 0; i < 600; i++) {
      vi.advanceTimersByTime(100);
      engine.update(s);
    }
    expect(tones.length).toBe(tonesBefore); // 60 s, no event → no tone
    engine.update({ ...s, draw: { ...s.draw, resolvedCount: 1 } });
    expect(tones.length).toBe(tonesBefore + 1); // the real event → exactly one tone
    engine.update({ ...s, draw: { ...s.draw, resolvedCount: 1 } });
    expect(tones.length).toBe(tonesBefore + 1); // same count again → no second tone
    engine.dispose();
  });
});
