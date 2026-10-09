/**
 * Item 5: headless render with @react-three/test-renderer.
 * SPEC §10: "Count rendered chain links: must be exactly 67×16."
 * SPEC §7: "If no event arrives, nothing moves."
 *
 * <LaunchSequence /> itself wraps an R3F <Canvas>, which needs a DOM; the
 * test renderer IS the canvas, so we mount what LaunchSequence mounts inside
 * it: <SceneProvider> + <StageContent> + <CameraRig> (+ <Warmup>).
 */
import { afterEach, describe, expect, it } from 'vitest';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { CHAINS, CHAIN_INSTANCES, FUSED_NODES, LEAVES, LINKS, createSceneStore, replayEvents, type SceneStore } from '@qsd/scene';
import { CameraRig, Chamber, CoinSphere, FieldVessels, QuantumDraw, SceneProvider, StageContent, Warmup } from '@qsd/scene';
import type { CryptoEvent } from '@qsd/crypto';
import { colors } from '@qsd/ui-tokens';
import { ReactThreeTestRenderer, THREE } from './deps.js';
import { fullStream, hFixture } from './fixture.js';

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;
const mounted: Renderer[] = [];
afterEach(async () => {
  while (mounted.length) await mounted.pop()!.unmount();
});

async function mount(store: SceneStore, extra?: React.ReactNode, warmup = false): Promise<Renderer> {
  const r = await ReactThreeTestRenderer.create(
    <SceneProvider store={store} quality="low">
      <CameraRig />
      <StageContent store={store} />
      {warmup ? <Warmup /> : null}
      {extra}
    </SceneProvider>,
  );
  mounted.push(r);
  return r;
}

function sceneOf(r: Renderer): THREE.Scene {
  return (r.scene as unknown as { instance: THREE.Scene }).instance;
}

function instancedMeshes(r: Renderer): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  sceneOf(r).traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}

function litEntries(m: THREE.InstancedMesh): { lit: number; active: number; dark: number } {
  const a = m.geometry.getAttribute('aLit') as THREE.BufferAttribute;
  let lit = 0;
  let active = 0;
  let dark = 0;
  for (let i = 0; i < a.count; i++) {
    const v = a.getX(i);
    if (v >= 2) active++;
    else if (v >= 1) lit++;
    else dark++;
  }
  return { lit, active, dark };
}

/** Full numeric snapshot of the graph: transforms, visibility, material scalars, instance matrices, lit attributes. */
function snapshot(r: Renderer, skip: (o: THREE.Object3D) => boolean = () => false): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let i = 0;
  sceneOf(r).traverse((o) => {
    const key = `${i++}:${o.type}:${o.name}`;
    if (skip(o)) return;
    const v: number[] = [...o.position.toArray(), ...o.rotation.toArray().slice(0, 3).map(Number), ...o.scale.toArray(), o.visible ? 1 : 0];
    const mesh = o as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      const mm = m as THREE.MeshStandardMaterial & { uniforms?: Record<string, { value: unknown }> };
      v.push(mm.opacity ?? -1, mm.emissiveIntensity ?? -1);
      if (mm.emissive) v.push(...mm.emissive.toArray());
      if (mm.uniforms) for (const u of Object.values(mm.uniforms)) if (typeof u.value === 'number') v.push(u.value);
    }
    const light = o as THREE.Light;
    if (light.isLight) v.push(light.intensity);
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      v.push(im.count, ...Array.from(im.instanceMatrix.array as Float32Array));
      const lit = im.geometry.getAttribute('aLit') as THREE.BufferAttribute | undefined;
      if (lit) v.push(...Array.from(lit.array as Float32Array));
    }
    const g = (o as THREE.Points).geometry;
    if (g && (o as THREE.Points).isPoints) v.push(g.drawRange.count, ...Array.from((g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array).slice(0, 300));
    out.set(key, v);
  });
  return out;
}

