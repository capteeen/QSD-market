/**
 * Agent H — airdrop crash/resume with Agent H's own ledger, fault-injecting
 * sender and journal. Spec §9 l.386-388 ("Idempotent: a crashed airdrop
 * resumes without double-paying. Agent H tests this.") and §10 l.416.
 *
 * Invariant after every scenario: Σ transferred == table.allocatedUnits
 * exactly, every wallet credited exactly once with exactly its units, the
 * treasury debited exactly allocatedUnits, the root anchored exactly once.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Keypair } from '@solana/web3.js';
import { computeAllocation, type AllocationTable, type HolderSnapshot } from '@qsd/protocol';
import { ChainObserver, ChainUnavailableError, JournalError, anchorWith, runAirdrop, type AirdropJournalDoc, type JournalStore } from '@qsd/solana';
import { Crash, Ledger, type Fault } from './ledger.js';

/** Agent H's journal: a string (what a file would hold); `reopen()` is a new process over the same bytes. */
class HJournal<T> implements JournalStore<T> {
  constructor(private readonly cell: { text?: string } = {}) {}
  async load(): Promise<T | undefined> {
    return this.cell.text === undefined ? undefined : (JSON.parse(this.cell.text) as T);
  }
  async save(doc: T): Promise<void> {
    this.cell.text = JSON.stringify(doc);
  }
  reopen(): HJournal<T> {
    return new HJournal<T>(this.cell);
  }
  peek(): T | undefined {
    return this.cell.text === undefined ? undefined : (JSON.parse(this.cell.text) as T);
  }
}

const noSleep = async () => undefined;

function setup(nWallets = 8, batchSize = 3) {
  const payer = Keypair.generate();
  const ledger = new Ledger(payer);
  ledger.batchSize = batchSize;
  const mint = Keypair.generate().publicKey;
  ledger.createMint(mint, 6);
  ledger.mintTo(mint, payer.publicKey, 10n ** 15n);
  const wallets = Array.from({ length: nWallets }, () => Keypair.generate().publicKey.toBase58());
  const snapshot: HolderSnapshot[] = wallets.map((w, i) => ({
    wallet: w,
    balance: BigInt(1 + ((i * 7919) % 97)) * 1000n,
    firstAcquiredAt: 1000 + i,
    heldThroughMeasurementIds: [],
    heldThroughQuietPeriod: i % 2 === 0,
  }));
  const table = computeAllocation({ snapshot, measurements: [], bornAt: 1000, collapseAt: 2000, quietPeriodStart: 1500, totalDaughterUnits: 123_456_789_012n });
  const observer = new ChainObserver();
  const anchor = anchorWith({ sender: ledger, observer });
  const journal = new HJournal<AirdropJournalDoc>();
  const treasuryBefore = ledger.balanceOf(payer.publicKey, mint);
  return { payer, ledger, mint: mint.toBase58(), table, observer, anchor, journal, treasuryBefore };
}

type Env = ReturnType<typeof setup>;

function assertExact(env: Env, table: AllocationTable = env.table) {
  const { ledger, mint, payer, treasuryBefore } = env;
  let total = 0n;
  for (const e of table.entries) {
    const got = ledger.transfersTo(e.wallet, mint);
    expect(got.units, `units of ${e.wallet}`).toBe(e.units);
    expect(got.count, `transfer count of ${e.wallet}`).toBe(e.units > 0n ? 1 : 0);
    expect(ledger.balanceOf(e.wallet, mint)).toBe(e.units);
    total += got.units;
  }
  expect(total).toBe(table.allocatedUnits);
  expect(treasuryBefore - ledger.balanceOf(payer.publicKey, mint)).toBe(table.allocatedUnits);
  expect(ledger.memos.filter((m) => m.memo === `qsd:v1:allocation-root:${table.merkleRoot}`).length).toBe(1);
}

const run = (env: Env, journal: HJournal<AirdropJournalDoc>, hooks?: Parameters<typeof runAirdrop>[0]['hooks']) =>
  runAirdrop({ table: env.table, mint: env.mint, sender: env.ledger, journal, anchor: env.anchor, observer: env.observer, sleep: noSleep, maxAttemptsPerBatch: 4, ...(hooks ? { hooks } : {}) });

