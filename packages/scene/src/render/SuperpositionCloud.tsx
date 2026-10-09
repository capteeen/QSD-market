/**
 * Stage 4: the probability cloud around the sphere, driven by the protocol's
 * superposition ranges (`cloud` slice of the state).
 *
 *   cloud radius     = f(width)  where width = (supplyMax − supplyMin) / supplyMax
 *   breathing        AMBIENT in time, but its AMPLITUDE is the real width:
 *                    a coin with no uncertainty does not breathe.
 *   supply band      a torus whose thickness is the width
 *   half-life ring   rotates with period T = clamp(4·log10(halfLifeSec + 1), 2, 40) s —
 *                    longer half-life, slower ring
 *   decay channels   one ghost path per channel, length and opacity = its probability,
 *                    labelled with the real percentage
 *
 * Stage 5 contraction: the same cloud, scaled by the draw phase —
 * requested 0.8, arrived 0.55 (with flicker), committed 0.4, resolved → 0
 * (collapsed to the point). Nothing contracts without the event.
 *
 * `ghost` renders the daughter ghost (CollapseScene): same mapping, dimmer.
 */
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { fonts } from '@qsd/ui-tokens';
import type { CloudState, DrawPhase } from '../model/types.js';
import { useSceneStore } from './context.js';
import { COIN_RADIUS } from './layout.js';
import { AMBER, CYAN, approach, glassMaterial, lineMaterial, pointsMaterial } from './materials.js';

const N = 1536;

export const CONTRACTION: Readonly<Record<DrawPhase, number>> = { idle: 1, requested: 0.8, arrived: 0.55, committed: 0.4, resolved: 0 };

export function halfLifePeriodSec(halfLifeSec: number): number {
  const t = 4 * Math.log10(Math.max(0, halfLifeSec) + 1);
  return Math.min(40, Math.max(2, t));
}

export interface SuperpositionCloudProps {
  /** Override the cloud (daughter ghost); defaults to the store's cloud. */
  cloud?: CloudState;
  position?: [number, number, number];
  ghost?: boolean;
  /** Optional extra label line under the channels (e.g. projected allocation). */
  caption?: string;
}

