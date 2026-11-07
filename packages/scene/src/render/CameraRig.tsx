/**
 * Camera: eases toward the pose of the current stage (the pose is a fixed
 * function of `state.stage`, which only the reducer changes). Also feeds the
 * quality controller one frame time per frame and applies its DPR cap.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSceneContext, useQualityProfile } from './context.js';
import { CAMERA_BY_STAGE, type CameraPose } from './layout.js';
import { approach } from './materials.js';

export interface CameraRigProps {
  /** Fixed pose instead of the per-stage one (MeasurementScene / FieldScene). */
  pose?: CameraPose;
  /** Report each frame's dt (used by the perf harness). */
  onFrame?: (dt: number) => void;
}

export function CameraRig({ pose, onFrame }: CameraRigProps): null {
  const { store, quality } = useSceneContext();
  const profile = useQualityProfile();
  const { camera, setDpr } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  const first = useRef(true);

  useEffect(() => {
    const device = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    setDpr(Math.min(profile.dpr, device));
  }, [profile.dpr, setDpr]);

  useFrame((_, dt) => {
    quality.sample(dt);
    onFrame?.(dt);
    const p = pose ?? CAMERA_BY_STAGE[store.getState().stage];
    if (first.current) {
      first.current = false;
      camera.position.set(...p.position);
      target.set(...p.target);
    } else {
      camera.position.x = approach(camera.position.x, p.position[0], dt, 1.6);
      camera.position.y = approach(camera.position.y, p.position[1], dt, 1.6);
      camera.position.z = approach(camera.position.z, p.position[2], dt, 1.6);
      target.x = approach(target.x, p.target[0], dt, 1.6);
      target.y = approach(target.y, p.target[1], dt, 1.6);
      target.z = approach(target.z, p.target[2], dt, 1.6);
    }
    camera.lookAt(target);
  });
  return null;
}