/** Run, and on a simulated crash "restart" with a reopened journal until it finishes. Returns the number of restarts. */
async function runWithRestarts(env: Env, hooksForFirstRun?: Parameters<typeof runAirdrop>[0]['hooks']): Promise<{ restarts: number; report: Awaited<ReturnType<typeof runAirdrop>> }> {
  let journal = env.journal;
  let restarts = 0;
  let hooks = hooksForFirstRun;
  for (;;) {
    try {
      const report = await run(env, journal, hooks);
      return { restarts, report };
    } catch (e) {
      // A Crash is the process dying; a ChainUnavailableError is the worker giving up after its retry
      // budget (e.g. four expired/rejected submits in a row) — the operator re-runs it later. Both resume.
      if (!(e instanceof Crash) && !(e instanceof ChainUnavailableError)) throw e;
      restarts++;
      if (restarts > 20) throw new Error('too many restarts');
      journal = journal.reopen();
      hooks = undefined;
    }
  }
}

describe('airdrop crash / resume (spec §9 l.386-388, §10 l.416)', () => {
  it('no faults: every wallet paid exactly once, zero-unit rows are not transfers, re-running is a no-op', async () => {
    const env = setup(8, 3);
    const r = await run(env, env.journal);
    assertExact(env);
    expect(r.confirmedUnits).toBe(env.table.allocatedUnits);
    expect(r.resumed).toBe(false);
    const prepares = env.ledger.prepareCalls;
    const again = await run(env, env.journal.reopen());
    expect(again.resumed).toBe(true);
    expect(env.ledger.prepareCalls).toBe(prepares);
    expect(env.ledger.transferSubmits).toBe(prepares);
    assertExact(env);
  });

  it('crash after journal-sent, before submit (hook): resume waits out the blockhash, sees "expired", re-sends once', async () => {
    const env = setup(8, 3);
    let armed = true;
    const { restarts } = await runWithRestarts(env, {
      afterJournalSent: () => {
        if (armed) {
          armed = false;
          throw new Crash('after journal sent, before submit');
        }
      },
    });
    expect(restarts).toBe(1);
    assertExact(env);
    const doc = env.journal.peek()!;
    expect(doc.signatures.length).toBe(env.ledger.transferSubmits + 1); // one journalled signature was never submitted
  });

  it('resume after the chain reports "expired" directly for a journalled-but-unsubmitted batch (block height already past)', async () => {
    const env = setup(5, 2);
    let armed = true;
    try {
      await run(env, env.journal, {
        afterJournalSent: () => {
          if (armed) {
            armed = false;
            throw new Crash('x');
          }
        },
      });
      throw new Error('expected crash');
    } catch (e) {
      expect(e).toBeInstanceOf(Crash);
    }
    env.ledger.advanceBlocks(10_000);
    const r = await run(env, env.journal.reopen());
    expect(r.resumed).toBe(true);
    assertExact(env);
  });

  it('crash after submit, before the confirmation is journalled (hook): resume finds the transaction confirmed and does NOT re-send', async () => {
    const env = setup(8, 3);
    let armed = true;
    const { restarts } = await runWithRestarts(env, {
      afterSubmit: () => {
        if (armed) {
          armed = false;
          throw new Crash('after submit, before confirm');
        }
      },
    });
    expect(restarts).toBe(1);
    assertExact(env);
    expect(env.ledger.transferSubmits).toBe(3);
  });

  it('submit() throws a NON-transient error although the transaction landed: the package checks the status instead of trusting the error, and does not re-send', async () => {
    const env = setup(8, 3);
    env.ledger.transferFaults = ['landed-then-crash'];
    const { restarts } = await runWithRestarts(env);
    expect(restarts).toBe(0);
    assertExact(env);
    expect(env.ledger.transferSubmits).toBe(3);
  });

  it('mid-batch crash while waiting for confirmation of batch 2 of 3 (batch landed): resume confirms it and sends only batch 3', async () => {
    const env = setup(8, 3);
    env.ledger.transferFaults = ['ok', 'confirm-crash'];
    const { restarts } = await runWithRestarts(env);
    expect(restarts).toBe(1);
    assertExact(env);
    expect(env.ledger.transferSubmits).toBe(3);
  });

  it('a dropped transaction (never lands) expires and is re-sent in-process; a rejected submit is retried; the ledger total stays exact', async () => {
    const env = setup(8, 3);
    env.ledger.transferFaults = ['dropped', 'reject-transient', 'ok', 'dropped', 'dropped', 'ok', 'ok'];
    await runWithRestarts(env);
    assertExact(env);
  });

  it('an on-chain failure is not blindly retried: the run throws; a later resume re-sends the failed batch only', async () => {
    const env = setup(8, 3);
    env.ledger.transferFaults = ['ok', 'fail'];
    await expect(run(env, env.journal)).rejects.toBeInstanceOf(ChainUnavailableError);
    const paidAfterFailure = env.ledger.landedTransfers.length;
    expect(paidAfterFailure).toBe(3);
    const r = await run(env, env.journal.reopen());
    expect(r.resumed).toBe(true);
    assertExact(env);
  });

  it('a journal from a different table (other root / other mint / edited units) is refused', async () => {
    const env = setup(4, 2);
    await run(env, env.journal);
    const other = setup(4, 2);
    await expect(runAirdrop({ table: other.table, mint: other.mint, sender: other.ledger, journal: env.journal.reopen(), anchor: other.anchor, sleep: noSleep })).rejects.toBeInstanceOf(JournalError);
    await expect(runAirdrop({ table: env.table, mint: other.mint, sender: env.ledger, journal: env.journal.reopen(), anchor: env.anchor, sleep: noSleep })).rejects.toBeInstanceOf(JournalError);
    // same root and mint, but a journal whose units were edited
    const doc = env.journal.peek()!;
    const w = env.table.entries.find((e) => e.units > 0n)!.wallet;
    doc.entries[w]!.units = (BigInt(doc.entries[w]!.units) + 1n).toString();
    const edited = new HJournal<AirdropJournalDoc>({ text: JSON.stringify(doc) });
    await expect(runAirdrop({ table: env.table, mint: env.mint, sender: env.ledger, journal: edited, anchor: env.anchor, sleep: noSleep })).rejects.toBeInstanceOf(JournalError);
    // nothing extra moved
    assertExact(env);
  });

  it('property: random sequences of recoverable faults and crashes never double-pay and always finish exact', async () => {
    const safe: Fault[] = ['ok', 'landed-then-crash', 'reject-transient', 'dropped', 'confirm-crash', 'ok', 'ok'];
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...safe), { minLength: 0, maxLength: 12 }), fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 4 }), async (faults, n, batch) => {
        const env = setup(n, batch);
        env.ledger.transferFaults = [...faults];
        await runWithRestarts(env);
        assertExact(env);
      }),
      { numRuns: 40 },
    );
  }, 120_000);

  it('FINDING H-S1a (BLOCKING): submit() throws a transient error AFTER the RPC accepted the transaction (status still "pending"); airdrop.ts resets the entries to pending while the signature is in flight, the retry builds a new transaction, both land — paid twice', async () => {
    const env = setup(3, 3);
    env.ledger.transferFaults = ['landed-then-transient'];
    await runWithRestarts(env);
    // Both the first transaction (which landed) and the retry landed.
    assertExact(env); // fails: each wallet credited twice
  });

  it('FINDING H-S1b (BLOCKING): confirm() times out (transient) while the batch is still in flight; withRetry re-prepares the SAME records with a new blockhash and the first transaction lands later — paid twice', async () => {
    const env = setup(3, 3);
    env.ledger.transferFaults = ['confirm-transient-later'];
    await runWithRestarts(env);
    assertExact(env); // fails: each wallet credited twice
  });

  it('FINDING H-S3 (HIGH): two workers resuming the same journal concurrently (no lease / CAS on the journal) both send the pending batches — paid twice', async () => {
    const env = setup(6, 3);
    let armed = true;
    try {
      await run(env, env.journal, {
        afterJournalSent: () => {
          if (armed) {
            armed = false;
            throw new Crash('first worker died');
          }
        },
      });
    } catch (e) {
      expect(e).toBeInstanceOf(Crash);
    }
    await Promise.all([run(env, env.journal.reopen()), run(env, env.journal.reopen())]);
    assertExact(env); // fails: wallets credited twice
  });
});
