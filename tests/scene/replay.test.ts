/**
 * SPEC §10: "Feed the scene a recorded event stream … confirm it reproduces
 * the former. Count rendered chain links: must be exactly 67×16."
 * SPEC §7 CORE RULE: every visual is driven by a real event; stage order 1→8.
 *
 * Agent H's own recorded stream (tests/scene/fixture.ts) through the model.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  CHAIN_INSTANCES,
  FUSED_NODES,
  LEAVES,
  LINKS,
  TREE_HEIGHT,
  authHash,
  chainLinkHash,
  cloneSceneState,
  createInitialState,
  createSceneStore,
  fusedHash,
  leafHash,
  replayEvents,
  sceneReducer,
  stopHash,
  type SceneEvent,
  type SceneState,
  type Stage,
} from '@qsd/scene';
import type { CryptoEvent } from '@qsd/crypto';
import { bytesEqual, fullStream, hFixture } from './fixture.js';

type Ev<T extends CryptoEvent['type']> = Extract<CryptoEvent, { type: T }>;

describe('reducer replay of Agent H recorded stream', () => {
  it('reproduces 67×16 per leaf, 256 leaves, 255 fuses [128..1], root, 67 stops, 8 auth nodes, stage 8', async () => {
    const f = await hFixture();
    const events = fullStream(f);
    const s = replayEvents(events);

    // --- key generation: 274 432 chainSteps, exactly 1072 per leaf -------------
    expect(s.keygen.chainSteps).toBe(LEAVES * CHAIN_INSTANCES);
    for (let leaf = 0; leaf < LEAVES; leaf++) expect(s.keygen.linksPerLeaf[leaf], `leaf ${leaf}`).toBe(CHAINS * LINKS);
    // independently count from the raw events (do not trust the reducer's aggregate)
    const perLeafPerChain = new Map<string, Set<number>>();
    for (const e of f.keygen) {
      if (e.type !== 'chainStep') continue;
      const k = `${e.leaf}:${e.chainIdx}`;
      (perLeafPerChain.get(k) ?? perLeafPerChain.set(k, new Set()).get(k)!).add(e.depth);
    }
    expect(perLeafPerChain.size).toBe(LEAVES * CHAINS);
    for (const [k, depths] of perLeafPerChain) expect(depths.size, k).toBe(LINKS);
    // leaf in view = last leaf; all 67 chains grown to 16
    expect(s.keygen.currentLeaf).toBe(LEAVES - 1);
    let lit = 0;
    for (let c = 0; c < CHAINS; c++) {
      expect(s.keygen.depths[c]).toBe(LINKS);
      lit += s.keygen.depths[c]!;
    }
    expect(lit).toBe(67 * 16);
    expect(s.keygen.chainsComplete).toBe(LEAVES * CHAINS);

    // --- hover hashes of the leaf in view equal the recorded (redacted) events --
    const last = f.keygen.filter((e): e is Ev<'chainStep'> => e.type === 'chainStep' && e.leaf === LEAVES - 1);
    expect(last).toHaveLength(CHAIN_INSTANCES);
    for (const e of last) expect(bytesEqual(chainLinkHash(s, e.chainIdx, e.depth), e.hash), `link ${e.chainIdx}/${e.depth}`).toBe(true);

    // --- leaves ---------------------------------------------------------------
    expect(s.keygen.leavesFormed).toBe(LEAVES);
    const leafEvents = f.keygen.filter((e): e is Ev<'leafFormed'> => e.type === 'leafFormed');
    expect(leafEvents).toHaveLength(LEAVES);
    for (const e of leafEvents) expect(bytesEqual(leafHash(s, e.leaf), e.hash), `leaf ${e.leaf}`).toBe(true);

    // --- merkle ---------------------------------------------------------------
    expect(s.merkle.fusedTotal).toBe(FUSED_NODES);
    expect(Array.from(s.merkle.fusedPerLevel)).toEqual([128, 64, 32, 16, 8, 4, 2, 1]);
    const fusedEvents = f.keygen.filter((e): e is Ev<'treeLevelFused'> => e.type === 'treeLevelFused');
    expect(fusedEvents).toHaveLength(FUSED_NODES);
    for (const e of fusedEvents) expect(bytesEqual(fusedHash(s, e.level, e.index), e.parent), `fused ${e.level}/${e.index}`).toBe(true);
    const rootEv = f.keygen.find((e): e is Ev<'rootReady'> => e.type === 'rootReady')!;
    expect(bytesEqual(s.merkle.root, rootEv.root)).toBe(true);
    expect(bytesEqual(s.merkle.root, f.root)).toBe(true); // byte-for-byte the identity's real root

    // --- superposition ----------------------------------------------------------
    expect(s.cloud.input).toBe(f.superposition);
    expect(s.cloud.width).toBeCloseTo(0.75, 6);
    expect(s.cloud.channels.map((c) => c.percentLabel)).toEqual(['50.00%', '30.00%', '20.00%']);

    // --- draw -------------------------------------------------------------------
    expect(s.draw.phase).toBe('resolved');
    const arrived = f.quantum.find((e) => e.type === 'entropyArrived')!;
    expect(arrived.type === 'entropyArrived' && bytesEqual(s.draw.entropy, arrived.bytes)).toBe(true);
    expect(s.draw.resolvedCount).toBe(1);
    expect(s.draw.attestation?.kind).toBe('unsafe-dev');

    // --- signature: 67 stop depths and 8 auth nodes equal the events ------------
    const stops = f.signing.filter((e): e is Ev<'signChainStop'> => e.type === 'signChainStop');
    expect(stops).toHaveLength(CHAINS);
    expect(s.signature.stopsSeen).toBe(CHAINS);
    for (const e of stops) {
      expect(s.signature.stopDepths[e.chainIdx]).toBe(e.depth);
      expect(bytesEqual(stopHash(s, e.chainIdx), e.hash)).toBe(true);
    }
    const auth = f.signing.filter((e): e is Ev<'authPathNode'> => e.type === 'authPathNode');
    expect(auth).toHaveLength(TREE_HEIGHT);
    expect(s.signature.authCount).toBe(TREE_HEIGHT);
    for (const e of auth) expect(bytesEqual(authHash(s, e.level), e.hash)).toBe(true);
    expect(s.signature.index).toBe(f.signedIndex);
    expect(s.signature.ready).toBe(true);
    expect(s.signature.bytesLength).toBe(2436);

    // --- anchor / lineage / stage -----------------------------------------------
    expect(s.anchor.anchored).toBe(true);
    expect(s.anchor.txSignature).toBe(f.chain[1]!.txSignature);
    expect(s.anchor.slot).toBe(123_456);
    expect(s.lineage).toBe(f.lineage);
    expect(s.stage).toBe(8);
    expect(s.skipped).toEqual([]);
    expect(s.events.rejected).toBe(0);
    expect(s.events.accepted).toBe(events.length);
  });

  it('enters stages strictly 1→8, each exactly on its triggering event (stage before and after)', async () => {
    const f = await hFixture();
    const events = fullStream(f);
    let s = createInitialState();
    const entered: { stage: Stage; type: SceneEvent['type']; i: number }[] = [];
    const firstOf = new Map<string, number>();
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (!firstOf.has(e.type)) firstOf.set(e.type, i);
      const before = s.stage;
      s = sceneReducer(s, e);
      if (s.stage !== before) {
        expect(s.stage, `stage must advance by exactly one at event ${i} (${e.type})`).toBe(before + 1);
        entered.push({ stage: s.stage, type: e.type, i });
      }
    }
    expect(entered.map((x) => x.stage)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    // the trigger of each stage is the documented event, and it is that event's FIRST occurrence
    // (stage 3 is the 256th leafFormed; stage 4 is the superposition input because rootReady came first;
    //  stage 8 is the lineage input because anchored came first)
    const byStage = Object.fromEntries(entered.map((x) => [x.stage, x]));
    expect(byStage[2]!.type).toBe('keygenStart');
    expect(byStage[2]!.i).toBe(firstOf.get('keygenStart'));
    expect(byStage[3]!.type).toBe('leafFormed');
    const leafIdx = events.map((e, i) => (e.type === 'leafFormed' ? i : -1)).filter((i) => i >= 0);
    expect(byStage[3]!.i).toBe(leafIdx[LEAVES - 1]); // exactly the 256th leafFormed, never earlier
    expect(byStage[3]!.i).toBeLessThan(firstOf.get('treeLevelFused')!);
    expect(byStage[4]!.type).toBe('superposition');
    expect(byStage[4]!.i).toBeGreaterThan(firstOf.get('rootReady')!);
    expect(byStage[5]!.type).toBe('entropyRequested');
    expect(byStage[5]!.i).toBe(firstOf.get('entropyRequested'));
    expect(byStage[6]!.type).toBe('signStart');
    expect(byStage[6]!.i).toBe(firstOf.get('signStart'));
    expect(byStage[7]!.type).toBe('anchorSubmitted');
    expect(byStage[7]!.i).toBe(firstOf.get('anchorSubmitted'));
    expect(byStage[8]!.type).toBe('lineage');
    expect(byStage[8]!.i).toBeGreaterThan(firstOf.get('anchored')!);
  });

  it('the store path (createSceneStore + dispatch one at a time) gives the same final state as replayEvents', async () => {
    const f = await hFixture();
    const events = fullStream(f);
    const direct = cloneSceneState(replayEvents(events));
    const store = createSceneStore();
    let notifications = 0;
    const unsub = store.subscribe(() => notifications++);
    for (const e of events) store.dispatch(e);
    unsub();
    const viaStore = cloneSceneState(store.getState());
    expect(notifications).toBe(events.length);
    expect(strip(viaStore)).toEqual(strip(direct));
    expect(bytesEqual(viaStore.merkle.root, direct.merkle.root)).toBe(true);
    expect(Array.from(viaStore.keygen.depths)).toEqual(Array.from(direct.keygen.depths));
    expect(Array.from(viaStore.signature.stopDepths)).toEqual(Array.from(direct.signature.stopDepths));
    expect(Array.from(viaStore.keygen.currentLeafHashes)).toEqual(Array.from(direct.keygen.currentLeafHashes));
  });

  it('keygen events alone (no sign, no draw) stop at stage 3 — stage 4 needs rootReady AND the superposition input', async () => {
    const f = await hFixture();
    const s = replayEvents(f.keygen);
    expect(s.stage).toBe(3);
    expect(s.merkle.root).not.toBeNull();
    const s4 = sceneReducer(s, { type: 'superposition', input: f.superposition });
    expect(s4.stage).toBe(4);
    // superposition before the root: stays where it is until rootReady
    const early = sceneReducer(createInitialState(), { type: 'superposition', input: f.superposition });
    expect(early.stage).toBe(1);
  });
});

describe('skipStage (item 4)', () => {
  it('never fabricates counts: counts after a skip remain exactly what the events produced, and `skipped` is recorded', async () => {
    const f = await hFixture();
    // first 3 leaves of real chainSteps only
    const partial = f.keygen.filter((e) => e.type === 'keygenStart' || ((e.type === 'chainStep' || e.type === 'chainComplete' || e.type === 'leafFormed') && e.leaf < 3));
    const s = replayEvents(partial);
    expect(s.stage).toBe(2);
    const counts = (x: SceneState) => ({
      chainSteps: x.keygen.chainSteps,
      leaves: x.keygen.leavesFormed,
      fused: x.merkle.fusedTotal,
      root: x.merkle.root,
      stops: x.signature.stopsSeen,
      auth: x.signature.authCount,
      depths: Array.from(x.keygen.depths),
      resolved: x.draw.resolvedCount,
      anchored: x.anchor.anchored,
    });
    const before = counts(s);
    expect(before.chainSteps).toBe(3 * CHAIN_INSTANCES);
    expect(before.leaves).toBe(3);
    const s8 = sceneReducer(s, { type: 'skipStage', to: 8 });
    expect(s8.stage).toBe(8);
    expect(counts(s8)).toEqual(before);
    expect(s8.skipped).toEqual([2, 3, 4, 5, 6, 7]);
    expect(s8.merkle.root).toBeNull();
    expect(s8.signature.stopsSeen).toBe(0);
    // step-wise skip records each skipped stage once
    let t = s;
    for (let k = 0; k < 6; k++) t = sceneReducer(t, { type: 'skipStage' });
    expect(t.stage).toBe(8);
    expect(t.skipped).toEqual([2, 3, 4, 5, 6, 7]);
    expect(counts(t)).toEqual(before);
  });

  it('cannot go backwards and cannot leave 1..8', () => {
    let s = sceneReducer(createInitialState(), { type: 'skipStage', to: 5 });
    expect(s.stage).toBe(5);
    const back = sceneReducer(s, { type: 'skipStage', to: 2 });
    expect(back.stage).toBe(5);
    expect(back.skipped).toEqual([1, 2, 3, 4]);
    const same = sceneReducer(s, { type: 'skipStage', to: 5 });
    expect(same.stage).toBe(5);
    for (const bad of [0, 9, -1, 2.5, NaN, Infinity, '7' as unknown as Stage]) {
      const r = sceneReducer(s, { type: 'skipStage', to: bad as Stage });
      expect(r.stage).toBe(5);
      expect(r.events.rejected).toBe(s.events.rejected + 1);
    }
    // past 8: skipStage with no target at 8 stays at 8
    s = sceneReducer(s, { type: 'skipStage', to: 8 });
    const over = sceneReducer(s, { type: 'skipStage' });
    expect(over.stage).toBe(8);
  });

  it('events keep being counted after a skip (skip is a label, the stream still drives counts)', async () => {
    const f = await hFixture();
    let s = sceneReducer(createInitialState(), { type: 'skipStage', to: 8 });
    for (const e of f.keygen) s = sceneReducer(s, e);
    expect(s.stage).toBe(8);
    expect(s.keygen.chainSteps).toBe(LEAVES * CHAIN_INSTANCES);
    expect(s.merkle.fusedTotal).toBe(FUSED_NODES);
    expect(bytesEqual(s.merkle.root, f.root)).toBe(true);
  });
});

/** Everything except typed arrays / byte buffers (compared separately) and the `input` object identities. */
function strip(s: SceneState): unknown {
  return {
    stage: s.stage,
    skipped: s.skipped,
    version: s.version,
    keygen: { ...s.keygen, depths: undefined, currentLeafHashes: undefined, linksPerLeaf: undefined, chainsCompletePerLeaf: undefined, leafFormed: undefined, leafHashes: undefined, lastHash: undefined },
    merkle: { ...s.merkle, fusedPerLevel: Array.from(s.merkle.fusedPerLevel), fusedFlags: undefined, fusedHashes: undefined, root: undefined },
    cloud: { width: s.cloud.width, halfLifeSec: s.cloud.halfLifeSec, channels: s.cloud.channels },
    draw: { ...s.draw, entropy: undefined, attestation: s.draw.attestation?.kind },
    signature: { ...s.signature, r: undefined, digest: undefined, stopDepths: undefined, stopHashes: undefined, authPath: undefined, authSeen: undefined },
    anchor: s.anchor,
    lineage: s.lineage,
    events: s.events,
  };
}
