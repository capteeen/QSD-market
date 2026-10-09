/**
 * <FieldScene /> — the home page. Every coin is a glass vessel; its cloud is
 * the pure `vesselParams` mapping of what the app knows (uncertainty,
 * activity, decay progress, state). Instanced (two InstancedMeshes for N
 * coins), per-instance frustum culling (instances outside the camera
 * frustum are collapsed to zero scale each frame), and LOD (clouds beyond
 * the LOD distance are not drawn). On a live measurement the vessel with
 * that `ca` flashes: the flash is triggered by the event and decays as an
 * eased transition.
 *
 * AMBIENT (encodes no data by itself): a slow vertical drift per vessel —
 * but its AMPLITUDE is the `drift` parameter (untouched, near-collapse coins
 * drift; traded coins sit still).
 *
 * Empty `coins` → an empty chamber floor and an honest EmptyState.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import * as THREE from 'three';
import { EmptyState, colors } from '@qsd/ui-tokens';
import { vesselParams, vesselPosition, type FieldCoin, type LiveMeasurement } from '../model/field.js';
import { createSceneStore } from '../model/store.js';
import type { Observable } from '../model/types.js';
import { SceneCanvas } from './SceneCanvas.js';
import { useQualityProfile } from './context.js';
import type { CameraPose } from './layout.js';
import { CYAN, WHITE, approach, glassMaterial, litInstancedGlass } from './materials.js';
import type { QualityController, QualityLevel } from './quality.js';

export interface FieldSceneProps {
  coins: readonly FieldCoin[];
  liveMeasurements?: Observable<LiveMeasurement>;
  quality?: 'auto' | QualityLevel;
  qualityController?: QualityController;
  /** Disc radius the vessels fill. Default scales with √N. */
  radius?: number;
  /** Distance beyond which clouds are not drawn (LOD). Default 26. */
  lodDistance?: number;
  onFrame?: (dt: number) => void;
  className?: string;
  style?: CSSProperties;
}

const FIELD_POSE: CameraPose = { position: [0, 14, 22], target: [0, 0, 0] };

