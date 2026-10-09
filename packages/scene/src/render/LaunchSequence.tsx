/**
 * <LaunchSequence /> — the eight-stage launch, every stage driven by a real
 * event. Which geometry is mounted depends only on `state.stage`; what that
 * geometry shows depends only on the counts and hashes in the state.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { createSceneStore, type SceneStore } from '../model/store.js';
import type { SceneState, Stage } from '../model/types.js';
import { createSoundEngine, type SoundEngine } from '../sound/engine.js';
import { Anchor } from './Anchor.js';
import { ChainRing } from './ChainRing.js';
import { Chamber } from './Chamber.js';
import { CoinSphere } from './CoinSphere.js';
import { Lineage } from './Lineage.js';
import { MerkleTree } from './MerkleTree.js';
import { QuantumDraw } from './QuantumDraw.js';
import { SceneCanvas } from './SceneCanvas.js';
import { SeedStreams } from './SeedStreams.js';
import { SidePanel } from './SidePanel.js';
import { SignatureStructure } from './SignatureStructure.js';
import { SuperpositionCloud } from './SuperpositionCloud.js';
import { useSceneSnapshot } from './context.js';
import type { QualityController, QualityLevel } from './quality.js';
import { useSources, type SceneSources } from './useSources.js';

export interface LaunchSequenceProps {
  sources: SceneSources;
  onStageChange?: (stage: Stage, state: SceneState) => void;
  /** Fired once when stage 8 is reached. */
  onComplete?: (state: SceneState) => void;
  quality?: 'auto' | QualityLevel;
  qualityController?: QualityController;
  /** Sound is off by default; `true` enables the synthesised hum/harmonic/tone. */
  sound?: boolean;
  /** Supply a store (tests, perf harness, worker-fed pages). A new one is created otherwise. */
  store?: SceneStore;
  /** Show the side panel (default true). */
  panel?: boolean;
  /** Allow the user to skip stages (default true). */
  allowSkip?: boolean;
  onFrame?: (dt: number) => void;
  className?: string;
  style?: CSSProperties;
}

/** Geometry mounted per stage. Re-renders only when the stage changes. */
export function StageContent({ store }: { store: SceneStore }): ReactElement {
  const stage = useStore(store, (s) => s.stage);
  return (
    <>
      <Chamber />
      <CoinSphere />
      {stage === 2 ? <SeedStreams /> : null}
      {stage === 2 ? <ChainRing mode="keygen" /> : null}
      {stage === 2 || stage === 3 || stage === 6 ? <MerkleTree /> : null}
      {stage === 4 || stage === 5 ? <SuperpositionCloud /> : null}
      {stage === 5 ? <QuantumDraw /> : null}
      {stage === 6 ? <ChainRing mode="signing" /> : null}
      {stage === 6 ? <SignatureStructure /> : null}
      {stage === 7 || stage === 8 ? <Anchor /> : null}
      {stage === 8 ? <Lineage /> : null}
    </>
  );
}

function SoundBridge({ engine }: { engine: SoundEngine | null }): null {
  const snap = useSceneSnapshot();
  useEffect(() => {
    engine?.update(snap);
  }, [engine, snap]);
  return null;
}

export function useSoundEngine(enabled: boolean): { engine: SoundEngine | null; enabled: boolean; toggle: () => void } {
  const [on, setOn] = useState(enabled);
  const ref = useRef<SoundEngine | null>(null);
  useEffect(() => setOn(enabled), [enabled]);
  useEffect(() => {
    if (!on) {
      ref.current?.disable();
      return;
    }
    try {
      ref.current ??= createSoundEngine();
      void ref.current.enable();
    } catch {
      ref.current = null;
    }
  }, [on]);
  useEffect(() => () => ref.current?.dispose(), []);
  return { engine: on ? ref.current : null, enabled: on, toggle: () => setOn((v) => !v) };
}

export function LaunchSequence({
  sources,
  onStageChange,
  onComplete,
  quality = 'auto',
  qualityController,
  sound = false,
  store: given,
  panel = true,
  allowSkip = true,
  onFrame,
  className,
  style,
}: LaunchSequenceProps): ReactElement {
  const store = useMemo(() => given ?? createSceneStore(), [given]);
  useSources(store, sources);
  const snd = useSoundEngine(sound);

  useEffect(() => {
    let last = store.getState().stage;
    let completed = last === 8;
    return store.subscribe((s) => {
      if (s.stage !== last) {
        last = s.stage;
        onStageChange?.(s.stage, s);
        if (s.stage === 8 && !completed) {
          completed = true;
          onComplete?.(s);
        }
      }
    });
  }, [store, onStageChange, onComplete]);

  const skip = allowSkip ? () => store.dispatch({ type: 'skipStage' }) : undefined;

  return (
    <SceneCanvas
      store={store}
      quality={quality}
      {...(qualityController ? { qualityController } : {})}
      {...(onFrame ? { onFrame } : {})}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
      overlay={
        <>
          <SoundBridge engine={snd.engine} />
          {panel ? <SidePanel onSkip={skip} sound={{ enabled: snd.enabled, toggle: snd.toggle }} /> : null}
        </>
      }
    >
      <StageContent store={store} />
    </SceneCanvas>
  );
}
