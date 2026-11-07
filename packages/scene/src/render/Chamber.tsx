/**
 * The empty chamber: a transparent cylindrical vessel with nested glass rings,
 * suspended in void, lit by plain lights (no environment map).
 *
 * AMBIENT (encodes no data): the three rings rotate slowly at constant rates.
 * Everything else here is static.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { useQualityProfile, useSceneStore } from './context.js';
import { VESSEL_HEIGHT, VESSEL_RADIUS } from './layout.js';
import { CYAN, MAGENTA, approach, glassMaterial } from './materials.js';

export function Chamber(): ReactElement {
  const q = useQualityProfile();
  const store = useSceneStore();
  const rings = useRef<THREE.Group>(null);
  const keyLight = useRef<THREE.PointLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);

  const vesselMat = useMemo(() => glassMaterial({ transmission: q.transmission, thickness: 1.2, roughness: 0.05 }), [q.transmission]);
  const ringMat = useMemo(() => glassMaterial({ transmission: q.transmission, thickness: 0.4, roughness: 0.12 }), [q.transmission]);

  useFrame((_, dt) => {
    // ambient rotation — documented, encodes nothing
    if (rings.current) {
      const [a, b, c] = rings.current.children;
      if (a) a.rotation.y += dt * 0.08;
      if (b) b.rotation.x += dt * 0.05;
      if (c) c.rotation.z -= dt * 0.04;
    }
    // the centre computation light follows real activity: on while hashes arrive
    const s = store.getState();
    if (keyLight.current) {
      const computing = s.stage === 2 || s.stage === 3 || (s.stage === 6 && !s.signature.ready) || s.draw.phase === 'requested' || s.draw.phase === 'arrived';
      keyLight.current.intensity += ((computing ? 14 : 2) - keyLight.current.intensity) * Math.min(1, dt * 4);
    }
    // stage 5: the chamber dims from entropyRequested until the outcome is resolved
    if (ambient.current && rim.current) {
      const dim = s.stage === 5 && s.draw.phase !== 'idle' && s.draw.phase !== 'resolved';
      ambient.current.intensity = approach(ambient.current.intensity, dim ? 0.02 : 0.12, dt, 3);
      rim.current.intensity = approach(rim.current.intensity, dim ? 0.5 : 2.2, dt, 3);
    }
  });

  return (
    <group>
      <ambientLight ref={ambient} intensity={0.12} />
      {/* rim light in probability cyan, from behind and above */}
      <directionalLight ref={rim} position={[-6, 8, -8]} intensity={2.2} color={CYAN} />
      <directionalLight position={[7, -3, -6]} intensity={0.8} color={CYAN} />
      {/* magenta-white computation light at the centre */}
      <pointLight ref={keyLight} position={[0, 0, 0]} intensity={2} distance={14} decay={2} color={MAGENTA} />
      <pointLight position={[0, 9, 4]} intensity={6} distance={30} decay={2} color={'#ffffff'} />

      <mesh material={vesselMat}>
        <cylinderGeometry args={[VESSEL_RADIUS, VESSEL_RADIUS, VESSEL_HEIGHT, 96, 1, true]} />
      </mesh>
      <mesh material={vesselMat} position={[0, VESSEL_HEIGHT / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[VESSEL_RADIUS - 0.12, VESSEL_RADIUS, 96]} />
      </mesh>
      <mesh material={vesselMat} position={[0, -VESSEL_HEIGHT / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[VESSEL_RADIUS - 0.12, VESSEL_RADIUS, 96]} />
      </mesh>

      <group ref={rings}>
        <mesh material={ringMat} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[VESSEL_RADIUS + 0.5, 0.05, 12, 128]} />
        </mesh>
        <mesh material={ringMat} rotation={[Math.PI / 2.6, 0.3, 0]}>
          <torusGeometry args={[VESSEL_RADIUS + 1.0, 0.04, 12, 128]} />
        </mesh>
        <mesh material={ringMat} rotation={[Math.PI / 3.4, -0.5, 0.2]}>
          <torusGeometry args={[VESSEL_RADIUS + 1.5, 0.03, 12, 128]} />
        </mesh>
      </group>
    </group>
  );
}
