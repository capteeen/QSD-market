/**
 * <CollapseScene /> — stages 4 → 5, then the daughter forming from the
 * collapsed point, then stage 8.
 *
 * The daughter's ghost is visible during stage 4 beside the mother (same
 * cloud mapping, dimmer), captioned with the projected allocation for the
 * viewer's wallet when the app supplies it, or an honest "unavailable".
 * After outcomeResolved with a collapse outcome, the ghost moves to the
 * collapsed point and solidifies (eased transition toward the event-set
 * target). Stage 8 is entered by the chain package's `anchored` event plus
 * the lineage input, exactly as in the launch sequence.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import * as THREE from 'three';
import { useStore } from 'zustand';
import type { QuantumEvent } from '@qsd/quantum';
import { cloudFromInput } from '../model/reducer.js';
import { createSceneStore, type SceneStore } from '../model/store.js';
import type { ChainEvent, LineageInput, Observable, SuperpositionInput } from '../model/types.js';
import { Anchor } from './Anchor.js';
import { Chamber } from './Chamber.js';
import { CoinSphere } from './CoinSphere.js';
import { useSoundEngine } from './LaunchSequence.js';
import { Lineage } from './Lineage.js';
import { QuantumDraw } from './QuantumDraw.js';
import { SceneCanvas } from './SceneCanvas.js';
import { SidePanel } from './SidePanel.js';
import { SuperpositionCloud } from './SuperpositionCloud.js';
import { useSceneStore } from './context.js';
import { DAUGHTER_GHOST_POSITION } from './layout.js';
import { approach } from './materials.js';
import type { QualityController, QualityLevel } from './quality.js';
import { useSources } from './useSources.js';

export interface DaughterInput {
  /** The daughter's projected superposition ranges (from the protocol package). */
  superposition?: SuperpositionInput;
  /** Already-formatted projected allocation for the connected wallet, e.g. "0.42 % of daughter supply". */
  projectedAllocation?: string;
}

export interface CollapseSceneProps {
  sources: {
    quantum: Observable<QuantumEvent>;
    superposition: SuperpositionInput;
    chain?: Observable<ChainEvent>;
    lineage?: LineageInput;
  };
  daughter?: DaughterInput;
  /** How to tell a collapse outcome from the resolver's label. Default: /collapse/i. */
  isCollapse?: (label: string) => boolean;
  quality?: 'auto' | QualityLevel;
  qualityController?: QualityController;
  sound?: boolean;
  store?: SceneStore;
  panel?: boolean;
  onFrame?: (dt: number) => void;
  className?: string;
  style?: CSSProperties;
}

function DaughterGhost({ daughter, isCollapse }: { daughter: DaughterInput | undefined; isCollapse: (label: string) => boolean }): ReactElement | null {
  const store = useSceneStore();
  const group = useRef<THREE.Group>(null);
  const cloud = useMemo(() => (daughter?.superposition ? cloudFromInput(daughter.superposition) : null), [daughter?.superposition]);
  const formed = useStore(store, (s) => s.draw.phase === 'resolved' && !!s.draw.outcome && isCollapse(s.draw.outcome.label));
  const stage = useStore(store, (s) => s.stage);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const tx = formed ? 0 : DAUGHTER_GHOST_POSITION[0];
    g.position.x = approach(g.position.x, tx, dt, 1.8);
    g.visible = stage >= 4 && stage <= 6;
  });

  if (!cloud) return null;
  const caption = daughter?.projectedAllocation ?? 'projected allocation — not available (wallet not connected)';
  return (
    <group ref={group} position={DAUGHTER_GHOST_POSITION} name="daughter">
      <SuperpositionCloud cloud={cloud} ghost={!formed} caption={caption} />
    </group>
  );
}

function CollapseContent({ daughter, isCollapse }: { daughter: DaughterInput | undefined; isCollapse: (label: string) => boolean }): ReactElement {
  const store = useSceneStore();
  const stage = useStore(store, (s) => s.stage);
  return (
    <>
      <Chamber />
      <CoinSphere />
      {stage <= 6 ? <SuperpositionCloud /> : null}
      {stage >= 5 && stage <= 6 ? <QuantumDraw /> : null}
      <DaughterGhost daughter={daughter} isCollapse={isCollapse} />
      {stage >= 7 ? <Anchor /> : null}
      {stage === 8 ? <Lineage /> : null}
    </>
  );
}

const defaultIsCollapse = (label: string): boolean => /collapse/i.test(label);

export function CollapseScene({
  sources,
  daughter,
  isCollapse = defaultIsCollapse,
  quality = 'auto',
  qualityController,
  sound = false,
  store: given,
  panel = true,
  onFrame,
  className,
  style,
}: CollapseSceneProps): ReactElement {
  const store = useMemo(() => given ?? createSceneStore({ startStage: 4 }), [given]);
  useSources(store, sources);
  const snd = useSoundEngine(sound);
  return (
    <SceneCanvas
      store={store}
      quality={quality}
      {...(qualityController ? { qualityController } : {})}
      {...(onFrame ? { onFrame } : {})}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
      overlay={panel ? <SidePanel sections={['stage', 'superposition', 'draw', 'anchor', 'lineage']} sound={{ enabled: snd.enabled, toggle: snd.toggle }} /> : null}
    >
      <CollapseContent daughter={daughter} isCollapse={isCollapse} />
    </SceneCanvas>
  );
}
