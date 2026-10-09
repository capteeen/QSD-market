/**
 * The Merkle tree above the vessel.
 *
 *   leaves   InstancedMesh × 256. Leaf k appears (rises from the vessel top
 *            to its ring position) when leafFormed(k) has arrived. Before
 *            that its instance is scaled to zero — count is event-driven.
 *   fused    InstancedMesh × 255. Node (level, index) appears on its
 *            treeLevelFused event, lit in cyan. The rise is an eased
 *            transition toward the event-set target.
 *   root     one sphere, dark until rootReady, then white.
 *
 * Stage 6: the authentication path illuminates — on each authPathNode(level)
 * the sibling node at that level glows active, and the nodes on the path from
 * the signed leaf to the root glow lit. Siblings are computed exactly as a
 * verifier would: (index >> level) ^ 1.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { fusedNodeIndex } from '../model/reducer.js';
import { FUSED_NODES, LEAVES, TREE_HEIGHT } from '../model/types.js';
import { useQualityProfile, useSceneContext } from './context.js';
import { TREE_Y0, treeNodePosition } from './layout.js';
import { CYAN, MAGENTA, WHITE, approach, emissiveMaterial, litInstancedGlass } from './materials.js';

/** (level ≥ 1, index) → flat fused index, as the reducer stores it. */
function flatOf(level: number, index: number): number {
  return fusedNodeIndex(level - 1, index);
}

