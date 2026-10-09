/**
 * Stage 8: lineage. The camera zooms out (CameraRig) and the coin's node is
 * the sealed block. If `lineage.mother` is present, a mother node appears to
 * the left, coloured by her real final state (collapsed = magenta,
 * tunnelled = white), labelled with the channel that was selected, and a line
 * of light connects her to the daughter. The line's reveal is an eased
 * transition after stage 8 is entered. No mother → no node, no line.
 */
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { colors, fonts } from '@qsd/ui-tokens';
import { useSceneSnapshot, useSceneStore } from './context.js';
import { BLOCK_POSITION, MOTHER_POSITION } from './layout.js';
import { COLLAPSE, TUNNEL, approach, emissiveMaterial, lineMaterial } from './materials.js';

const label: React.CSSProperties = { fontFamily: fonts.mono, fontSize: 11, color: colors.text, whiteSpace: 'nowrap', pointerEvents: 'none' };

function short(ca: string): string {
  return ca.length > 14 ? `${ca.slice(0, 6)}…${ca.slice(-4)}` : ca;
}

export function Lineage(): ReactElement | null {
  const store = useSceneStore();
  const snap = useSceneSnapshot();
  const lineMat = useMemo(() => lineMaterial(TUNNEL, 0), []);
  const line = useMemo(
    () => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...MOTHER_POSITION), new THREE.Vector3(...BLOCK_POSITION)]), lineMat),
    [lineMat],
  );
  const motherMat = useMemo(() => emissiveMaterial(COLLAPSE, 0), []);
  const mother = useRef<THREE.Mesh>(null);
  const entangle = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    const s = store.getState();
    const has = s.stage === 8 && !!s.lineage?.mother;
    lineMat.opacity = approach(lineMat.opacity, has ? 0.8 : 0, dt, 1.5);
    motherMat.emissive.copy(s.lineage?.mother?.finalState === 'tunnelled' ? TUNNEL : COLLAPSE);
    motherMat.emissiveIntensity = approach(motherMat.emissiveIntensity, has ? 2 : 0, dt, 2);
    if (mother.current) mother.current.scale.setScalar(approach(mother.current.scale.x, has ? 1 : 0.0001, dt, 2));
    if (entangle.current) {
      entangle.current.rotation.y += dt * 0.6; // ambient
      entangle.current.scale.setScalar(approach(entangle.current.scale.x, has ? 1 : 0.0001, dt, 2));
    }
  });

  const l = snap.lineage;
  if (!l) return null;
  const m = l.mother;
  return (
    <group name="lineage">
      <primitive object={line} />
      <Html position={[BLOCK_POSITION[0], BLOCK_POSITION[1] - 1.1, BLOCK_POSITION[2]]} center style={label} zIndexRange={[10, 0]}>
        g{l.generation} {short(l.ca)}
      </Html>
      {m ? (
        <group position={MOTHER_POSITION}>
          <mesh ref={mother} material={motherMat} scale={0.0001}>
            <sphereGeometry args={[0.45, 32, 24]} />
          </mesh>
          <mesh ref={entangle} rotation={[Math.PI / 2.5, 0, 0]} scale={0.0001}>
            <torusGeometry args={[0.8, 0.02, 8, 96]} />
            <meshBasicMaterial color={m.finalState === 'tunnelled' ? TUNNEL : COLLAPSE} transparent opacity={0.6} />
          </mesh>
          <Html position={[0, -1.1, 0]} center style={label} zIndexRange={[10, 0]}>
            g{m.generation} {short(m.ca)} · {m.finalState}
            {m.channelLabel ? ` · ${m.channelLabel}` : ''}
            {typeof m.measurementsSurvived === 'number' ? ` · survived ${m.measurementsSurvived}` : ''}
          </Html>
        </group>
      ) : null}
    </group>
  );
}