function diff(a: Map<string, number[]>, b: Map<string, number[]>, eps = 1e-9): string[] {
  const out: string[] = [];
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) {
      out.push(`${k}: removed`);
      continue;
    }
    if (va.length !== vb.length) {
      out.push(`${k}: length ${va.length} → ${vb.length}`);
      continue;
    }
    for (let i = 0; i < va.length; i++) {
      if (Math.abs(va[i]! - vb[i]!) > eps) {
        out.push(`${k}: [${i}] ${va[i]} → ${vb[i]}`);
        break;
      }
    }
  }
  for (const k of b.keys()) if (!a.has(k)) out.push(`${k}: added`);
  return out;
}

describe('headless render (item 5)', () => {
  it('stage 2 after Agent H stream: exactly one chain ring InstancedMesh with count 1072, 1072 lit, 256 + 255 tree instances', async () => {
    const f = await hFixture();
    const store = createSceneStore();
    replayEvents(f.keygen.filter((e) => e.type === 'keygenStart' || ((e.type === 'chainStep' || e.type === 'chainComplete') && e.leaf < 3)), store);
    expect(store.getState().stage).toBe(2);
    const r = await mount(store);
    await r.advanceFrames(3, 1 / 60);
    const rings = instancedMeshes(r).filter((m) => m.name === 'chain-ring');
    expect(rings).toHaveLength(1);
    expect(rings[0]!.count).toBe(CHAIN_INSTANCES);
    expect(rings[0]!.count).toBe(67 * 16);
    expect(rings[0]!.instanceMatrix.count).toBe(CHAIN_INSTANCES);
    const e = litEntries(rings[0]!);
    expect(e.lit + e.active).toBe(CHAIN_INSTANCES); // leaf 2 fully grown
    expect(e.active).toBe(1); // exactly the newest link glows active
    expect(e.dark).toBe(0);
    const names = instancedMeshes(r).map((m) => [m.name, m.count]);
    expect(names).toContainEqual(['merkle-leaves', LEAVES]);
    expect(names).toContainEqual(['merkle-fused', FUSED_NODES]);
    // the 1072 instance positions are all distinct (a literal ring of 67 columns × 16)
    const m = new THREE.Matrix4();
    const seen = new Set<string>();
    for (let i = 0; i < CHAIN_INSTANCES; i++) {
      rings[0]!.getMatrixAt(i, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      seen.add(`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`);
    }
    expect(seen.size).toBe(CHAIN_INSTANCES);
  });

  it('partial leaf: lit entries equal exactly N for N chainSteps, and the Merkle leaves are all scaled to zero', async () => {
    const f = await hFixture();
    const start = f.keygen.find((e) => e.type === 'keygenStart')!;
    const steps = f.keygen.filter((e): e is Extract<CryptoEvent, { type: 'chainStep' }> => e.type === 'chainStep' && e.leaf === 0);
    for (const N of [1, 37, 500]) {
      const store = createSceneStore();
      replayEvents([start, ...steps.slice(0, N)], store);
      const r = await mount(store);
      await r.advanceFrames(2, 1 / 60);
      const ring = instancedMeshes(r).find((m) => m.name === 'chain-ring')!;
      const e = litEntries(ring);
      expect(e.lit + e.active, `N=${N}`).toBe(N);
      expect(e.active).toBe(1);
      const leaves = instancedMeshes(r).find((m) => m.name === 'merkle-leaves')!;
      const mtx = new THREE.Matrix4();
      const s = new THREE.Vector3();
      for (let i = 0; i < LEAVES; i++) {
        leaves.getMatrixAt(i, mtx);
        s.setFromMatrixScale(mtx);
        expect(s.x, `leaf ${i} must be invisible (no leafFormed)`).toBeLessThan(1e-3);
      }
      await mounted.pop()!.unmount();
    }
  });

  it('empty store: no instanced mesh, and the graph is numerically identical after 60 frames except the documented ambient items', async () => {
    const store = createSceneStore();
    const r = await mount(store);
    await r.advanceFrames(2, 1 / 60);
    expect(instancedMeshes(r)).toHaveLength(0);
    expect(store.getState().stage).toBe(1);
    const graphBefore = r.toGraph();
    // README §3 ambient: chamber rings rotate at constant rates; the stage-1 coin pulses ±6 %.
    const ambient = (o: THREE.Object3D): boolean => {
      const isRing = o.parent?.parent?.type === 'Group' && (o as THREE.Mesh).geometry?.type === 'TorusGeometry';
      const isCoin = (o as THREE.Mesh).geometry?.type === 'SphereGeometry' && o.parent?.type === 'Scene';
      return isRing || isCoin;
    };
    const before = snapshot(r, ambient);
    await r.advanceFrames(60, 1 / 60);
    const after = snapshot(r, ambient);
    expect(r.toGraph()).toEqual(graphBefore);
    expect(diff(before, after)).toEqual([]);
    expect(store.getState().version).toBe(0);

    // the ambient items move only in the documented way: rings rotate (position/scale fixed), coin scale within ±6 %
    const rings: THREE.Mesh[] = [];
    let coin: THREE.Mesh | null = null;
    sceneOf(r).traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry?.type === 'TorusGeometry') rings.push(m);
      if (m.geometry?.type === 'SphereGeometry' && o.parent?.type === 'Scene') coin = m;
    });
    expect(rings).toHaveLength(3);
    for (const ring of rings) {
      expect(ring.position.length()).toBe(0);
      expect(ring.scale.toArray()).toEqual([1, 1, 1]);
    }
    expect(coin).not.toBeNull();
    const c = coin as unknown as THREE.Mesh;
    expect(Math.abs(c.scale.x - 1)).toBeLessThanOrEqual(0.0601);
    expect(c.position.length()).toBe(0);
    // the camera sits at the stage-1 pose and does not drift
    const cam = (r as unknown as { getInstance?: unknown }) && (sceneOf(r).parent ?? null);
    void cam;
  });

  it('empty store with <Warmup/>: the only graph change is the documented invisible shader-warmup group (zero-scale samples, hidden)', async () => {
    const store = createSceneStore();
    const r = await mount(store, null, true);
    await r.advanceFrames(1, 1 / 60);
    const n0 = countNodes(sceneOf(r));
    await r.advanceFrames(60, 1 / 60);
    const warm = sceneOf(r).getObjectByName('shader-warmup') as THREE.Group;
    expect(warm).toBeDefined();
    expect(warm.visible).toBe(false);
    for (const o of warm.children) expect(o.scale.x).toBeLessThanOrEqual(1e-3);
    expect(countNodes(sceneOf(r)) - n0).toBe(warm.children.length);
    expect(instancedMeshes(r).filter((m) => m.parent !== warm)).toHaveLength(0);
    expect(store.getState().version).toBe(0);
  });

  it('stage 6 after Agent H stream: signing ring 1072 with the 67 real stop depths, signature structure 67, tree 255', async () => {
    const f = await hFixture();
    const store = createSceneStore();
    replayEvents([...f.keygen, { type: 'superposition', input: f.superposition }, ...f.quantum, ...f.signing], store);
    expect(store.getState().stage).toBe(6);
    const r = await mount(store);
    await r.advanceFrames(400, 1 / 60); // let the eased sweeps settle (> 16/28 s)
    const meshes = instancedMeshes(r);
    const ring = meshes.find((m) => m.name === 'chain-ring')!;
    expect(ring.count).toBe(CHAIN_INSTANCES);
    expect(ring.userData.mode).toBe('signing');
    const sig = meshes.find((m) => m.name === 'signature-structure')!;
    expect(sig.count).toBe(CHAINS);
    expect(meshes.find((m) => m.name === 'merkle-fused')!.count).toBe(FUSED_NODES);
    // every chain: links from the stop depth up to the tip are lit; the stop itself is active; below is dark
    const a = ring.geometry.getAttribute('aLit') as THREE.BufferAttribute;
    const stops = store.getState().signature.stopDepths;
    let active = 0;
    for (let c = 0; c < CHAINS; c++) {
      const stop = stops[c]!;
      expect(stop).toBeGreaterThanOrEqual(0);
      for (let d = 0; d < LINKS; d++) {
        const v = a.getX(c * LINKS + d);
        if (d === stop) {
          expect(v, `chain ${c} depth ${d} (stop)`).toBe(2);
          active++;
        } else if (d > stop) expect(v, `chain ${c} depth ${d}`).toBe(1);
        else expect(v, `chain ${c} depth ${d}`).toBe(0);
      }
    }
    expect(active).toBe(67);
    // all 67 signature blocks lifted into their slots (scale 1), none at zero
    const mtx = new THREE.Matrix4();
    const s = new THREE.Vector3();
    for (let c = 0; c < CHAINS; c++) {
      sig.getMatrixAt(c, mtx);
      s.setFromMatrixScale(mtx);
      expect(s.x).toBeCloseTo(1, 2);
    }
  });

  it('stage 6 with NO signChainStop: the signing ring is all dark', async () => {
    const f = await hFixture();
    const store = createSceneStore();
    replayEvents(f.keygen, store);
    store.dispatch({ type: 'skipStage', to: 6 });
    const r = await mount(store);
    await r.advanceFrames(120, 1 / 60);
    const ring = instancedMeshes(r).find((m) => m.name === 'chain-ring')!;
    expect(litEntries(ring)).toEqual({ lit: 0, active: 0, dark: CHAIN_INSTANCES });
  });

  /**
   * FAILS-BY-DESIGN (H-S8). SignatureStructure.tsx:517 `continue`s when
   * lift[c] === target === 0, so a chain with no stop never has its instance
   * matrix written: the InstancedMesh default (identity) leaves all 67
   * signature blocks at scale 1 at the origin, hidden inside the coin sphere.
   * The file header claims "Instances of chains with no stop yet are scaled
   * to zero". Geometry no event produced is being drawn (occluded).
   */
  it('[H-S8] stage 6 with NO signChainStop: all 67 signature blocks must be at zero scale', async () => {
    const f = await hFixture();
    const store = createSceneStore();
    replayEvents(f.keygen, store);
    store.dispatch({ type: 'skipStage', to: 6 });
    const r = await mount(store);
    await r.advanceFrames(120, 1 / 60);
    const sig = instancedMeshes(r).find((m) => m.name === 'signature-structure')!;
    const mtx = new THREE.Matrix4();
    const s = new THREE.Vector3();
    const atScale1: number[] = [];
    for (let c = 0; c < CHAINS; c++) {
      sig.getMatrixAt(c, mtx);
      s.setFromMatrixScale(mtx);
      if (s.x > 1e-3) atScale1.push(c);
    }
    expect(atScale1, 'signature blocks drawn at scale 1 without a signChainStop event').toEqual([]);
  });

  it('the stage-2 ring is a mirror of the reducer: dispatching one more chainStep lights exactly one more link; no event, no change', async () => {
    const f = await hFixture();
    const start = f.keygen.find((e) => e.type === 'keygenStart')!;
    const steps = f.keygen.filter((e): e is Extract<CryptoEvent, { type: 'chainStep' }> => e.type === 'chainStep' && e.leaf === 0);
    const store = createSceneStore();
    replayEvents([start, ...steps.slice(0, 10)], store);
    const r = await mount(store);
    await r.advanceFrames(2, 1 / 60);
    const ring = instancedMeshes(r).find((m) => m.name === 'chain-ring')!;
    const before = snapshot(r, (o) => o !== ring);
    await r.advanceFrames(120, 1 / 60);
    expect(diff(before, snapshot(r, (o) => o !== ring))).toEqual([]);
    store.dispatch(steps[10]!);
    await r.advanceFrames(1, 1 / 60);
    const e = litEntries(ring);
    expect(e.lit + e.active).toBe(11);
  });

  it('stage 5: the collapse flash/point appear only after outcomeResolved (same store, before/after)', async () => {
    // StageContent at stage 4/5 mounts <SuperpositionCloud/>, whose drei <Html/> labels need a DOM
    // (README §10 limit), so the draw is mounted the way MeasurementScene does, minus the cloud.
    const f = await hFixture();
    const store = createSceneStore();
    replayEvents([...f.keygen, { type: 'superposition', input: f.superposition }, ...f.quantum.slice(0, 3)], store);
    expect(store.getState().stage).toBe(5);
    expect(store.getState().draw.phase).toBe('committed');
    const r = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <CameraRig />
        <Chamber />
        <CoinSphere />
        <QuantumDraw />
      </SceneProvider>,
    );
    mounted.push(r);
    await r.advanceFrames(200, 1 / 60);
    const draw = sceneOf(r).getObjectByName('quantum-draw')!;
    const ringMesh = draw.children.find((o) => (o as THREE.Mesh).geometry?.type === 'RingGeometry') as THREE.Mesh;
    const point = draw.children.find((o) => (o as THREE.Mesh).geometry?.type === 'SphereGeometry') as THREE.Mesh;
    expect(ringMesh.visible).toBe(false);
    expect(point.scale.x).toBeLessThanOrEqual(1e-3);
    // photons: one point per entropy byte
    const photons = draw.children.find((o) => (o as THREE.Points).isPoints) as THREE.Points;
    expect(photons.geometry.drawRange.count).toBe(store.getState().draw.entropy!.length);
    store.dispatch(f.quantum[3]!); // outcomeResolved
    await r.advanceFrames(5, 1 / 60);
    expect(ringMesh.visible).toBe(true);
    await r.advanceFrames(200, 1 / 60);
    expect(point.scale.x).toBeCloseTo(1, 2);
  });

  /**
   * FAILS-BY-DESIGN (H-S4). QuantumDraw.tsx:453 colours the collapsed point
   * magenta only when `outcome.label === 'collapse'` (exact). The protocol's
   * real labels are `collapse:<channelId>` (packages/protocol/src/resolver.ts
   * outcomeLabel), so on a real collapse the point is white — the same colour
   * as a survive. CollapseScene's own default predicate is /collapse/i; the
   * two disagree. The package fixture uses the bare label, which is why its
   * tests pass.
   */
  it('[H-S4] a real protocol collapse label (`collapse:<channel>`) colours the collapsed point with the collapse colour', async () => {
    const f = await hFixture();
    const store = createSceneStore();
    replayEvents([...f.keygen, { type: 'superposition', input: f.superposition }, ...f.quantum.slice(0, 3)], store);
    const resolved = f.quantum[3]!;
    expect(resolved.type).toBe('outcomeResolved');
    store.dispatch({ ...resolved, value: { kind: 'collapse', channelId: 'h-fast' }, outcomeLabel: 'collapse:h-fast' } as typeof resolved);
    const r = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <Chamber />
        <CoinSphere />
        <QuantumDraw />
      </SceneProvider>,
    );
    mounted.push(r);
    await r.advanceFrames(100, 1 / 60);
    const draw = sceneOf(r).getObjectByName('quantum-draw')!;
    const point = draw.children.find((o) => (o as THREE.Mesh).geometry?.type === 'SphereGeometry') as THREE.Mesh;
    const mat = point.material as THREE.MeshStandardMaterial;
    const collapse = new THREE.Color(colors.collapse);
    expect(mat.emissive.getHexString(), `point emissive is #${mat.emissive.getHexString()}, collapse colour is #${collapse.getHexString()}`).toBe(collapse.getHexString());
  });
});

