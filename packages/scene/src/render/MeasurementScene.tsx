/**
 * <MeasurementScene /> — stage 5 alone, for a coin page. The store starts at
 * stage 5 (recorded as a skip of 1–4); the superposition ranges, if given,
 * draw the cloud that the draw contracts and collapses. Without quantum
 * events nothing happens.
 */
import { useMemo, type CSSProperties, type ReactElement } from 'react';
import type { QuantumEvent } from '@qsd/quantum';
import { createSceneStore, type SceneStore } from '../model/store.js';
import type { Observable, SuperpositionInput } from '../model/types.js';
import { Chamber } from './Chamber.js';
import { CoinSphere } from './CoinSphere.js';
import { useSoundEngine } from './LaunchSequence.js';
import { QuantumDraw } from './QuantumDraw.js';
import { SceneCanvas } from './SceneCanvas.js';
import { SidePanel } from './SidePanel.js';
import { SuperpositionCloud } from './SuperpositionCloud.js';
import { CAMERA_BY_STAGE } from './layout.js';
import type { QualityController, QualityLevel } from './quality.js';
import { useSources } from './useSources.js';

export interface MeasurementSceneProps {
  sources: { quantum: Observable<QuantumEvent>; superposition?: SuperpositionInput };
  quality?: 'auto' | QualityLevel;
  qualityController?: QualityController;
  sound?: boolean;
  store?: SceneStore;
  panel?: boolean;
  onFrame?: (dt: number) => void;
  className?: string;
  style?: CSSProperties;
}

export function MeasurementScene({ sources, quality = 'auto', qualityController, sound = false, store: given, panel = true, onFrame, className, style }: MeasurementSceneProps): ReactElement {
  const store = useMemo(() => given ?? createSceneStore({ startStage: 5 }), [given]);
  useSources(store, sources);
  const snd = useSoundEngine(sound);
  return (
    <SceneCanvas
      store={store}
      quality={quality}
      pose={CAMERA_BY_STAGE[5]}
      {...(qualityController ? { qualityController } : {})}
      {...(onFrame ? { onFrame } : {})}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
      overlay={panel ? <SidePanel sections={['draw', 'superposition']} sound={{ enabled: snd.enabled, toggle: snd.toggle }} /> : null}
    >
      <Chamber />
      <CoinSphere />
      <SuperpositionCloud />
      <QuantumDraw />
    </SceneCanvas>
  );
}
