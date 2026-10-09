/**
 * The 67 hash chains of the leaf in view as literal chains: 67 columns of 16
 * transparent blocks in a ring inside the vessel. ONE InstancedMesh of exactly
 * 67 × 16 = 1072 instances; the count is a constant of the construction and
 * never changes.
 *
 * keygen mode (stage 2): link (chain i, depth d) is lit iff the reducer has
 * seen d+1 chainStep events for chain i of the current leaf. The most recent
 * link glows magenta-white. Unlit links are dark glass. Nothing moves without
 * an event; when the leaf changes the ring starts again from dark.
 *
 * signing mode (stage 6): on signChainStop(i, depth) light runs down chain i
 * from the tip (15) and stops at `depth` — the sweep is an eased transition
 * toward the event-set target (presentation only; the target is the real
 * digit). The link at `depth` is the revealed signature element and glows
 * active. Chains without a stop yet stay dark.
 *
 * Hover: pointer over an instance publishes {chainIdx, depth}; the side panel
 * shows the real hash (policy: the leaf in view is retained in full).
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { CHAIN_INSTANCES, CHAINS, LINKS } from '../model/types.js';
import { useQualityProfile, useSceneContext } from './context.js';
import { LINK_SIZE, linkPosition } from './layout.js';
import { CYAN, MAGENTA, litInstancedGlass } from './materials.js';

export interface ChainRingProps {
  mode: 'keygen' | 'signing';
}

export function ChainRing({ mode }: ChainRingProps): ReactElement {
  const { store, ui } = useSceneContext();
  const q = useQualityProfile();
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(
    () => litInstancedGlass({ transmission: q.transmission, thickness: 0.3, litColor: CYAN, activeColor: MAGENTA }),
    [q.transmission],
  );
  const lit = useMemo(() => new Float32Array(CHAIN_INSTANCES), []);
  const litAttr = useMemo(() => new THREE.InstancedBufferAttribute(lit, 1), [lit]);
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(...LINK_SIZE);
    g.setAttribute('aLit', litAttr);
    return g;
  }, [litAttr]);
  const sweep = useMemo(() => new Float32Array(CHAINS).fill(LINKS), []);
  const lastVersion = useRef(-1);
  const lastMode = useRef<string>('');

  // static layout: instance i = chainIdx * 16 + depth
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const p: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < CHAINS; c++) {
      for (let d = 0; d < LINKS; d++) {
        linkPosition(c, d, p);
        o.position.set(p[0], p[1], p[2]);
        o.rotation.set(0, -Math.atan2(p[2], p[0]), 0);
        o.updateMatrix();
        m.setMatrixAt(c * LINKS + d, o.matrix);
      }
    }
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
  }, []);

  useFrame((_, dt) => {
    const s = store.getState();
    const k = s.keygen;
    const g = s.signature;
    if (mode === 'keygen') {
      if (s.version === lastVersion.current && lastMode.current === mode) return;
      for (let c = 0; c < CHAINS; c++) {
        const grown = k.depths[c] ?? 0;
        const base = c * LINKS;
        for (let d = 0; d < LINKS; d++) lit[base + d] = d < grown ? 1 : 0;
        if (grown > 0 && c === k.lastChainIdx && k.lastDepth === grown - 1) lit[base + grown - 1] = 2;
      }
    } else {
      // signing: eased sweep from the tip down to the real stop depth
      let moving = false;
      for (let c = 0; c < CHAINS; c++) {
        const stop = g.stopDepths[c] ?? -1;
        const target = stop < 0 ? LINKS : stop;
        const cur = sweep[c] as number;
        const next = stop < 0 ? LINKS : Math.max(target, cur - dt * 28);
        if (next !== cur) moving = true;
        sweep[c] = next;
        const base = c * LINKS;
        for (let d = 0; d < LINKS; d++) {
          if (stop < 0) lit[base + d] = 0;
          else if (d >= next) lit[base + d] = d === stop && next <= stop + 0.001 ? 2 : 1;
          else lit[base + d] = 0;
        }
      }
      if (!moving && s.version === lastVersion.current && lastMode.current === mode) return;
    }
    lastVersion.current = s.version;
    lastMode.current = mode;
    litAttr.needsUpdate = true;
  });

  const onMove = (e: ThreeEvent<PointerEvent>): void => {
    const id = e.instanceId;
    if (id === undefined) return;
    e.stopPropagation();
    const chainIdx = Math.floor(id / LINKS);
    const depth = id % LINKS;
    ui.getState().setHover(mode === 'keygen' ? { kind: 'link', chainIdx, depth } : { kind: 'stop', chainIdx });
  };
  const onOut = (): void => ui.getState().setHover(null);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, CHAIN_INSTANCES]}
      name="chain-ring"
      onPointerMove={onMove}
      onPointerOut={onOut}
      userData={{ instances: CHAIN_INSTANCES, mode }}
    />
  );
}