export function FieldVessels({ coins, liveMeasurements, radius, lodDistance = 26 }: Pick<FieldSceneProps, 'coins' | 'liveMeasurements' | 'radius' | 'lodDistance'>): ReactElement {
  const q = useQualityProfile();
  const { camera } = useThree();
  const n = coins.length;
  const R = radius ?? Math.max(6, Math.sqrt(Math.max(1, n)) * 1.35);
  const vessels = useRef<THREE.InstancedMesh>(null);
  const clouds = useRef<THREE.InstancedMesh>(null);
  const vesselMat = useMemo(() => glassMaterial({ transmission: q.transmission, thickness: 0.5, roughness: 0.1 }), [q.transmission]);
  const cloudMat = useMemo(() => litInstancedGlass({ transmission: false, opacity: 0.35, litColor: CYAN, activeColor: WHITE }), []);
  const cloudLit = useMemo(() => new Float32Array(Math.max(1, n)), [n]);
  const cloudGeom = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    g.setAttribute('aLit', new THREE.InstancedBufferAttribute(cloudLit, 1));
    return g;
  }, [cloudLit]);
  const params = useMemo(() => coins.map(vesselParams), [coins]);
  const positions = useMemo(() => coins.map((_, i) => vesselPosition(i, n, R)), [coins, n, R]);
  const index = useMemo(() => new Map(coins.map((c, i) => [c.ca, i])), [coins]);
  const flash = useMemo(() => new Float32Array(Math.max(1, n)), [n]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projView = useMemo(() => new THREE.Matrix4(), []);
  const pt = useMemo(() => new THREE.Vector3(), []);
  const t = useRef(0);

  useEffect(() => {
    if (!liveMeasurements) return;
    return liveMeasurements.subscribe((m) => {
      const i = index.get(m.ca);
      if (i !== undefined) flash[i] = 1;
    });
  }, [liveMeasurements, index, flash]);

  useEffect(() => {
    if (vessels.current) vessels.current.frustumCulled = false;
    if (clouds.current) clouds.current.frustumCulled = false;
  }, []);

  useFrame((_, dt) => {
    const V = vessels.current;
    const C = clouds.current;
    if (!V || !C || n === 0) return;
    t.current += dt;
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    for (let i = 0; i < n; i++) {
      const p = params[i]!;
      const [x, , z] = positions[i]!;
      const y = Math.sin(t.current * 0.4 + i) * 0.35 * p.drift; // amplitude = data
      pt.set(x, y, z);
      const inView = frustum.containsPoint(pt);
      const dist = camera.position.distanceTo(pt);
      // vessel
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(inView ? 1 : 0.0001);
      dummy.updateMatrix();
      V.setMatrixAt(i, dummy.matrix);
      // cloud: LOD — beyond lodDistance it is not drawn
      flash[i] = approach(flash[i] as number, 0, dt, 2.5);
      const drawCloud = inView && dist < lodDistance && p.settled === 0;
      dummy.scale.setScalar(drawCloud ? p.spread * (1 + 0.4 * (flash[i] as number)) : 0.0001);
      dummy.updateMatrix();
      C.setMatrixAt(i, dummy.matrix);
      cloudLit[i] = p.brightness + 1.2 * (flash[i] as number);
    }
    V.instanceMatrix.needsUpdate = true;
    C.instanceMatrix.needsUpdate = true;
    (cloudGeom.getAttribute('aLit') as THREE.BufferAttribute).needsUpdate = true;
  });

  // tint per instance (state colour) — set once per coins change
  useEffect(() => {
    const C = clouds.current;
    if (!C) return;
    // tint = state colour, scaled by `density` (0.1..1): a sparse cloud is a dimmer cloud
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = params[i]!;
      C.setColorAt(i, col.set(p.tint).multiplyScalar(0.3 + 0.7 * p.density));
    }
    if (C.instanceColor) C.instanceColor.needsUpdate = true;
  }, [params, n]);

  return (
    <group name="field">
      <ambientLight intensity={0.15} />
      <directionalLight position={[-10, 14, -6]} intensity={2} color={CYAN} />
      <pointLight position={[0, 10, 0]} intensity={8} distance={60} decay={2} color={'#ffffff'} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]}>
        <ringGeometry args={[R + 0.5, R + 0.6, 128]} />
        <meshBasicMaterial color={colors.border} transparent opacity={0.6} />
      </mesh>
      {n > 0 ? (
        <>
          <instancedMesh ref={vessels} args={[undefined, vesselMat, n]} name="field-vessels" userData={{ instances: n }}>
            <cylinderGeometry args={[0.55, 0.55, 2.0, 24, 1, true]} />
          </instancedMesh>
          <instancedMesh ref={clouds} args={[cloudGeom, cloudMat, n]} name="field-clouds" userData={{ instances: n }} />
        </>
      ) : null}
    </group>
  );
}

export function FieldScene({ coins, liveMeasurements, quality = 'auto', qualityController, radius, lodDistance, onFrame, className, style }: FieldSceneProps): ReactElement {
  const store = useMemo(() => createSceneStore(), []);
  return (
    <SceneCanvas
      store={store}
      quality={quality}
      pose={FIELD_POSE}
      {...(qualityController ? { qualityController } : {})}
      {...(onFrame ? { onFrame } : {})}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
      overlay={
        coins.length === 0 ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'auto' }}>
            <EmptyState eyebrow="FIELD" sentence="No coins exist yet. The chamber is empty." />
          </div>
        ) : null
      }
    >
      <FieldVessels coins={coins} {...(liveMeasurements ? { liveMeasurements } : {})} {...(radius !== undefined ? { radius } : {})} {...(lodDistance !== undefined ? { lodDistance } : {})} />
    </SceneCanvas>
  );
}
