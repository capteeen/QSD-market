/**
 * Shared canvas shell: R3F Canvas (plain lights, no environment map), the
 * post-processing stack, the camera rig, and an HTML overlay layer. The
 * scene context is created here and bridged into the Canvas root.
 */
import { Canvas } from '@react-three/fiber';
import { useMemo, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { colors } from '@qsd/ui-tokens';
import type { SceneStore } from '../model/store.js';
import { CameraRig } from './CameraRig.js';
import { Effects } from './Effects.js';
import { Warmup } from './Warmup.js';
import { SceneProvider, createUiStore, type SceneContextValue } from './context.js';
import type { CameraPose } from './layout.js';
import { createQualityController, type QualityController, type QualityLevel } from './quality.js';

export interface SceneCanvasProps {
  store: SceneStore;
  quality?: 'auto' | QualityLevel;
  qualityController?: QualityController;
  pose?: CameraPose;
  onFrame?: (dt: number) => void;
  /** 3D children. */
  children?: ReactNode;
  /** HTML overlay children (rendered outside the canvas, inside the provider). */
  overlay?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Render the post-processing stack (default true). */
  effects?: boolean;
  /** Compile every material variant asynchronously after the first frame (default true). */
  warmup?: boolean;
}

const shell: CSSProperties = { position: 'relative', width: '100%', height: '100%', minHeight: 320, background: colors.void, overflow: 'hidden' };

export function SceneCanvas({ store, quality = 'auto', qualityController, pose, onFrame, children, overlay, className, style, effects = true, warmup = true }: SceneCanvasProps): ReactElement {
  const value = useMemo<SceneContextValue>(
    () => ({ store, quality: qualityController ?? createQualityController({ mode: quality }), ui: createUiStore() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, qualityController],
  );
  const initialDpr = value.quality.getState().profile.dpr;
  return (
    <SceneProvider store={store} quality={quality} value={value}>
      <div className={className} style={{ ...shell, ...style }} data-qsd-scene>
        <Canvas
          dpr={[0.75, initialDpr]}
          gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ fov: 42, near: 0.1, far: 120, position: [0, 0.4, 11.5] }}
          frameloop="always"
          onCreated={({ gl }) => gl.setClearColor(colors.void, 1)}
          style={{ position: 'absolute', inset: 0 }}
        >
          <SceneProvider store={store} value={value}>
            <CameraRig {...(pose ? { pose } : {})} {...(onFrame ? { onFrame } : {})} />
            {children}
            {warmup ? <Warmup /> : null}
            {effects ? <Effects /> : null}
          </SceneProvider>
        </Canvas>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{overlay}</div>
      </div>
    </SceneProvider>
  );
}
