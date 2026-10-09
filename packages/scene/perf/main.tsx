/**
 * Perf page. Replays the RECORDED real event stream (test/fixtures/generated,
 * made by `pnpm --filter @qsd/scene fixtures`) through the full
 * <LaunchSequence /> and records every frame time.
 *
 * Pacing reproduces reality: the key-generation events are fed at the rate
 * the recorded keygen took (manifest.keygenMs, ≈ 3.5 s in Node), spread over
 * animation frames; the other stages follow with short dwells so the whole
 * run lasts ≈ 25 s. Nothing is advanced by anything but the dispatched
 * events.
 *
 * Query params: ?mode=empty (feed nothing: the stillness check),
 *               ?quality=ultra|high|medium|low|auto (default auto)
 *               ?keygenMs=<ms> (override pacing)
 * Results on window.__qsdPerf.
 */
import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import '@qsd/ui-tokens/tokens.css';
import { hexToBytes } from '@qsd/quantum';
import type { QuantumEvent } from '@qsd/quantum';
import { LaunchSequence, createSceneStore, decodeCryptoEvents, type QualityLevel, type SceneEvent, type SceneStore } from '../src/index.js';
import type { CryptoEvent } from '@qsd/crypto';

interface Manifest {
  keygenMs: number;
  rootHex: string;
  quantum: (Omit<QuantumEvent, 'bytes'> & { bytesHex?: string })[];
  superposition: { supplyMin: string; supplyMax: string; halfLifeSec: number; decayChannels: { id: string; probability: number; label: string }[] };
  lineage: { ca: string; generation: number; mother?: { ca: string; generation: number; finalState: 'collapsed' | 'tunnelled'; channelLabel?: string } };
  chain: SceneEvent[];
}

interface PerfResult {
  done: boolean;
  mode: string;
  quality: string;
  frames: number[];
  /** Absolute time (ms since page start) of each frame, parallel to `frames`. */
  frameAt: number[];
  framePhase: string[];
  phases: Record<string, number[]>;
  stages: { stage: number; at: number }[];
  finalState?: { stage: number; chainSteps: number; leaves: number; fused: number; root: string | null; stops: number; auth: number; tx: string | null };
  error?: string;
}

declare global {
  interface Window {
    __qsdPerf: PerfResult;
  }
}

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'full';
const quality = (params.get('quality') ?? 'auto') as 'auto' | QualityLevel;
const result: PerfResult = { done: false, mode, quality, frames: [], frameAt: [], framePhase: [], phases: {}, stages: [] };
window.__qsdPerf = result;
let phase = 'init';
const t0 = performance.now();

function App({ store, run }: { store: SceneStore; run: () => Promise<void> }): JSX.Element {
  useEffect(() => {
    void run();
  }, [run]);
  const sources = useMemo(() => ({}), []);
  return (
    <LaunchSequence
      store={store}
      sources={sources}
      quality={quality}
      onFrame={(dt) => {
        result.frames.push(dt);
        result.frameAt.push(performance.now() - t0);
        result.framePhase.push(phase);
        (result.phases[phase] ??= []).push(dt);
      }}
      onStageChange={(stage) => result.stages.push({ stage, at: performance.now() - t0 })}
      style={{ position: 'absolute', inset: 0 }}
    />
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nextFrame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

async function main(): Promise<void> {
  const store = createSceneStore();
  const root = createRoot(document.getElementById('root') as HTMLElement);

  const run = async (): Promise<void> => {
    try {
      await sleep(1500); // stage 1 dwell: the empty chamber
      if (mode === 'empty') {
        phase = 'empty';
        await sleep(8000);
        finish(store);
        return;
      }
      const [bin, manifest] = await Promise.all([
        fetch('/crypto.bin').then((r) => r.arrayBuffer()),
        fetch('/manifest.json').then((r) => r.json() as Promise<Manifest>),
      ]);
      const events = decodeCryptoEvents(new Uint8Array(bin));
      const signAt = events.findIndex((e) => e.type === 'signStart');
      const keygen = events.slice(0, signAt);
      const signing = events.slice(signAt);
      const keygenMs = Number(params.get('keygenMs') ?? manifest.keygenMs ?? 3500);

      // stage 2–3: keygen paced at the recorded rate
      phase = 'keygen';
      let i = 0;
      let last = performance.now();
      while (i < keygen.length) {
        const now = await nextFrame();
        const dt = Math.min(0.25, (now - last) / 1000);
        last = now;
        const n = Math.max(1, Math.round((keygen.length * dt * 1000) / keygenMs));
        const batch: CryptoEvent[] = keygen.slice(i, i + n);
        store.dispatchMany(batch);
        i += n;
      }
      await sleep(1500);

      // stage 4
      phase = 'superposition';
      store.dispatch({
        type: 'superposition',
        input: {
          supplyMin: BigInt(manifest.superposition.supplyMin),
          supplyMax: BigInt(manifest.superposition.supplyMax),
          halfLifeSec: manifest.superposition.halfLifeSec,
          decayChannels: manifest.superposition.decayChannels,
        },
      });
      await sleep(3000);

      // stage 5: the recorded draw, with realistic gaps
      phase = 'draw';
      for (const q of manifest.quantum) {
        const ev = q.type === 'entropyArrived' ? ({ ...q, bytes: hexToBytes(q.bytesHex ?? '') } as QuantumEvent) : (q as QuantumEvent);
        store.dispatch(ev);
        await sleep(ev.type === 'entropyRequested' ? 1200 : ev.type === 'entropyArrived' ? 800 : 400);
      }
      await sleep(2000);

      // stage 6
      phase = 'signing';
      for (const e of signing) {
        store.dispatch(e);
        if (e.type === 'signChainStop') await nextFrame();
      }
      await sleep(3000);

      // stage 7–8
      phase = 'anchor';
      store.dispatch(manifest.chain[0] as SceneEvent);
      await sleep(1500);
      store.dispatch(manifest.chain[1] as SceneEvent);
      await sleep(1500);
      phase = 'lineage';
      store.dispatch({ type: 'lineage', input: manifest.lineage });
      await sleep(3000);
      finish(store);
    } catch (e) {
      result.error = String(e);
      result.done = true;
    }
  };

  root.render(
    <StrictMode>
      <App store={store} run={run} />
    </StrictMode>,
  );
}

function finish(store: SceneStore): void {
  const s = store.getState();
  result.finalState = {
    stage: s.stage,
    chainSteps: s.keygen.chainSteps,
    leaves: s.keygen.leavesFormed,
    fused: s.merkle.fusedTotal,
    root: s.merkle.root ? Array.from(s.merkle.root, (b) => b.toString(16).padStart(2, '0')).join('') : null,
    stops: s.signature.stopsSeen,
    auth: s.signature.authCount,
    tx: s.anchor.txSignature,
  };
  result.done = true;
}

void main();