export function SuperpositionCloud({ cloud, position = [0, 0, 0], ghost = false, caption }: SuperpositionCloudProps): ReactElement | null {
  const store = useSceneStore();
  const points = useRef<THREE.Points>(null);
  const band = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const t = useRef(0);

  const dirs = useMemo(() => {
    const a = new Float32Array(N * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      a[i * 3] = Math.cos(th) * r;
      a[i * 3 + 1] = y;
      a[i * 3 + 2] = Math.sin(th) * r;
    }
    return a;
  }, []);
  const jitter = useMemo(() => {
    const a = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = ((i * 2654435761) >>> 0) / 4294967296; // deterministic
    return a;
  }, []);
  const positions = useMemo(() => new Float32Array(N * 3), []);
  const alphas = useMemo(() => new Float32Array(N).fill(1), []);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, alphas]);
  const pmat = useMemo(() => pointsMaterial(CYAN, ghost ? 1.2 : 2.2, ghost ? 0.35 : 0.8), [ghost]);
  const bandMat = useMemo(() => glassMaterial({ transmission: false, opacity: ghost ? 0.12 : 0.3, color: CYAN }), [ghost]);
  const ringMat = useMemo(() => glassMaterial({ transmission: false, opacity: ghost ? 0.15 : 0.45, color: AMBER }), [ghost]);
  const scaleRef = useRef(0);

  useFrame(({ gl }, dt) => {
    const s = store.getState();
    const c = cloud ?? s.cloud;
    const P = points.current;
    if (!P) return;
    t.current += dt;
    const width = c.input ? c.width : 0;
    const phase = cloud ? 'idle' : s.draw.phase;
    const contraction = CONTRACTION[phase];
    const flicker = phase === 'arrived' || phase === 'committed' ? 0.08 * Math.sin(t.current * 37) : 0;
    const breath = width * 0.12 * Math.sin(t.current * 0.9); // amplitude = real width
    const target = c.input ? (0.35 + 1.5 * width) * (1 + breath) * (contraction + flicker) : 0;
    scaleRef.current = approach(scaleRef.current, target, dt, phase === 'resolved' ? 16 : 3);
    const R = COIN_RADIUS + scaleRef.current;
    for (let i = 0; i < N; i++) {
      const r = R * (0.75 + 0.25 * (jitter[i] as number));
      positions[i * 3] = (dirs[i * 3] as number) * r;
      positions[i * 3 + 1] = (dirs[i * 3 + 1] as number) * r;
      positions[i * 3 + 2] = (dirs[i * 3 + 2] as number) * r;
    }
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    pmat.uniforms.uPixelRatio!.value = gl.getPixelRatio();
    pmat.uniforms.uOpacity!.value = (ghost ? 0.35 : 0.8) * Math.min(1, scaleRef.current * 3);
    if (band.current) {
      band.current.scale.setScalar(Math.max(0.0001, contraction + flicker));
      band.current.rotation.z += dt * 0.15; // ambient
      band.current.visible = !!c.input && phase !== 'resolved';
    }
    if (ring.current) {
      const period = halfLifePeriodSec(c.halfLifeSec);
      ring.current.rotation.y += c.input ? (dt * Math.PI * 2) / period : 0;
      ring.current.scale.setScalar(Math.max(0.0001, contraction));
      ring.current.visible = !!c.input && phase !== 'resolved';
    }
  });

  const c = cloud ?? store.getState().cloud;
  const channels = useMemo(() => {
    const items: { line: THREE.Line; label: string; pos: [number, number, number] }[] = [];
    c.channels.forEach((ch, k) => {
      const a = (k / Math.max(1, c.channels.length)) * Math.PI * 2 + 0.4;
      const len = 1.4 + 2.2 * ch.fraction;
      const end = new THREE.Vector3(Math.cos(a) * len, 0.5 + 0.9 * Math.sin(a * 1.7), Math.sin(a) * len);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(end.x * 0.5, end.y * 1.6, end.z * 0.5), end);
      const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
      const line = new THREE.Line(g, lineMaterial(CYAN, (ghost ? 0.12 : 0.25) + 0.6 * ch.fraction));
      items.push({ line, label: `${ch.label} ${ch.percentLabel}`, pos: [end.x, end.y, end.z] });
    });
    return items;
  }, [c.channels, ghost]);

  const width = c.input ? c.width : 0;
  return (
    <group position={position} name={ghost ? 'daughter-ghost' : 'superposition-cloud'}>
      <points ref={points} geometry={geometry} material={pmat} frustumCulled={false} />
      <mesh ref={band} material={bandMat} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.25, 0.02 + 0.14 * width, 12, 128]} />
      </mesh>
      <mesh ref={ring} material={ringMat} rotation={[Math.PI / 2.4, 0, 0.3]}>
        <torusGeometry args={[1.7, 0.025, 10, 128]} />
      </mesh>
      {channels.map((ch, i) => (
        <group key={i}>
          <primitive object={ch.line} />
          <Html position={ch.pos} center style={labelStyle(ghost)} zIndexRange={[10, 0]}>
            {ch.label}
          </Html>
        </group>
      ))}
      {caption ? (
        <Html position={[0, -1.6, 0]} center style={labelStyle(ghost)} zIndexRange={[10, 0]}>
          {caption}
        </Html>
      ) : null}
    </group>
  );
}

function labelStyle(ghost: boolean): React.CSSProperties {
  return {
    fontFamily: fonts.mono,
    fontSize: 11,
    whiteSpace: 'nowrap',
    color: ghost ? 'rgba(77,208,225,0.55)' : '#D7DEE6',
    textShadow: '0 0 6px rgba(77,208,225,0.6)',
    pointerEvents: 'none',
    userSelect: 'none',
  };
}
