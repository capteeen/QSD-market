import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  CHAIN_INSTANCES,
  FUSED_NODES,
  LEAVES,
  LINKS,
  TREE_HEIGHT,
  chainLinkHash,
  cloneSceneState,
  createInitialState,
  createSceneStore,
  fusedHash,
  fusedNodeIndex,
  fusedNodeOffset,
  leafHash,
  replayEvents,
  sceneReducer,
  stopHash,
  superpositionWidth,
  toHex,
  type SceneEvent,
  type SceneState,
  type Stage,
} from '../src/model/index.js';
import { FIXTURE_LINEAGE, FIXTURE_SUPERPOSITION, loadFixture, type Fixture } from './fixtures/generate.js';

let fixturePromise: Promise<Fixture> | null = null;
const fixture = (): Promise<Fixture> => (fixturePromise ??= loadFixture());

/** The launch order: keygen → superposition → draw → signing → anchor → lineage. */
function fullSequence(f: Fixture): SceneEvent[] {
  const signAt = f.crypto.findIndex((e) => e.type === 'signStart');
  const keygen = f.crypto.slice(0, signAt);
  const signing = f.crypto.slice(signAt);
  return [...keygen, { type: 'superposition', input: f.superposition }, ...f.quantum, ...signing, ...f.chain, { type: 'lineage', input: f.lineage }];
}

describe('empty stream', () => {
  it('leaves the state deep-equal to the initial state and at stage 1', () => {
    const store = createSceneStore();
    const before = cloneSceneState(store.getState());
    // "ticks": nothing happens between frames when no event arrives.
    for (let i = 0; i < 1000; i++) expect(store.getState()).toBe(store.getState());
    expect(replayEvents([])).toEqual(createInitialState());
    expect(store.getState()).toEqual(before);
    expect(store.getState().stage).toBe(1);
    expect(store.getState().version).toBe(0);
    expect(store.getState().keygen.chainSteps).toBe(0);
  });
});

