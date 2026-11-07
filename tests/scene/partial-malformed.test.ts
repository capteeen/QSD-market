/**
 * Item 3: partial streams, out-of-order / duplicated / malformed events, the
 * quantum stream alone, and outcomeResolved without entropy.
 *
 * SPEC §7: "each new block emitted by Agent A's chainStep event with its real
 * hash shown on hover … Do not fake the count."
 *
 * Tests marked FAILS-BY-DESIGN document defects (see FINDINGS.md H-S*).
 */
import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  CHAIN_INSTANCES,
  LEAVES,
  LINKS,
  chainLinkHash,
  createInitialState,
  replayEvents,
  sceneReducer,
  toHex,
  type SceneEvent,
  type SceneState,
} from '@qsd/scene';
import type { CryptoEvent } from '@qsd/crypto';
import type { QuantumEvent } from '@qsd/quantum';
import { bytesEqual, hFixture } from './fixture.js';

type ChainStep = Extract<CryptoEvent, { type: 'chainStep' }>;

function litLinks(s: SceneState): number {
  let n = 0;
  for (let c = 0; c < CHAINS; c++) n += s.keygen.depths[c] ?? 0;
  return n;
}
function counts(s: SceneState) {
  return {
    stage: s.stage,
    chainSteps: s.keygen.chainSteps,
    lit: litLinks(s),
    leaves: s.keygen.leavesFormed,
    fused: s.merkle.fusedTotal,
    root: s.merkle.root ? toHex(s.merkle.root) : null,
    stops: s.signature.stopsSeen,
    auth: s.signature.authCount,
    resolved: s.draw.resolvedCount,
    phase: s.draw.phase,
    accepted: s.events.accepted,
  };
}

describe('partial keygen streams', () => {
  it('first N chainSteps light exactly N links of the leaf in view; no leaf, fuse or root appears', async () => {
    const f = await hFixture();
    const steps = f.keygen.filter((e): e is ChainStep => e.type === 'chainStep' && e.leaf === 0);
    const start = f.keygen.find((e) => e.type === 'keygenStart')!;
    for (const N of [0, 1, 2, 15, 16, 17, 100, 511, 1071, 1072]) {
      const s = replayEvents([start, ...steps.slice(0, N)]);
      expect(litLinks(s), `N=${N}`).toBe(N);
      expect(s.keygen.chainSteps).toBe(N);
      expect(s.keygen.leavesFormed).toBe(0);
      expect(s.merkle.fusedTotal).toBe(0);
      expect(s.merkle.root).toBeNull();
      expect(s.signature.stopsSeen).toBe(0);
      expect(s.stage).toBe(2);
      // every lit link has its real hash; every unlit link reports null (not zeros)
      for (let i = 0; i < CHAIN_INSTANCES; i++) {
        const c = Math.floor(i / LINKS);
        const d = i % LINKS;
        const ev = steps.slice(0, N).find((e) => e.chainIdx === c && e.depth === d);
        const h = chainLinkHash(s, c, d);
        if (ev) expect(bytesEqual(h, ev.hash), `lit ${c}/${d}`).toBe(true);
        else expect(h, `unlit ${c}/${d}`).toBeNull();
      }
    }
  });

  it('a leaf change resets the ring to dark and the panel to the new leaf', async () => {
    const f = await hFixture();
    const start = f.keygen.find((e) => e.type === 'keygenStart')!;
    const leaf0 = f.keygen.filter((e): e is ChainStep => e.type === 'chainStep' && e.leaf === 0);
    const leaf1 = f.keygen.filter((e): e is ChainStep => e.type === 'chainStep' && e.leaf === 1);
    const s = replayEvents([start, ...leaf0, ...leaf1.slice(0, 5)]);
    expect(s.keygen.currentLeaf).toBe(1);
    expect(litLinks(s)).toBe(5);
    expect(s.keygen.linksPerLeaf[0]).toBe(CHAIN_INSTANCES);
  });
});

