/**
 * The coin: a single glowing sphere at the centre.
 *
 * AMBIENT (encodes no data): in stage 1 it pulses gently at a constant rate
 * ("not yet real"). From stage 2 on, its brightness is data: it tracks real
 * progress (keygen fraction, then fused Merkle fraction), goes white when the
 * root is ready, and is replaced by the collapsed point after outcomeResolved
 * (see QuantumDraw). It is hidden in stages 7–8, where the packet and the
 * lineage node stand for the coin.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { keygenProgress, merkleProgress } from '../model/reducer.js';
import { useSceneStore } from './context.js';
import { COIN_RADIUS } from './layout.js';
import { CYAN, MAGENTA, WHITE, approach, emissiveMaterial } from './materials.js';

export function CoinSphere(): ReactElement {
  const store = useSceneStore();
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => emissiveMaterial(CYAN, 0.8), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const t = useRef(0);

  useFrame((_, dt) => {
    const s = store.getState();
    const m = mesh.current;
    if (!m) return;
    t.current += dt;
    let scale = 1;
    let intensity = 0.8;
    let visible = true;
    if (s.stage === 1) {
      scale = 1 + 0.06 * Math.sin(t.current * 1.6); // ambient pulse
      tmp.copy(CYAN);
    } else if (s.stage === 2) {
      const p = keygenProgress(s);
      intensity = 0.6 + 2.0 * p;
      tmp.copy(CYAN).lerp(MAGENTA, Math.min(1, p * 1.2));
    } else if (s.stage === 3) {
      const p = merkleProgress(s);
      intensity = 1.5 + 2.5 * p;
      tmp.copy(MAGENTA).lerp(WHITE, s.merkle.root ? 1 : p);
    } else if (s.stage === 4 || s.stage === 5) {
      // superposition: the sphere is the mean; the cloud around it is the uncertainty
      intensity = s.draw.phase === 'resolved' ? 0 : 1.2;
      visible = s.draw.phase !== 'resolved';
      tmp.copy(CYAN);
    } else if (s.stage === 6) {
      intensity = 1.0;
      tmp.copy(WHITE);
    } else {
      visible = false;
    }
    m.visible = visible;
    m.scale.setScalar(approach(m.scale.x, scale, dt, 4));
    mat.emissiveIntensity = approach(mat.emissiveIntensity, intensity, dt, 5);
    mat.emissive.lerp(tmp, Math.min(1, dt * 4));
  });

  return (
    <mesh ref={mesh} material={mat}>
      <sphereGeometry args={[COIN_RADIUS, 48, 32]} />
    </mesh>
  );
}