describe('recorded real stream', () => {
  it('reproduces every count of the recorded key generation and signature, in stage order', async () => {
    const f = await fixture();
    const stages: Stage[] = [];
    const store = createSceneStore();
    store.subscribe((s, prev) => {
      if (s.stage !== prev.stage) stages.push(s.stage);
    });
    for (const e of fullSequence(f)) store.dispatch(e);
    const s = store.getState();

    // stage progression 1 → … → 8 strictly in order, every stage entered by an event
    expect(stages).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(s.skipped).toEqual([]);
    expect(s.events.rejected).toBe(0);
    expect(s.events.accepted).toBe(fullSequence(f).length);

    // keygen
    expect(s.keygen.leaves).toBe(LEAVES);
    expect(s.keygen.chains).toBe(CHAINS);
    expect(s.keygen.links).toBe(LINKS);
    expect(s.keygen.chainSteps).toBe(LEAVES * CHAINS * LINKS); // 274 432, not faked
    expect(s.keygen.chainsComplete).toBe(LEAVES * CHAINS);
    expect(s.keygen.leavesFormed).toBe(LEAVES);
    for (let leaf = 0; leaf < LEAVES; leaf++) {
      expect(s.keygen.linksPerLeaf[leaf]).toBe(CHAIN_INSTANCES); // 67 × 16 for EVERY leaf
      expect(s.keygen.chainsCompletePerLeaf[leaf]).toBe(CHAINS);
      expect(s.keygen.leafFormed[leaf]).toBe(1);
    }
    expect(s.keygen.currentLeaf).toBe(LEAVES - 1);
    expect(Array.from(s.keygen.depths)).toEqual(new Array(CHAINS).fill(LINKS));

    // merkle
    expect(Array.from(s.merkle.fusedPerLevel)).toEqual([128, 64, 32, 16, 8, 4, 2, 1]);
    expect(s.merkle.fusedTotal).toBe(FUSED_NODES);
    expect(s.merkle.highestLevel).toBe(TREE_HEIGHT - 1);
    const rootEvent = f.crypto.find((e) => e.type === 'rootReady');
    expect(rootEvent?.type).toBe('rootReady');
    expect(s.merkle.root && toHex(s.merkle.root)).toBe(f.manifest.rootHex);
    if (rootEvent?.type === 'rootReady') expect(toHex(s.merkle.root as Uint8Array)).toBe(toHex(rootEvent.root));
    // the top fuse's parent is the root
    expect(toHex(fusedHash(s, 7, 0) as Uint8Array)).toBe(f.manifest.rootHex);

    // signature: 67 stop depths exactly equal to the signChainStop events, 8 auth nodes
    const stops = f.crypto.filter((e) => e.type === 'signChainStop');
    expect(stops).toHaveLength(CHAINS);
    for (const e of stops) {
      if (e.type !== 'signChainStop') continue;
      expect(s.signature.stopDepths[e.chainIdx]).toBe(e.depth);
      expect(toHex(stopHash(s, e.chainIdx) as Uint8Array)).toBe(toHex(e.hash));
    }
    expect(s.signature.stopsSeen).toBe(CHAINS);
    expect(s.signature.authCount).toBe(TREE_HEIGHT);
    expect(s.signature.ready).toBe(true);
    expect(s.signature.bytesLength).toBe(2436);

    // draw
    expect(s.draw.phase).toBe('resolved');
    expect(s.draw.entropy?.length).toBe(32);
    expect(s.draw.attestation?.kind).toBe('unsafe-dev');
    expect(s.draw.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(s.draw.outcome?.label).toMatch(/^(collapse|survive)$/);
    expect(s.draw.resolvedCount).toBe(1);

    // cloud, anchor, lineage
    expect(s.cloud.width).toBeCloseTo(0.4, 6);
    expect(s.cloud.channels.map((c) => c.percentLabel)).toEqual(['45.00%', '40.00%', '15.00%']);
    expect(s.anchor.anchored).toBe(true);
    expect(s.anchor.txSignature).toBe(f.chain[1]?.type === 'anchored' ? f.chain[1].txSignature : null);
    expect(s.lineage?.ca).toBe(FIXTURE_LINEAGE.ca);
    expect(s.stage).toBe(8);
  });

  it('retains the hover hashes of the leaf in view, the 256 leaves and the 255 fused nodes', async () => {
    const f = await fixture();
    const s = replayEvents(f.crypto);
    const last = s.keygen.currentLeaf;
    const lastLeafSteps = f.crypto.filter((e) => e.type === 'chainStep' && e.leaf === last);
    expect(lastLeafSteps).toHaveLength(CHAIN_INSTANCES);
    for (const e of lastLeafSteps) {
      if (e.type !== 'chainStep') continue;
      expect(toHex(chainLinkHash(s, e.chainIdx, e.depth) as Uint8Array)).toBe(toHex(e.hash));
    }
    for (const e of f.crypto) {
      if (e.type === 'leafFormed') expect(toHex(leafHash(s, e.leaf) as Uint8Array)).toBe(toHex(e.hash));
      if (e.type === 'treeLevelFused') expect(toHex(fusedHash(s, e.level, e.index) as Uint8Array)).toBe(toHex(e.parent));
    }
    // a leaf that is no longer in view has no per-link hashes (documented policy)
    expect(chainLinkHash(s, 0, LINKS)).toBeNull();
    expect(chainLinkHash(s, CHAINS, 0)).toBeNull();
  });

  it('stage 3 is entered on the last leafFormed and stage 4 only once both root and superposition exist', async () => {
    const f = await fixture();
    let s = createInitialState();
    for (const e of f.crypto) {
      if (e.type === 'treeLevelFused') break;
      s = sceneReducer(s, e);
    }
    expect(s.keygen.leavesFormed).toBe(LEAVES);
    expect(s.stage).toBe(3);
    // superposition before root: stays at 3, cloud stored
    s = sceneReducer(s, { type: 'superposition', input: FIXTURE_SUPERPOSITION });
    expect(s.stage).toBe(3);
    expect(s.cloud.input).toBe(FIXTURE_SUPERPOSITION);
    for (const e of f.crypto) {
      if (e.type === 'treeLevelFused' || e.type === 'rootReady') s = sceneReducer(s, e);
    }
    expect(s.stage).toBe(4);
  });
});

describe('skipStage', () => {
  it('advances only the label and never fabricates counts', async () => {
    const f = await fixture();
    // take exactly 3 leaves of chainSteps
    const partial = f.crypto.filter((e) => e.type === 'keygenStart' || (e.type === 'chainStep' && e.leaf < 3));
    let s = replayEvents(partial);
    expect(s.stage).toBe(2);
    expect(s.keygen.chainSteps).toBe(3 * CHAIN_INSTANCES);
    const countsBefore = {
      chainSteps: s.keygen.chainSteps,
      leaves: s.keygen.leavesFormed,
      fused: s.merkle.fusedTotal,
      stops: s.signature.stopsSeen,
      depths: Array.from(s.keygen.depths),
    };
    s = sceneReducer(s, { type: 'skipStage' });
    expect(s.stage).toBe(3);
    expect(s.skipped).toEqual([2]);
    s = sceneReducer(s, { type: 'skipStage', to: 6 });
    expect(s.stage).toBe(6);
    expect(s.skipped).toEqual([2, 3, 4, 5]);
    expect(s.keygen.chainSteps).toBe(countsBefore.chainSteps);
    expect(s.keygen.leavesFormed).toBe(countsBefore.leaves);
    expect(s.merkle.fusedTotal).toBe(countsBefore.fused);
    expect(s.signature.stopsSeen).toBe(countsBefore.stops);
    expect(Array.from(s.keygen.depths)).toEqual(countsBefore.depths);
    expect(s.merkle.root).toBeNull();
    // skipping backwards or to the same stage is a no-op for the label
    s = sceneReducer(s, { type: 'skipStage', to: 2 });
    expect(s.stage).toBe(6);
    // events keep being counted after a skip
    s = sceneReducer(s, f.crypto.find((e) => e.type === 'chainStep' && e.leaf === 3) as SceneEvent);
    expect(s.keygen.chainSteps).toBe(countsBefore.chainSteps + 1);
    expect(s.stage).toBe(6); // never goes back
  });

  it('createSceneStore({ startStage }) is recorded as a skip', () => {
    const store = createSceneStore({ startStage: 5 });
    expect(store.getState().stage).toBe(5);
    expect(store.getState().skipped).toEqual([1, 2, 3, 4]);
    expect(store.getState().keygen.chainSteps).toBe(0);
  });
});

describe('sequence discipline', () => {
  const hash = (): Uint8Array => new Uint8Array(32).fill(7);

  it('rejects an out-of-order seq and flags it, without touching counts', () => {
    let s = createInitialState();
    s = sceneReducer(s, { type: 'keygenStart', seq: 0, leaves: 256, chains: 67, links: 16 });
    s = sceneReducer(s, { type: 'chainStep', seq: 5, leaf: 0, chainIdx: 0, depth: 0, hash: hash() });
    expect(s.keygen.chainSteps).toBe(1);
    s = sceneReducer(s, { type: 'chainStep', seq: 5, leaf: 0, chainIdx: 0, depth: 1, hash: hash() });
    expect(s.keygen.chainSteps).toBe(1);
    expect(s.events.rejected).toBe(1);
    expect(s.events.lastRejectedReason).toMatch(/seq 5 is not after 5/);
    s = sceneReducer(s, { type: 'chainStep', seq: 3, leaf: 0, chainIdx: 0, depth: 1, hash: hash() });
    expect(s.events.rejected).toBe(2);
    expect(s.keygen.depths[0]).toBe(1);
    // a gap is fine (another subscriber may have consumed events)
    s = sceneReducer(s, { type: 'chainStep', seq: 100, leaf: 0, chainIdx: 0, depth: 1, hash: hash() });
    expect(s.keygen.chainSteps).toBe(2);
    expect(s.events.lastSeq.crypto).toBe(100);
  });

  it('allows a fresh observer at the start of a new operation (signStart resets the watermark)', () => {
    let s = createInitialState();
    s = sceneReducer(s, { type: 'rootReady', seq: 999, root: hash() });
    s = sceneReducer(s, { type: 'signStart', seq: 0, index: 0, r: hash(), digest: hash() });
    expect(s.events.rejected).toBe(0);
    expect(s.stage).toBe(6);
    s = sceneReducer(s, { type: 'signChainStop', seq: 1, chainIdx: 0, depth: 9, hash: hash() });
    expect(s.signature.stopDepths[0]).toBe(9);
  });

  it('keeps per-source watermarks independent', () => {
    let s = createInitialState();
    s = sceneReducer(s, { type: 'chainStep', seq: 10, leaf: 0, chainIdx: 0, depth: 0, hash: hash() });
    s = sceneReducer(s, { type: 'entropyRequested', seq: 0, at: 'x', providerId: 'p', nBytes: 32, requestedAt: 'x' });
    s = sceneReducer(s, { type: 'anchored', seq: 0, txSignature: 't' });
    expect(s.events.rejected).toBe(0);
    expect(s.events.lastSeq).toEqual({ crypto: 10, quantum: 0, chain: 0 });
  });

  it('rejects malformed events (ranges, hash length, missing tx)', () => {
    let s = createInitialState();
    const before = cloneSceneState(s);
    s = sceneReducer(s, { type: 'chainStep', seq: 0, leaf: 0, chainIdx: 67, depth: 0, hash: hash() });
    s = sceneReducer(s, { type: 'chainStep', seq: 1, leaf: 256, chainIdx: 0, depth: 0, hash: hash() });
    s = sceneReducer(s, { type: 'chainStep', seq: 2, leaf: 0, chainIdx: 0, depth: 16, hash: hash() });
    s = sceneReducer(s, { type: 'chainStep', seq: 3, leaf: 0, chainIdx: 0, depth: 0, hash: new Uint8Array(31) });
    s = sceneReducer(s, { type: 'treeLevelFused', seq: 4, level: 0, index: 128, left: hash(), right: hash(), parent: hash() });
    s = sceneReducer(s, { type: 'authPathNode', seq: 5, level: 8, hash: hash() });
    s = sceneReducer(s, { type: 'anchored', seq: 0, txSignature: '' });
    s = sceneReducer(s, { type: 'unknownEvent' } as unknown as SceneEvent);
    expect(s.events.rejected).toBe(8);
    expect(s.version).toBe(0);
    expect({ ...s, events: before.events }).toEqual(before);
  });
});

describe('merkle indexing', () => {
  it('flat offsets cover exactly 255 nodes', () => {
    expect(fusedNodeOffset(0)).toBe(0);
    expect(fusedNodeOffset(1)).toBe(128);
    expect(fusedNodeOffset(7)).toBe(254);
    expect(fusedNodeIndex(7, 0)).toBe(254);
    expect(fusedNodeOffset(8)).toBe(FUSED_NODES);
  });
});

describe('superposition width', () => {
  it('is the relative spread, computed in bigint, clamped to 0..1', () => {
    const base = { halfLifeSec: 1, decayChannels: [] };
    expect(superpositionWidth({ ...base, supplyMin: 0n, supplyMax: 100n })).toBe(1);
    expect(superpositionWidth({ ...base, supplyMin: 100n, supplyMax: 100n })).toBe(0);
    expect(superpositionWidth({ ...base, supplyMin: 75n, supplyMax: 100n })).toBeCloseTo(0.25, 6);
    expect(superpositionWidth({ ...base, supplyMin: 0n, supplyMax: 0n })).toBe(0);
    expect(superpositionWidth({ ...base, supplyMin: -5n, supplyMax: 10n })).toBe(1);
    expect(superpositionWidth({ ...base, supplyMin: 10n ** 30n, supplyMax: 2n * 10n ** 30n })).toBeCloseTo(0.5, 6);
  });
});

describe('cloneSceneState', () => {
  it('produces an independent copy', async () => {
    const f = await fixture();
    const s = replayEvents(f.crypto.slice(0, 5000));
    const c = cloneSceneState(s);
    expect(c).toEqual(s);
    (c.keygen.depths as Int8Array)[0] = 99;
    expect(s.keygen.depths[0]).not.toBe(99);
  });
});

describe('store', () => {
  it('notifies subscribers once per accepted event and reset() returns to the initial state', () => {
    const store = createSceneStore();
    let n = 0;
    store.subscribe(() => n++);
    store.dispatch({ type: 'keygenStart', seq: 0, leaves: 256, chains: 67, links: 16 });
    store.dispatch({ type: 'keygenStart', seq: 0, leaves: 256, chains: 67, links: 16 }); // watermark reset event: accepted
    expect(n).toBe(2);
    store.reset();
    const s: SceneState = store.getState();
    expect(s).toEqual(createInitialState());
  });
});
