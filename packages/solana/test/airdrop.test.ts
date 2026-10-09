import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { computeAllocation, type AllocationTable, type HolderSnapshot } from '@qsd/protocol';
import {
  ChainObserver,
  JournalError,
  MemoryAirdropJournal,
  computeMaxTransfersPerTx,
  buildTransferInstructions,
  recordChainEvents,
  runAirdrop,
  transactionSize,
  type AirdropJournalDoc,
  type AnchorFn,
} from '../src/index.js';
import { FakeChain } from './helpers/fakeChain.js';

function table(n: number): AllocationTable {
  const snapshot: HolderSnapshot[] = [];
  for (let i = 0; i < n; i++) {
    snapshot.push({ wallet: Keypair.generate().publicKey.toBase58(), balance: BigInt(1_000 + i * 137), firstAcquiredAt: 1_000_000 + i, heldThroughMeasurementIds: [], heldThroughQuietPeriod: i % 2 === 0 });
  }
  return computeAllocation({ snapshot, measurements: [], bornAt: 1_000_000, collapseAt: 2_000_000, quietPeriodStart: 1_500_000, totalDaughterUnits: 123_456_789n });
}

function setup(n: number, batchSize = 4) {
  const payer = Keypair.generate();
  const chain = new FakeChain(payer);
  chain.batchSize = batchSize;
  const mint = Keypair.generate().publicKey;
  chain.createMint(mint, 6);
  chain.mintTo(mint, payer.publicKey, 1_000_000_000n);
  const t = table(n);
  const observer = new ChainObserver();
  const anchors: { hash: string; kind: string }[] = [];
  const anchor: AnchorFn = async (hash, kind) => {
    anchors.push({ hash, kind });
    const s = await chain.send([]);
    return { kind, hash, txSignature: s.signature, lastValidBlockHeight: s.lastValidBlockHeight, status: 'confirmed' };
  };
  const journal = new MemoryAirdropJournal();
  const sleep = async () => undefined;
  const run = (j: MemoryAirdropJournal = journal, hooks?: Parameters<typeof runAirdrop>[0]['hooks']) =>
    runAirdrop({ table: t, mint: mint.toBase58(), sender: chain, journal: j, anchor, observer, sleep, ...(hooks ? { hooks } : {}) });
  const check = () => {
    const got = chain.receivedByWallet(mint.toBase58());
    let total = 0n;
    for (const e of t.entries) {
      expect(got.get(e.wallet) ?? 0n).toBe(e.units); // exactly once, never twice
      total += got.get(e.wallet) ?? 0n;
    }
    expect(total).toBe(t.allocatedUnits);
    expect(chain.balanceOf(payer.publicKey, mint)).toBe(1_000_000_000n - t.allocatedUnits);
  };
  return { payer, chain, mint, t, observer, anchors, journal, run, check };
}

class Crash extends Error {}

