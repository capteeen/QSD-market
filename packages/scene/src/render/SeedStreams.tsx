/**
 * Stage 2: seed streams — thin lines of light entering the vessel from the
 * void. They appear on keygenStart and their brightness is the fraction of
 * the leaf in view that has grown (Σ depths / 1072). Nothing before the
 * event, nothing brighter than the data.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, type ReactElement } from 'react';
import * as THREE from 'three';
import { CHAIN_INSTANCES, CHAINS } from '../model/types.js';
import { useSceneStore } from './context.js';
import { RING_RADIUS, VESSEL_HEIGHT } from './layout.js';
import { CYAN, approach, lineMaterial } from './materials.js';

const STREAMS = 6;

export function SeedStreams(): ReactElement {
  const store = useSceneStore();
  const mat = useMemo(() => lineMaterial(CYAN, 0), []);
  const lines = useMemo(() => {
    const out: THREE.Line[] = [];
    for (let i = 0; i < STREAMS; i++) {
      const a = (i / STREAMS) * Math.PI * 2 + 0.3;
      const outer = new THREE.Vector3(Math.cos(a) * 11, VESSEL_HEIGHT * 0.9 + i * 0.3, Math.sin(a) * 11);
      const inner = new THREE.Vector3(Math.cos(a) * RING_RADIUS, -VESSEL_HEIGHT / 2 + 0.2, Math.sin(a) * RING_RADIUS);
      const mid = new THREE.Vector3((outer.x + inner.x) * 0.5, VESSEL_HEIGHT * 0.55, (outer.z + inner.z) * 0.5);
      const curve = new THREE.QuadraticBezierCurve3(outer, mid, inner);
      out.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)), mat));
    }
    return out;
  }, [mat]);

  useFrame((_, dt) => {
    const s = store.getState();
    let grown = 0;
    for (let c = 0; c < CHAINS; c++) grown += s.keygen.depths[c] ?? 0;
    const target = s.keygen.started && s.stage === 2 ? 0.15 + 0.7 * (grown / CHAIN_INSTANCES) : 0;
    mat.opacity = approach(mat.opacity, target, dt, 5);
  });

  return (
    <group name="seed-streams">
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </group>
  );
}
