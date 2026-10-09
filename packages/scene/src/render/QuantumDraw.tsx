/**
 * Stage 5: the quantum draw. Every element is a real event:
 *
 *   entropyRequested  a beam leaves the chamber (line to the right, lit)
 *   entropyArrived    raw photons enter: ONE point per entropy byte, placed by
 *                     the byte's value (angle = byte / 255 · 2π), easing from
 *                     outside the vessel to the cloud
 *   commitmentComputed  the beam is withdrawn (commitment is in the panel)
 *   outcomeResolved   the cloud collapses to a point: a flash and an expanding
 *                     ring are triggered by the increment of resolvedCount;
 *                     the ring's expansion is an eased transition after the
 *                     event. The collapsed point persists.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { useSceneStore } from './context.js';
import { VESSEL_RADIUS } from './layout.js';
import { COLLAPSE, CYAN, WHITE, approach, emissiveMaterial, lineMaterial, pointsMaterial } from './materials.js';

const MAX_PHOTONS = 1024;

export function QuantumDraw(): ReactElement {
  const store = useSceneStore();
  const beam = useRef<THREE.Line>(null);
  const photons = useRef<THREE.Points>(null);
  const flashRing = useRef<THREE.Mesh>(null);
  const point = useRef<THREE.Mesh>(null);

  const beamMat = useMemo(() => lineMaterial(CYAN, 0), []);
  const beamGeom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(VESSEL_RADIUS, 0.2, 0), new THREE.Vector3(VESSEL_RADIUS + 9, 0.8, 0)]),
    [],
  );
  const beamLine = useMemo(() => new THREE.Line(beamGeom, beamMat), [beamGeom, beamMat]);

  const positions = useMemo(() => new Float32Array(MAX_PHOTONS * 3), []);
  const alphas = useMemo(() => new Float32Array(MAX_PHOTONS), []);
  const radii = useMemo(() => new Float32Array(MAX_PHOTONS), []);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    g.setDrawRange(0, 0);
    return g;
  }, [positions, alphas]);
  const pmat = useMemo(() => pointsMaterial(WHITE, 3.2, 1), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  const pointMat = useMemo(() => emissiveMaterial(WHITE, 0), []);

  const lastEntropy = useRef<Uint8Array | null>(null);
  const lastResolved = useRef(0);
  const flashT = useRef(Number.POSITIVE_INFINITY);

  useFrame(({ gl }, dt) => {
    const s = store.getState();
    const d = s.draw;
    // beam
    beamMat.opacity = approach(beamMat.opacity, d.phase === 'requested' ? 0.9 : 0, dt, 6);
    // photons: rebuild targets when a new entropy array arrives
    if (d.entropy !== lastEntropy.current) {
      lastEntropy.current = d.entropy;
      const n = d.entropy ? Math.min(MAX_PHOTONS, d.entropy.length) : 0;
      for (let i = 0; i < n; i++) radii[i] = VESSEL_RADIUS + 7; // start outside, enter on arrival
      geometry.setDrawRange(0, n);
    }
    const n = geometry.drawRange.count;
    if (n > 0 && d.entropy) {
      const inside = d.phase === 'resolved' ? 0.02 : 1.0;
      for (let i = 0; i < n; i++) {
        const b = d.entropy[i] as number;
        const theta = (b / 255) * Math.PI * 2;
        const phi = ((i / n) - 0.5) * Math.PI * 0.8;
        radii[i] = approach(radii[i] as number, inside, dt, d.phase === 'resolved' ? 10 : 2.5);
        const r = radii[i] as number;
        positions[i * 3] = Math.cos(theta) * Math.cos(phi) * r + (r > 2 ? (VESSEL_RADIUS + 2) * (r - 1) * 0.12 : 0);
        positions[i * 3 + 1] = Math.sin(phi) * r;
        positions[i * 3 + 2] = Math.sin(theta) * Math.cos(phi) * r;
        alphas[i] = d.phase === 'resolved' ? 0.2 : 1;
      }
      (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    }
    pmat.uniforms.uPixelRatio!.value = gl.getPixelRatio();
    // collapse flash on the real event (resolvedCount increments only in the reducer)
    if (d.resolvedCount > lastResolved.current) {
      lastResolved.current = d.resolvedCount;
      flashT.current = 0;
    }
    if (flashRing.current) {
      flashT.current += dt;
      const ft = flashT.current;
      const k = 1 - Math.exp(-ft * 2.2);
      flashRing.current.scale.setScalar(0.3 + 7 * k);
      ringMat.opacity = Math.max(0, 1 - ft / 1.4);
      flashRing.current.visible = ringMat.opacity > 0;
    }
    if (point.current) {
      const on = d.phase === 'resolved';
      pointMat.emissiveIntensity = approach(pointMat.emissiveIntensity, on ? 6 : 0, dt, 12);
      point.current.scale.setScalar(approach(point.current.scale.x, on ? 1 : 0.0001, dt, 12));
      pointMat.emissive.copy(d.outcome?.label === 'collapse' ? COLLAPSE : WHITE);
    }
  });

  return (
    <group name="quantum-draw">
      <primitive object={beamLine} ref={beam} />
      <points ref={photons} geometry={geometry} material={pmat} frustumCulled={false} />
      <mesh ref={flashRing} material={ringMat} visible={false}>
        <ringGeometry args={[0.9, 1.0, 96]} />
      </mesh>
      <mesh ref={point} material={pointMat} scale={0.0001}>
        <sphereGeometry args={[0.14, 24, 16]} />
      </mesh>
    </group>
  );
}