describe('runAirdrop', () => {
  it('pays every wallet exactly its units in ≤ N-sized batches and anchors the root once', async () => {
    const s = setup(10, 4);
    const rec = recordChainEvents(s.observer);
    const r = await s.run();
    s.check();
    expect(r.confirmedWallets).toBe(10);
    expect(r.confirmedUnits).toBe(s.t.allocatedUnits);
    expect(r.signatures).toHaveLength(3); // 4 + 4 + 2
    expect(s.anchors).toEqual([{ hash: s.t.merkleRoot, kind: 'allocation-root' }]);
    expect(rec.events.filter((e) => e.type === 'airdropBatchConfirmed')).toHaveLength(3);
    // idempotent: a second run sends nothing
    const before = s.chain.prepareCalls;
    const r2 = await s.run();
    expect(r2.resumed).toBe(true);
    expect(s.chain.prepareCalls).toBe(before);
    expect(s.anchors).toHaveLength(1);
    s.check();
  });

  it('crash after journal `sent` but before submit → resume re-sends that batch only', async () => {
    const s = setup(9, 4);
    let crashed = false;
    await expect(
      s.run(s.journal, {
        afterJournalSent: () => {
          if (!crashed) {
            crashed = true;
            throw new Crash('process died before submit');
          }
        },
      }),
    ).rejects.toThrow(Crash);
    const doc = (await s.journal.load())!;
    expect(Object.values(doc.entries).filter((e) => e.status === 'sent')).toHaveLength(4);
    expect(s.chain.receivedByWallet(s.mint.toBase58()).size).toBe(0);
    const r = await s.run(s.journal.reopen());
    expect(r.resumed).toBe(true);
    s.check();
    expect(s.anchors).toHaveLength(1);
  });

  it('crash after submit before journal `confirmed` → resume sees the signature landed and never re-pays', async () => {
    const s = setup(9, 4);
    let n = 0;
    await expect(
      s.run(s.journal, {
        afterSubmit: () => {
          if (++n === 2) throw new Crash('process died after submit');
        },
      }),
    ).rejects.toThrow(Crash);
    const landed = s.chain.receivedByWallet(s.mint.toBase58()).size;
    expect(landed).toBe(8); // two batches landed
    const prepares = s.chain.prepareCalls;
    const r = await s.run(s.journal.reopen());
    expect(s.chain.prepareCalls).toBe(prepares + 1); // only the last batch
    expect(r.confirmedWallets).toBe(9);
    s.check();
  });

  it('transient RPC errors and expired batches are retried under new signatures', async () => {
    const s = setup(6, 4);
    s.chain.submitBehaviours = ['transient', 'expire', 'ok', 'ok'];
    const r = await s.run();
    s.check();
    expect(r.signatures.length).toBe(4); // journalled-then-transient, expired, two confirmed
    const doc = (await s.journal.load())!;
    expect(Object.values(doc.entries).every((e) => e.status === 'confirmed')).toBe(true);
    expect(Object.values(doc.entries).some((e) => (e.lastError ?? '').includes('expired'))).toBe(true);
  });

  it('a batch that fails on-chain is not retried blindly: it throws, and the next run resumes from pending', async () => {
    const s = setup(6, 4);
    s.chain.submitBehaviours = ['fail'];
    await expect(s.run()).rejects.toThrow(/failed on-chain/);
    const doc = (await s.journal.load())!;
    expect(Object.values(doc.entries).filter((e) => e.status === 'pending')).toHaveLength(6);
    await s.run(s.journal.reopen());
    s.check();
  });

  it('connection drop right after submit (applied-then-throw) does not double-pay', async () => {
    const s = setup(5, 4);
    s.chain.submitBehaviours = ['applied-then-throw', 'ok'];
    await s.run();
    s.check();
  });

  it('refuses a journal that belongs to a different allocation', async () => {
    const s = setup(3);
    await s.run();
    const other = table(3);
    await expect(runAirdrop({ table: other, mint: s.mint.toBase58(), sender: s.chain, journal: s.journal, anchor: async () => ({ kind: 'allocation-root', hash: '', txSignature: '', lastValidBlockHeight: 0, status: 'confirmed' }) })).rejects.toThrow(JournalError);
  });

  it('journal entries round-trip through JSON with bigint-safe encoding', async () => {
    const s = setup(2);
    await s.run();
    const doc = (await s.journal.reopen().load()) as AirdropJournalDoc;
    expect(doc.version).toBe(1);
    expect(doc.rootAnchor?.txSignature).toBeTruthy();
    for (const e of s.t.entries) expect(doc.entries[e.wallet]?.units).toBe(e.units.toString());
  });
});

describe('batch sizing', () => {
  it('computes N from real transaction bytes and stays under 1232', () => {
    const payer = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const n = computeMaxTransfersPerTx(payer, mint);
    expect(n).toBeGreaterThanOrEqual(8);
    const recipients = Array.from({ length: n }, () => ({ wallet: Keypair.generate().publicKey.toBase58(), units: 1n }));
    expect(transactionSize(payer, buildTransferInstructions(payer, mint, recipients))).toBeLessThanOrEqual(1232);
    recipients.push({ wallet: Keypair.generate().publicKey.toBase58(), units: 1n });
    expect(transactionSize(payer, buildTransferInstructions(payer, mint, recipients))).toBeGreaterThan(1232);
  });
});
