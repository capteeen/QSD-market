/**
 * Render smoke test without WebGL (@react-three/test-renderer mocks the
 * canvas). Asserts that geometry COUNT is a constant of the construction and
 * that the scene graph does not change when no event arrives.
 */
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { describe, expect, it } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type * as THREE from 'three';
import { CHAIN_INSTANCES, CHAINS, FUSED_NODES, LEAVES, createSceneStore, replayEvents } from '../src/model/index.js';
import { SceneProvider } from '../src/render/context.js';
import { StageContent } from '../src/render/LaunchSequence.js';
import { FieldVessels } from '../src/render/FieldScene.js';
import { loadFixture } from './fixtures/generate.js';

type Node = { instance: THREE.Object3D & { isInstancedMesh?: boolean; count?: number }; children: Node[] };

function instanced(scene: { findAll(fn: (n: Node) => boolean): Node[] }): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of scene.findAll((node) => !!node.instance.isInstancedMesh)) out.set(n.instance.name, n.instance.count as number);
  return out;
}

function countNodes(n: Node): number {
  return 1 + n.children.reduce((a, c) => a + countNodes(c), 0);
}

describe('render (headless)', () => {
  it('stage 2 mounts exactly one chain ring of 67 × 16 = 1072 instances, 256 leaves and 255 fused nodes', async () => {
    const f = await loadFixture();
    const store = createSceneStore();
    // 2 leaves of real chainSteps
    replayEvents(
      f.crypto.filter((e) => e.type === 'keygenStart' || (e.type === 'chainStep' && e.leaf < 2)),
      store,
    );
    expect(store.getState().stage).toBe(2);
    const r = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <StageContent store={store} />
      </SceneProvider>,
    );
    await r.advanceFrames(3, 16);
    const m = instanced(r.scene as never);
    expect(m.get('chain-ring')).toBe(CHAIN_INSTANCES);
    expect(m.get('merkle-leaves')).toBe(LEAVES);
    expect(m.get('merkle-fused')).toBe(FUSED_NODES);
    expect([...m.keys()].filter((k) => k === 'chain-ring')).toHaveLength(1);
    // the lit attribute mirrors the reducer: leaf 1 fully grown → 1072 lit entries
    const ring = r.scene.findAll((n) => n.instance.name === 'chain-ring')[0]!;
    const geom = (ring.instance as THREE.InstancedMesh).geometry;
    const lit = geom.getAttribute('aLit') as THREE.BufferAttribute;
    let litCount = 0;
    for (let i = 0; i < lit.count; i++) if (lit.getX(i) >= 1) litCount++;
    expect(litCount).toBe(CHAIN_INSTANCES);
    await r.unmount();
  });

  it('with an empty stream the scene graph does not change across frames', async () => {
    const store = createSceneStore();
    const r = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <StageContent store={store} />
      </SceneProvider>,
    );
    await r.advanceFrames(2, 16);
    const before = countNodes(r.scene as never);
    const graphBefore = r.toGraph();
    await r.advanceFrames(60, 16);
    expect(countNodes(r.scene as never)).toBe(before);
    expect(r.toGraph()).toEqual(graphBefore);
    expect(instanced(r.scene as never).size).toBe(0); // no chains, no tree: nothing was computed
    expect(store.getState().stage).toBe(1);
    await r.unmount();
  });

  it('stage 6 mounts the signing ring (1072) and the 67-slot signature structure', async () => {
    const f = await loadFixture();
    const store = createSceneStore();
    replayEvents(f.crypto, store); // keygen + sign: stage 6 (no superposition / draw in this stream)
    store.dispatch({ type: 'skipStage', to: 6 });
    expect(store.getState().stage).toBe(6);
    const r = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <StageContent store={store} />
      </SceneProvider>,
    );
    await r.advanceFrames(2, 16);
    const m = instanced(r.scene as never);
    expect(m.get('chain-ring')).toBe(CHAIN_INSTANCES);
    expect(m.get('signature-structure')).toBe(CHAINS);
    expect(m.get('merkle-fused')).toBe(FUSED_NODES);
    await r.unmount();
  });

  it('the field draws one vessel and one cloud instance per coin, and nothing for an empty list', async () => {
    const store = createSceneStore();
    const coins = Array.from({ length: 320 }, (_, i) => ({
      ca: `c${i}`,
      uncertainty: (i % 10) / 10,
      activity: (i % 7) / 7,
      decayProgress: (i % 5) / 5,
      state: 'superposed' as const,
    }));
    const r = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <FieldVessels coins={coins} />
      </SceneProvider>,
    );
    await r.advanceFrames(2, 16);
    const m = instanced(r.scene as never);
    expect(m.get('field-vessels')).toBe(320);
    expect(m.get('field-clouds')).toBe(320);
    await r.unmount();

    const empty = await ReactThreeTestRenderer.create(
      <SceneProvider store={store} quality="low">
        <FieldVessels coins={[]} />
      </SceneProvider>,
    );
    await empty.advanceFrames(2, 16);
    expect(instanced(empty.scene as never).size).toBe(0);
    await empty.unmount();
  });
});