export function MerkleTree(): ReactElement {
  const { store, ui } = useSceneContext();
  const q = useQualityProfile();
  const leaves = useRef<THREE.InstancedMesh>(null);
  const fused = useRef<THREE.InstancedMesh>(null);
  const root = useRef<THREE.Mesh>(null);

  const leafMat = useMemo(() => litInstancedGlass({ transmission: q.transmission, thickness: 0.2, litColor: CYAN, activeColor: MAGENTA }), [q.transmission]);
  const fusedMat = useMemo(() => litInstancedGlass({ transmission: q.transmission, thickness: 0.25, litColor: CYAN, activeColor: MAGENTA }), [q.transmission]);
  const rootMat = useMemo(() => emissiveMaterial(WHITE, 0), []);

  const leafLit = useMemo(() => new Float32Array(LEAVES), []);
  const fusedLit = useMemo(() => new Float32Array(FUSED_NODES), []);
  const leafGeom = useMemo(() => {
    const g = new THREE.OctahedronGeometry(0.09, 0);
    g.setAttribute('aLit', new THREE.InstancedBufferAttribute(leafLit, 1));
    return g;
  }, [leafLit]);
  const fusedGeom = useMemo(() => {
    const g = new THREE.OctahedronGeometry(0.12, 0);
    g.setAttribute('aLit', new THREE.InstancedBufferAttribute(fusedLit, 1));
    return g;
  }, [fusedLit]);

  // eased rise factor per node (0 = not yet, 1 = in place)
  const leafRise = useMemo(() => new Float32Array(LEAVES), []);
  const fusedRise = useMemo(() => new Float32Array(FUSED_NODES), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const p = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const lastVersion = useRef(-1);
  const lastStage = useRef(0);

  useEffect(() => {
    if (leaves.current) leaves.current.frustumCulled = false;
    if (fused.current) fused.current.frustumCulled = false;
  }, []);

  useFrame((_, dt) => {
    const s = store.getState();
    const L = leaves.current;
    const F = fused.current;
    if (!L || !F) return;
    const changed = s.version !== lastVersion.current || s.stage !== lastStage.current;
    lastVersion.current = s.version;
    lastStage.current = s.stage;
    const authMode = s.stage === 6 && s.signature.started;
    const sigIndex = s.signature.index;
    let moved = false;

    for (let k = 0; k < LEAVES; k++) {
      const target = s.keygen.leafFormed[k] === 1 ? 1 : 0;
      const cur = leafRise[k] as number;
      const next = approach(cur, target, dt, 5);
      if (Math.abs(next - cur) > 1e-4 || changed) {
        moved = true;
        leafRise[k] = next;
        treeNodePosition(0, k, p);
        dummy.position.set(p[0] * next, TREE_Y0 * next + (1 - next) * (TREE_Y0 - 0.8), p[2] * next);
        dummy.scale.setScalar(Math.max(0, next));
        dummy.updateMatrix();
        L.setMatrixAt(k, dummy.matrix);
      }
      if (changed) {
        let lit = s.keygen.leafFormed[k] === 1 ? 1 : 0;
        if (authMode && lit) lit = k === sigIndex ? 2 : k === (sigIndex ^ 1) && s.signature.authSeen[0] === 1 ? 2 : 0.35;
        leafLit[k] = lit;
      }
    }

    for (let level = 1; level <= TREE_HEIGHT; level++) {
      const count = LEAVES >> level;
      for (let i = 0; i < count; i++) {
        const flat = flatOf(level, i);
        const target = s.merkle.fusedFlags[flat] === 1 ? 1 : 0;
        const cur = fusedRise[flat] as number;
        const next = approach(cur, target, dt, 5);
        if (Math.abs(next - cur) > 1e-4 || changed) {
          moved = true;
          fusedRise[flat] = next;
          treeNodePosition(level, i, p);
          const childY = TREE_Y0 + (level - 1) * 0.5;
          dummy.position.set(p[0], childY + (p[1] - childY) * next, p[2]);
          dummy.scale.setScalar(Math.max(0, next) * (level === TREE_HEIGHT ? 0.0001 : 1));
          dummy.updateMatrix();
          F.setMatrixAt(flat, dummy.matrix);
        }
        if (changed) {
          let lit = target;
          if (authMode && target) {
            const onPath = sigIndex >> level === i;
            const sibling = (sigIndex >> level) ^ 1; // what a verifier combines with at this level
            const auth = level < TREE_HEIGHT && i === sibling && s.signature.authSeen[level] === 1;
            lit = auth ? 2 : onPath ? 1 : 0.35;
          }
          fusedLit[flat] = lit;
        }
      }
    }

    if (moved) {
      L.instanceMatrix.needsUpdate = true;
      F.instanceMatrix.needsUpdate = true;
    }
    if (changed) {
      (leafGeom.getAttribute('aLit') as THREE.BufferAttribute).needsUpdate = true;
      (fusedGeom.getAttribute('aLit') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (root.current) {
      const target = s.merkle.root ? 3.5 : 0;
      rootMat.emissiveIntensity = approach(rootMat.emissiveIntensity, target, dt, 4);
      root.current.scale.setScalar(approach(root.current.scale.x, s.merkle.root ? 1 : 0.0001, dt, 4));
    }
  });

  const rootPos = useMemo(() => treeNodePosition(TREE_HEIGHT, 0), []);

  const onLeafMove = (e: ThreeEvent<PointerEvent>): void => {
    if (e.instanceId === undefined) return;
    e.stopPropagation();
    ui.getState().setHover({ kind: 'leaf', leaf: e.instanceId });
  };
  const onFusedMove = (e: ThreeEvent<PointerEvent>): void => {
    if (e.instanceId === undefined) return;
    e.stopPropagation();
    // invert flat index → (level, index)
    let flat = e.instanceId;
    for (let level = 0; level < TREE_HEIGHT; level++) {
      const n = LEAVES >> (level + 1);
      if (flat < n) {
        ui.getState().setHover({ kind: 'node', level, index: flat });
        return;
      }
      flat -= n;
    }
  };
  const onOut = (): void => ui.getState().setHover(null);

  return (
    <group name="merkle-tree">
      <instancedMesh ref={leaves} args={[leafGeom, leafMat, LEAVES]} name="merkle-leaves" onPointerMove={onLeafMove} onPointerOut={onOut} />
      <instancedMesh ref={fused} args={[fusedGeom, fusedMat, FUSED_NODES]} name="merkle-fused" onPointerMove={onFusedMove} onPointerOut={onOut} />
      <mesh ref={root} material={rootMat} position={rootPos} name="merkle-root" scale={0.0001}>
        <sphereGeometry args={[0.22, 32, 24]} />
      </mesh>
    </group>
  );
}
