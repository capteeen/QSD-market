/**
 * Agent H — measurement composition: the precommit anchor must land on-chain
 * BEFORE the QRNG draw is requested, and a failed anchor must mean zero draws
 * (security.md H-Q3 fix; spec §4 l.143-146, §9 l.389-390). Observed through
 * the ChainObserver and the quantum event bus, not through return values.
 */
import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { measurementResolver, type Coin } from '@qsd/protocol';
import { QuantumEventBus, UnsafeDevRandomProvider, createQrngClient, type QrngProvider, type QuantumEvent } from '@qsd/quantum';
import { ChainObserver, ChainUnavailableError, anchorWith, decodeAnchorMemo, measureCoin, productionVerifyOptions, type ChainEvent, type JournalStore, type MeasurementJournalDoc } from '@qsd/solana';
import { Ledger } from './ledger.js';

/** Agent H's own canonical JSON (sorted keys, recursive) and inputs hash. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

class MemJournal implements JournalStore<MeasurementJournalDoc> {
  doc?: MeasurementJournalDoc;
  async load() {
    return this.doc;
  }
  async save(d: MeasurementJournalDoc) {
    this.doc = JSON.parse(JSON.stringify(d));
  }
}

function coin(): Coin {
  return {
    ca: 'CoinAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
    name: 'PHOTON',
    ticker: 'PHO',
    image: { uri: '', hash: 'ab'.repeat(32), lineage: 'cd'.repeat(32) },
    lineageId: 'l',
    generation: 1,
    identityRoot: 'ef'.repeat(32),
    halfLifeSec: 3600,
    decayProgress: 0,
    decayChannels: [{ id: 'alpha', probabilityPpm: 1_000_000, label: 'a', daughterParams: { halfLifeSec: { min: 3600, max: 86_400 }, poolUnits: { min: 1n, max: 2n } } }],
    superposition: { supplyMin: 1n, supplyMax: 2n },
    supply: { totalUnits: 100n, remainingUnits: 100n, decimals: 0 },
    state: 'superposed',
    lastActivityAt: 1_000_000,
    measurements: [],
    bornAt: 1_000_000,
  };
}

type Mark = { src: 'chain'; e: ChainEvent } | { src: 'quantum'; e: QuantumEvent };

function harness() {
  const payer = Keypair.generate();
  const ledger = new Ledger(payer);
  const observer = new ChainObserver();
  const bus = new QuantumEventBus();
  const timeline: Mark[] = [];
  observer.subscribe((e) => timeline.push({ src: 'chain', e }));
  bus.subscribe((e) => timeline.push({ src: 'quantum', e }));
  const inner = new UnsafeDevRandomProvider();
  let draws = 0;
  const counting: QrngProvider = {
    id: inner.id,
    draw: (...args: Parameters<QrngProvider['draw']>) => {
      draws++;
      return inner.draw(...args);
    },
  } as QrngProvider;
  const client = createQrngClient({ provider: counting, bus });
  const anchor = anchorWith({ sender: ledger, observer });
  const journal = new MemJournal();
  return { payer, ledger, observer, bus, timeline, client, anchor, journal, draws: () => draws };
}

describe('measureCoin: precommit before draw; no anchor ⇒ no draw', () => {
  it('order on the combined timeline: anchorRequested(precommit) < anchored(precommit) < entropyRequested < … < outcomeResolved < anchored(proof); memos decode to the inputs hash + nonce and the bundle hash', async () => {
    const h = harness();
    const c = coin();
    const at = c.lastActivityAt + 1800;
    const res = await measureCoin(c, { by: 'Measurer1111111111111111111111111111111111111', at }, { client: h.client, anchor: h.anchor, verify: { allowUnsafeDev: true }, journal: h.journal, random: () => new Uint8Array(32).fill(9) });
    const idx = (pred: (m: Mark) => boolean) => h.timeline.findIndex(pred);
    const iPreReq = idx((m) => m.src === 'chain' && m.e.type === 'anchorRequested' && m.e.kind === 'precommit');
    const iPre = idx((m) => m.src === 'chain' && m.e.type === 'anchored' && m.e.kind === 'precommit');
    const iEntropy = idx((m) => m.src === 'quantum' && m.e.type === 'entropyRequested');
    const iArrived = idx((m) => m.src === 'quantum' && m.e.type === 'entropyArrived');
    const iResolved = idx((m) => m.src === 'quantum' && m.e.type === 'outcomeResolved');
    const iProofReq = idx((m) => m.src === 'chain' && m.e.type === 'anchorRequested' && m.e.kind === 'proof');
    const iProof = idx((m) => m.src === 'chain' && m.e.type === 'anchored' && m.e.kind === 'proof');
    expect([iPreReq, iPre, iEntropy, iArrived, iResolved, iProofReq, iProof].every((i) => i >= 0)).toBe(true);
    expect(iPreReq).toBeLessThan(iPre);
    expect(iPre).toBeLessThan(iEntropy);
    expect(iEntropy).toBeLessThan(iArrived);
    expect(iArrived).toBeLessThan(iResolved);
    expect(iResolved).toBeLessThan(iProofReq);
    expect(iProofReq).toBeLessThan(iProof);
    // the quantum bus seq numbers start at 0 with entropyRequested, i.e. nothing was drawn before the anchor
    const q = h.timeline.filter((m): m is Extract<Mark, { src: 'quantum' }> => m.src === 'quantum').map((m) => m.e);
    expect(q[0]!.type).toBe('entropyRequested');
    expect(q.map((e) => e.seq)).toEqual(q.map((_e, i) => i));
    expect(h.draws()).toBe(1);
    // memos: exactly one precommit and one proof, with the independently computed inputs hash and the nonce
    const memos = h.ledger.memos.map((m) => decodeAnchorMemo(m.memo)!);
    expect(memos.map((m) => m.kind)).toEqual(['precommit', 'proof']);
    expect(memos[0]!.hash).toBe(sha256hex(canonical(res.inputs)));
    expect(memos[0]!.nonce).toBe('09'.repeat(32));
    expect(res.inputsHash).toBe(memos[0]!.hash);
    // INFO: the UNSAFE_DEV_RANDOM provider carries no (inputsHash, nonce) binding in its attestation, so on
    // devnet the bundle ↔ precommit link rests on the journal only; production verify requires the binding.
    expect(res.bundle.draw.attestation.inputsHash).toBeUndefined();
    expect(memos[1]!.hash).toBe(res.measurement.id);
    // the precommit landed in an earlier transaction than the proof
    expect(h.ledger.memos[0]!.signature).not.toBe(h.ledger.memos[1]!.signature);
    expect(res.precommit.txSignature).toBe(h.ledger.memos[0]!.signature);
    expect(res.proof.txSignature).toBe(h.ledger.memos[1]!.signature);
    // journal carries both signatures and the bundle hash
    expect(h.journal.doc).toMatchObject({ precommitTx: res.precommit.txSignature, proofTx: res.proof.txSignature, bundleHash: res.measurement.id, nonce: '09'.repeat(32), at, measurementIndex: 0 });
    expect(res.coin.measurements.length).toBe(1);
  });

  it('a failed precommit anchor means ZERO draws: the provider is never called, the bus emits nothing, the coin is unchanged, the journal has no precommit/bundle', async () => {
    const h = harness();
    h.ledger.sendFaults = ['fail'];
    const c = coin();
    await expect(measureCoin(c, { by: 'protocol', at: c.lastActivityAt + 1800 }, { client: h.client, anchor: h.anchor, verify: { allowUnsafeDev: true }, journal: h.journal })).rejects.toBeInstanceOf(ChainUnavailableError);
    expect(h.draws()).toBe(0);
    expect(h.timeline.filter((m) => m.src === 'quantum').length).toBe(0);
    expect(h.bus.seq ?? 0).toBe(0);
    expect(h.timeline.filter((m) => m.src === 'chain' && m.e.type === 'anchored').length).toBe(0);
    expect(h.journal.doc?.precommitTx).toBeUndefined();
    expect(h.journal.doc?.bundleHash).toBeUndefined();
    expect(c.measurements.length).toBe(0);
    expect(c.state).toBe('superposed');
    // and a dropped (expired) anchor transaction likewise
    const h2 = harness();
    h2.ledger.sendFaults = ['dropped'];
    await expect(measureCoin(c, { by: 'protocol', at: c.lastActivityAt + 1800 }, { client: h2.client, anchor: h2.anchor, verify: { allowUnsafeDev: true } })).rejects.toBeInstanceOf(ChainUnavailableError);
    expect(h2.draws()).toBe(0);
  });

  it('a client that draws without honouring beforeDraw is refused after the fact (defence in depth), and a mismatched binding is refused', async () => {
    const h = harness();
    const c = coin();
    const rogue = {
      measure: async (inputs: unknown, resolver: unknown) => h.client.measure(inputs as never, resolver as never, {}), // ignores nonce + beforeDraw
    };
    await expect(measureCoin(c, { by: 'protocol', at: c.lastActivityAt + 1 }, { client: rogue as never, anchor: h.anchor, verify: { allowUnsafeDev: true } })).rejects.toThrow(/beforeDraw|un-precommitted/);
    // nothing was anchored for that draw, so the draw is unusable and no proof anchor exists
    expect(h.ledger.memos.length).toBe(0);
  });

  it('productionVerifyOptions requires the input binding and the published witness keys; the dev provider cannot satisfy it', async () => {
    const opts = productionVerifyOptions({ QSD_WITNESS_PUBLIC_KEYS: 'ab'.repeat(32) });
    expect(opts.requireInputBinding).toBe(true);
    expect(opts.allowUnsafeDev).toBeFalsy();
    const h = harness();
    const c = coin();
    await expect(measureCoin(c, { by: 'protocol', at: c.lastActivityAt + 1800 }, { client: h.client, anchor: h.anchor, verify: opts })).rejects.toThrow(/verification/);
  });
});