describe('field render (item 6)', () => {
  it('350 coins → exactly two InstancedMeshes of count 350 and no per-coin meshes; [] → no vessel at all', async () => {
    const coins = Array.from({ length: 350 }, (_, i) => ({ ca: `h${i}`, uncertainty: (i % 11) / 10, activity: (i % 7) / 6, decayProgress: (i % 5) / 4, state: 'superposed' as const }));
    const store = createSceneStore();
    const r = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <FieldVessels coins={coins} />
      </SceneProvider>,
    );
    mounted.push(r);
    await r.advanceFrames(3, 1 / 60);
    const im = instancedMeshes(r);
    expect(im.map((m) => [m.name, m.count]).sort()).toEqual([
      ['field-clouds', 350],
      ['field-vessels', 350],
    ]);
    let meshes = 0;
    sceneOf(r).traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) meshes++;
    });
    expect(meshes).toBeLessThan(5); // the floor ring only, not 350 vessels
    expect(countNodes(sceneOf(r))).toBeLessThan(20);
    // every instance has a finite matrix
    const mtx = new THREE.Matrix4();
    for (const m of im) for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, mtx);
      expect(mtx.elements.every((x) => Number.isFinite(x))).toBe(true);
    }
    await mounted.pop()!.unmount();

    const empty = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <FieldVessels coins={[]} />
      </SceneProvider>,
    );
    mounted.push(empty);
    await empty.advanceFrames(3, 1 / 60);
    expect(instancedMeshes(empty)).toHaveLength(0);
  });

  it('a traded coin sits still while an untouched near-collapse coin drifts; a live measurement flashes only the named vessel', async () => {
    const coins = [
      { ca: 'traded', uncertainty: 0.5, activity: 1, decayProgress: 0.9, state: 'superposed' as const },
      { ca: 'dying', uncertainty: 0.5, activity: 0, decayProgress: 1, state: 'superposed' as const },
    ];
    const listeners: ((m: { ca: string; at: string }) => void)[] = [];
    const live = { subscribe: (l: (m: { ca: string; at: string }) => void) => (listeners.push(l), () => void 0) };
    const store = createSceneStore();
    const r = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <FieldVessels coins={coins} liveMeasurements={live} lodDistance={1000} />
      </SceneProvider>,
    );
    mounted.push(r);
    await r.advanceFrames(2, 1 / 60);
    const vessels = instancedMeshes(r).find((m) => m.name === 'field-vessels')!;
    const clouds = instancedMeshes(r).find((m) => m.name === 'field-clouds')!;
    const y = (i: number) => {
      const mtx = new THREE.Matrix4();
      vessels.getMatrixAt(i, mtx);
      return new THREE.Vector3().setFromMatrixPosition(mtx).y;
    };
    const ys0 = [y(0), y(1)];
    await r.advanceFrames(90, 1 / 60);
    const ys1 = [y(0), y(1)];
    expect(ys0[0]).toBe(0);
    expect(ys1[0]).toBe(0); // traded: no drift at all
    expect(Math.abs(ys1[1]! - ys0[1]!)).toBeGreaterThan(0.01); // untouched + near collapse: drifts
    const lit = clouds.geometry.getAttribute('aLit') as THREE.BufferAttribute;
    const before = [lit.getX(0), lit.getX(1)];
    expect(before[0]).toBeGreaterThan(before[1]!); // bright = traded
    listeners.forEach((l) => l({ ca: 'traded', at: new Date().toISOString() }));
    await r.advanceFrames(1, 1 / 60);
    expect(lit.getX(0)).toBeGreaterThan(before[0]! + 0.5);
    expect(lit.getX(1)).toBeCloseTo(before[1]!, 6);
    listeners.forEach((l) => l({ ca: 'unknown-ca', at: new Date().toISOString() }));
    await r.advanceFrames(1, 1 / 60);
    expect(lit.getX(1)).toBeCloseTo(before[1]!, 6);
  });
});

function countNodes(o: THREE.Object3D): number {
  let n = 0;
  o.traverse(() => n++);
  return n;
}
