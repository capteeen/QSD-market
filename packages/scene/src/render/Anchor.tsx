/**
 * Stage 7: anchoring.
 *
 *   anchorSubmitted  the signed state compacts into one bright packet at the
 *                    bottom of the vessel and the lane of light appears
 *   anchored         the packet travels down the lane (eased toward the
 *                    event-set target) and lands in the block; the block's
 *                    lid closes and the block glows. The real tx signature is
 *                    shown beside it (and in the panel).
 *
 * Without the events: no packet, no lane, an unlit open block.
 */
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { fonts, colors } from '@qsd/ui-tokens';
import { useQualityProfile, useSceneStore, useSceneSnapshot } from './context.js';
import { BLOCK_POSITION, LANE_TOP } from './layout.js';
import { CYAN, WHITE, approach, emissiveMaterial, glassMaterial, lineMaterial } from './materials.js';

export function Anchor(): ReactElement {
  const store = useSceneStore();
  const snap = useSceneSnapshot();
  const q = useQualityProfile();
  const packet = useRef<THREE.Mesh>(null);
  const lid = useRef<THREE.Mesh>(null);
  const laneMat = useMemo(() => lineMaterial(CYAN, 0), []);
  const lane = useMemo(
    () => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...LANE_TOP), new THREE.Vector3(...BLOCK_POSITION)]), laneMat),
    [laneMat],
  );
  const packetMat = useMemo(() => emissiveMaterial(WHITE, 0), []);
  const blockMat = useMemo(() => glassMaterial({ transmission: q.transmission, thickness: 0.8, roughness: 0.1 }), [q.transmission]);
  const coreMat = useMemo(() => emissiveMaterial(CYAN, 0), []);
  const y = useRef(LANE_TOP[1]);

  useFrame((_, dt) => {
    const s = store.getState();
    const a = s.anchor;
    laneMat.opacity = approach(laneMat.opacity, a.submitted ? 0.7 : 0, dt, 4);
    if (packet.current) {
      const targetY = a.anchored ? BLOCK_POSITION[1] : LANE_TOP[1];
      y.current = approach(y.current, targetY, dt, 2.2);
      packet.current.position.set(0, y.current, 0);
      packet.current.scale.setScalar(approach(packet.current.scale.x, a.submitted ? 1 : 0.0001, dt, 6));
      packetMat.emissiveIntensity = approach(packetMat.emissiveIntensity, a.submitted ? 5 : 0, dt, 6);
    }
    const landed = a.anchored && Math.abs(y.current - BLOCK_POSITION[1]) < 0.05;
    if (lid.current) {
      lid.current.position.y = approach(lid.current.position.y, landed ? 0.46 : 1.1, dt, 5);
    }
    coreMat.emissiveIntensity = approach(coreMat.emissiveIntensity, landed ? 2.5 : 0, dt, 4);
  });

  return (
    <group name="anchor">
      <primitive object={lane} />
      <mesh ref={packet} material={packetMat} scale={0.0001}>
        <icosahedronGeometry args={[0.22, 1]} />
      </mesh>
      <group position={BLOCK_POSITION} name="anchor-block">
        <mesh material={blockMat}>
          <boxGeometry args={[1.4, 0.9, 1.4]} />
        </mesh>
        <mesh ref={lid} material={blockMat} position={[0, 1.1, 0]}>
          <boxGeometry args={[1.44, 0.06, 1.44]} />
        </mesh>
        <mesh material={coreMat}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
        </mesh>
        {snap.anchor.txSignature ? (
          <Html position={[1.1, 0.2, 0]} style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.text, whiteSpace: 'nowrap', pointerEvents: 'none' }} zIndexRange={[10, 0]}>
            tx {snap.anchor.txSignature.length > 20 ? `${snap.anchor.txSignature.slice(0, 10)}…${snap.anchor.txSignature.slice(-6)}` : snap.anchor.txSignature}
            {snap.anchor.anchored ? '' : ' (submitted)'}
          </Html>
        ) : null}
      </group>
    </group>
  );
}