describe('rejection of out-of-order, duplicated and malformed events (counts unchanged)', () => {
  async function base() {
    const f = await hFixture();
    const start = f.keygen.find((e) => e.type === 'keygenStart')!;
    const steps = f.keygen.filter((e): e is ChainStep => e.type === 'chainStep' && e.leaf === 0).slice(0, 100);
    const s = replayEvents([start, ...steps]);
    return { f, s, steps, start };
  }

  it('an event with an older seq is rejected', async () => {
    const { s, steps } = await base();
    const before = counts(s);
    const old = steps[10]!; // seq already consumed
    const r = sceneReducer(s, { ...old, seq: old.seq });
    expect(r.events.rejected).toBe(s.events.rejected + 1);
    expect(r.events.lastRejectedReason).toMatch(/seq/);
    expect(counts(r)).toEqual({ ...before });
  });

  it('a duplicated seq (same event twice) is rejected the second time', async () => {
    const { s, steps } = await base();
    const next = { ...steps[99]!, seq: steps[99]!.seq }; // last accepted
    const r = sceneReducer(s, next);
    expect(r.events.rejected).toBe(s.events.rejected + 1);
    expect(counts(r)).toEqual(counts(s));
  });

  it('chainIdx 67, depth 16, leaf 256, negative, non-integer and a 31-byte / 33-byte / non-Uint8Array hash are rejected', async () => {
    const { s, steps } = await base();
    const seq = steps[99]!.seq + 1;
    const good: ChainStep = { ...steps[0]!, seq, leaf: 0, chainIdx: 1, depth: 0 };
    const bads: ChainStep[] = [
      { ...good, chainIdx: 67 },
      { ...good, chainIdx: -1 },
      { ...good, chainIdx: 1.5 },
      { ...good, depth: 16 },
      { ...good, depth: -1 },
      { ...good, leaf: LEAVES },
      { ...good, hash: good.hash.slice(0, 31) },
      { ...good, hash: new Uint8Array(33) },
      { ...good, hash: Array.from(good.hash) as unknown as Uint8Array },
      { ...good, hash: toHex(good.hash) as unknown as Uint8Array },
      { ...good, seq: -1 },
      { ...good, seq: 1.5 },
      { ...good, seq: NaN },
    ];
    const before = counts(s);
    for (const b of bads) {
      const r = sceneReducer(s, b);
      expect(r.events.rejected, JSON.stringify({ ...b, hash: '…' })).toBe(s.events.rejected + 1);
      expect(counts(r)).toEqual(before);
      expect(r.events.lastSeq.crypto).toBe(s.events.lastSeq.crypto); // watermark not advanced by a rejected event
    }
    // and the well-formed one is accepted
    const ok = sceneReducer(s, good);
    expect(ok.events.rejected).toBe(s.events.rejected);
    expect(ok.keygen.chainSteps).toBe(s.keygen.chainSteps + 1);
  });

  it('malformed events of every other crypto type are rejected without moving counts', async () => {
    const f = await hFixture();
    const s = replayEvents(f.keygen);
    const seq = s.events.lastSeq.crypto + 1;
    const before = counts(s);
    const h32 = new Uint8Array(32);
    const bads: SceneEvent[] = [
      { type: 'leafFormed', seq, leaf: 256, hash: h32 },
      { type: 'leafFormed', seq, leaf: 0, hash: h32.slice(1) },
      { type: 'treeLevelFused', seq, level: 8, index: 0, left: h32, right: h32, parent: h32 },
      { type: 'treeLevelFused', seq, level: 0, index: 128, left: h32, right: h32, parent: h32 },
      { type: 'treeLevelFused', seq, level: 7, index: 1, left: h32, right: h32, parent: h32 },
      { type: 'treeLevelFused', seq, level: 0, index: 0, left: h32, right: h32, parent: h32.slice(1) },
      { type: 'rootReady', seq, root: h32.slice(1) },
      { type: 'signChainStop', seq, chainIdx: 67, depth: 0, hash: h32 },
      { type: 'signChainStop', seq, chainIdx: 0, depth: 16, hash: h32 },
      { type: 'authPathNode', seq, level: 8, hash: h32 },
      { type: 'signStart', seq, index: 256, r: h32, digest: h32 },
      { type: 'anchored', seq: 0, txSignature: '' } as SceneEvent,
      { type: 'anchored', seq: 0 } as unknown as SceneEvent,
      { type: 'superposition', input: { supplyMin: 1, supplyMax: 2, halfLifeSec: 1, decayChannels: [] } as never },
      { type: 'lineage', input: { generation: 0 } as never },
      { type: 'bogus' } as unknown as SceneEvent,
    ];
    for (const b of bads) {
      const r = sceneReducer(s, b);
      expect(r.events.rejected, b.type).toBe(s.events.rejected + 1);
      expect(counts(r)).toEqual(before);
    }
  });

  it('duplicate (level,index) treeLevelFused and duplicate leafFormed with fresh seq do not inflate counts', async () => {
    const f = await hFixture();
    const s = replayEvents(f.keygen);
    const seq = s.events.lastSeq.crypto + 1;
    const fused = f.keygen.find((e) => e.type === 'treeLevelFused')!;
    const leaf = f.keygen.find((e) => e.type === 'leafFormed')!;
    const r1 = sceneReducer(s, { ...fused, seq });
    const r2 = sceneReducer(r1, { ...leaf, seq: seq + 1 });
    expect(r2.merkle.fusedTotal).toBe(255);
    expect(Array.from(r2.merkle.fusedPerLevel)).toEqual([128, 64, 32, 16, 8, 4, 2, 1]);
    expect(r2.keygen.leavesFormed).toBe(256);
  });

  /**
   * FAILS-BY-DESIGN (H-S2). The lit count per chain is "number of chainStep
   * events seen for that chain", not "which depths arrived". A duplicate
   * chainStep (same leaf/chain/depth, fresh seq) lights one more block than
   * exists, and hover on that block returns 32 zero bytes as if it were a
   * real hash. README §2 claims "link `depth` of chain `chainIdx` lights".
   */
  it('[H-S2] a duplicated chainStep with a fresh seq must not light a block that was never computed', async () => {
    const f = await hFixture();
    const start = f.keygen.find((e) => e.type === 'keygenStart')!;
    const steps = f.keygen.filter((e): e is ChainStep => e.type === 'chainStep' && e.leaf === 0);
    const only = steps.filter((e) => e.chainIdx === 3 && e.depth === 0)[0]!;
    const s = replayEvents([start, only, { ...only, seq: only.seq + 1 }]); // the same real event delivered twice
    expect(s.keygen.depths[3], 'one distinct link was computed').toBe(1);
    expect(litLinks(s)).toBe(1);
    expect(chainLinkHash(s, 3, 1), 'link (3,1) was never computed → must be null, not zeros').toBeNull();
  });

  /** FAILS-BY-DESIGN (H-S2). The block that lights must be the one the event names. */
  it('[H-S2] chainStep{depth:15} lights link 15, not link 0', async () => {
    const f = await hFixture();
    const start = f.keygen.find((e) => e.type === 'keygenStart')!;
    const tip = f.keygen.find((e): e is ChainStep => e.type === 'chainStep' && e.leaf === 0 && e.chainIdx === 0 && e.depth === 15)!;
    const s = replayEvents([start, tip]);
    expect(bytesEqual(chainLinkHash(s, 0, 15), tip.hash), 'the computed link is retrievable at its depth').toBe(true);
    expect(chainLinkHash(s, 0, 0), 'link 0 was never computed').toBeNull();
  });

  /**
   * FAILS-BY-DESIGN (H-S3). On a leaf change `depths` is zeroed but
   * `currentLeafHashes` is not. With the first chainStep of the new leaf at a
   * depth > 0, hover on the (now "lit") lower links shows the PREVIOUS leaf's
   * hashes labelled as the new leaf's.
   */
  it('[H-S3] after a leaf change no stale hash of the previous leaf is served for the new leaf', async () => {
    const f = await hFixture();
    const start = f.keygen.find((e) => e.type === 'keygenStart')!;
    const leaf0 = f.keygen.filter((e): e is ChainStep => e.type === 'chainStep' && e.leaf === 0);
    const leaf1d5 = f.keygen.find((e): e is ChainStep => e.type === 'chainStep' && e.leaf === 1 && e.chainIdx === 0 && e.depth === 5)!;
    const s = replayEvents([start, ...leaf0, leaf1d5]);
    expect(s.keygen.currentLeaf).toBe(1);
    const h = chainLinkHash(s, 0, 0);
    const stale = leaf0.find((e) => e.chainIdx === 0 && e.depth === 0)!.hash;
    expect(h === null || !bytesEqual(h, stale), 'leaf 0 chain 0 depth 0 hash is being shown as leaf 1 chain 0 depth 0').toBe(true);
  });
});

