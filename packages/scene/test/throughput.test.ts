/**
 * Headless reducer throughput. Key generation emits 274 432 chainStep events
 * (292 097 events in all) in ≈ 3.5 s in Node; the store must consume the live
 * stream with headroom, and the pure reducer must replay a recorded stream
 * far faster than real time.
 */
import { describe, expect, it } from 'vitest';
import { createIdentity, sha256 } from '@qsd/crypto';
import { CryptoObserver } from '@qsd/crypto';
import { createSceneStore, replayEvents, sceneReducer, createInitialState } from '../src/model/index.js';
import { loadFixture } from './fixtures/generate.js';

const KEYGEN_EVENTS = 1 + 256 * 67 * 16 + 256 * 67 + 256 + 255 + 1;

describe('reducer throughput', () => {
  it('replays a recorded 292 097-event stream through the pure reducer well inside the 3.5 s keygen window', async () => {
    const f = await loadFixture();
    const keygen = f.crypto.slice(0, KEYGEN_EVENTS);
    expect(keygen[keygen.length - 1]?.type).toBe('rootReady');
    const t0 = performance.now();
    const s = replayEvents(keygen);
    const ms = performance.now() - t0;
    const eps = keygen.length / (ms / 1000);
    console.log(`[throughput] pure reducer: ${keygen.length} events in ${ms.toFixed(0)} ms = ${Math.round(eps).toLocaleString()} events/s`);
    expect(s.keygen.chainSteps).toBe(274_432);
    // must sustain the live rate (≈ 83 k events/s) with ≥ 3× headroom
    expect(eps).toBeGreaterThan(250_000);
  });

  it('consumes a LIVE createIdentity stream through the store (with a subscriber) without falling behind', () => {
    const store = createSceneStore();
    let notifications = 0;
    store.subscribe(() => notifications++);
    const observer = new CryptoObserver();
    let reducerMs = 0;
    observer.subscribe((e) => {
      const t = performance.now();
      store.dispatch(e);
      reducerMs += performance.now() - t;
    });
    const t0 = performance.now();
    const id = createIdentity(sha256(new TextEncoder().encode('qsd-scene-throughput-seed (throwaway)')), { observer });
    const wall = performance.now() - t0;
    const s = store.getState();
    console.log(
      `[throughput] live keygen: ${observer.seq} events, wall ${wall.toFixed(0)} ms, reducer share ${reducerMs.toFixed(0)} ms (${((100 * reducerMs) / wall).toFixed(1)}%), ${Math.round(observer.seq / (reducerMs / 1000)).toLocaleString()} events/s inside the reducer`,
    );
    expect(observer.seq).toBe(KEYGEN_EVENTS);
    expect(notifications).toBe(KEYGEN_EVENTS);
    expect(s.keygen.chainSteps).toBe(274_432);
    expect(s.merkle.root && Buffer.from(s.merkle.root).toString('hex')).toBe(id.rootHex);
    // the reducer must not dominate the keygen: at most 40 % of the wall time
    expect(reducerMs / wall).toBeLessThan(0.4);
  });

  it('is O(1) per event: cost of the 200 000th chainStep ≈ cost of the 1st', async () => {
    const f = await loadFixture();
    const steps = f.crypto.filter((e) => e.type === 'chainStep');
    const time = (from: number, n: number): number => {
      let s = createInitialState();
      for (let i = 0; i < from; i++) s = sceneReducer(s, steps[i]!);
      const t0 = performance.now();
      for (let i = from; i < from + n; i++) s = sceneReducer(s, steps[i]!);
      return (performance.now() - t0) / n;
    };
    const early = time(0, 20_000);
    const late = time(200_000, 20_000);
    console.log(`[throughput] per-event cost early ${(early * 1e6).toFixed(0)} ns, late ${(late * 1e6).toFixed(0)} ns`);
    expect(late).toBeLessThan(early * 4 + 0.002);
  });
});
