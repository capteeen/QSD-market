/**
 * Stage 6: the 67 revealed blocks. On signChainStop(chainIdx, depth) the
 * block at `depth` of chain `chainIdx` lifts out of the ring and locks into
 * the signature structure (a helix outside the vessel) — an eased transition
 * from its ring position to its slot, both fixed functions of the event's
 * indices. Instances of chains with no stop yet are scaled to zero.
 * When signatureReady arrives the whole structure glows white.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { CHAINS } from '../model/types.js';
import { useQualityProfile, useSceneContext } from './context.js';
import { LINK_SIZE, linkPosition, signatureSlotPosition } from './layout.js';
import { MAGENTA, WHITE, approach, litInstancedGlass } from './materials.js';

export function SignatureStructure(): ReactElement {
  const { store, ui } = useSceneContext();
  const q = useQualityProfile();
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => litInstancedGlass({ transmission: q.transmission, thickness: 0.3, litColor: WHITE, activeColor: MAGENTA }), [q.transmission]);
  const lit = useMemo(() => new Float32Array(CHAINS), []);
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(LINK_SIZE[0] * 1.15, LINK_SIZE[1] * 1.15, LINK_SIZE[2] * 1.15);
    g.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
    return g;
  }, [lit]);
  const lift = useMemo(() => new Float32Array(CHAINS), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const from = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const to = useMemo<[number, number, number]>(() => [0, 0, 0], []);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    m.frustumCulled = false;
    // no signChainStop yet → nothing to draw: every instance starts at zero scale
    // (an InstancedMesh's default identity matrices would draw 67 blocks at the origin)
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    for (let c = 0; c < CHAINS; c++) m.setMatrixAt(c, dummy.matrix);
    m.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const s = store.getState();
    const g = s.signature;
    let any = false;
    for (let c = 0; c < CHAINS; c++) {
      const stop = g.stopDepths[c] ?? -1;
      const target = stop < 0 ? 0 : 1;
      const cur = lift[c] as number;
      const next = approach(cur, target, dt, 2.5);
      if (Math.abs(next - cur) < 1e-5 && cur === target) continue;
      any = true;
      lift[c] = next;
      if (stop < 0) {
        dummy.scale.setScalar(0.0001);
        dummy.position.set(0, 0, 0);
      } else {
        linkPosition(c, stop, from);
        signatureSlotPosition(c, to);
        // lift straight out then along the helix: a smooth blend, easing in
        const k = next * next * (3 - 2 * next);
        dummy.position.set(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k);
        dummy.rotation.set(0, -Math.atan2(dummy.position.z, dummy.position.x), 0);
        dummy.scale.setScalar(Math.max(0.0001, Math.min(1, next * 4)));
      }
      dummy.updateMatrix();
      m.setMatrixAt(c, dummy.matrix);
      lit[c] = stop < 0 ? 0 : g.ready ? 1 : 2;
    }
    if (any) {
      m.instanceMatrix.needsUpdate = true;
      (geometry.getAttribute('aLit') as THREE.BufferAttribute).needsUpdate = true;
    }
    const u = material.userData.uniforms.uGlow;
    u.value = approach(u.value, g.ready ? 1.8 : 1, dt, 3);
  });

  const onMove = (e: ThreeEvent<PointerEvent>): void => {
    if (e.instanceId === undefined) return;
    e.stopPropagation();
    ui.getState().setHover({ kind: 'stop', chainIdx: e.instanceId });
  };

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, CHAINS]}
      name="signature-structure"
      onPointerMove={onMove}
      onPointerOut={() => ui.getState().setHover(null)}
    />
  );
}