describe('quantum stream alone', () => {
  it('reaches stage 5 only on entropyRequested when fed in order; nothing else moves', async () => {
    const f = await hFixture();
    let s = createInitialState();
    for (const q of f.quantum) {
      const before = s.stage;
      s = sceneReducer(s, q);
      if (q.type === 'entropyRequested') expect([before, s.stage]).toEqual([1, 5]);
      else expect(s.stage).toBe(5);
    }
    expect(s.draw.phase).toBe('resolved');
    expect(s.keygen.chainSteps).toBe(0);
    expect(s.merkle.root).toBeNull();
    expect(s.signature.stopsSeen).toBe(0);
    expect(s.skipped).toEqual([]); // the stage jump is NOT recorded as a skip
  });

  /**
   * FAILS-BY-DESIGN (H-S1). README §1 table: stage 5 is entered on
   * `entropyRequested`. In fact every quantum event enters stage 5, and
   * `outcomeResolved` alone — with no entropyRequested / entropyArrived —
   * is accepted: phase → 'resolved', resolvedCount++ (which is exactly the
   * trigger of the collapse flash, the collapsed point and the collapse tone),
   * with entropy === null. A stray outcomeResolved renders a collapse that
   * no entropy produced.
   */
  it('[H-S1] outcomeResolved without entropyArrived must not produce a collapse (resolvedCount) with no entropy', async () => {
    const f = await hFixture();
    const resolved = f.quantum.find((q): q is Extract<QuantumEvent, { type: 'outcomeResolved' }> => q.type === 'outcomeResolved')!;
    const s = sceneReducer(createInitialState(), { ...resolved, seq: 0 });
    // document the actual behaviour in the assertion message
    const actual = { stage: s.stage, phase: s.draw.phase, resolvedCount: s.draw.resolvedCount, entropy: s.draw.entropy, rejected: s.events.rejected };
    expect(actual.resolvedCount, `outcomeResolved with no entropy produced a collapse: ${JSON.stringify({ ...actual, entropy: actual.entropy === null ? null : 'bytes' })}`).toBe(0);
  });

  it('[H-S1] entropyArrived / commitmentComputed alone must not enter stage 5 (README: stage 5 enters on entropyRequested)', async () => {
    const f = await hFixture();
    const arrived = f.quantum.find((q) => q.type === 'entropyArrived')!;
    const committed = f.quantum.find((q) => q.type === 'commitmentComputed')!;
    expect(sceneReducer(createInitialState(), { ...arrived, seq: 0 }).stage).toBe(1);
    expect(sceneReducer(createInitialState(), { ...committed, seq: 0 }).stage).toBe(1);
  });

  it('a second draw (fresh observer, seq restarts) is accepted; a replayed stale entropyRequested after resolution resets the draw (documented watermark reset)', async () => {
    const f = await hFixture();
    let s = replayEvents(f.quantum);
    expect(s.draw.resolvedCount).toBe(1);
    const again = replayEvents(f.quantum, undefined); // fresh seqs 0..3 against watermark 3
    void again;
    s = sceneReducer(s, f.quantum[0]!); // entropyRequested seq 0 again
    expect(s.draw.phase).toBe('requested');
    expect(s.draw.entropy).toBeNull();
    expect(s.draw.resolvedCount).toBe(1);
  });
});
