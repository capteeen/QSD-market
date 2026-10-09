/**
 * Agent H — executeCollapse crashed between every pair of steps and inside
 * steps, resumed on Agent H's own ledger. Spec §9 l.380-381 ("daughter
 * launch is fully automatic"), l.386-388 (idempotent airdrop), §10 l.416.
 * The daughter must be launched exactly once; every reward, burn and
 * transfer must happen exactly once.
 */
import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { applyMeasurement, measurementInputs, measurementResolver, collapseRewards, type Coin, type HolderSnapshot } from '@qsd/protocol';
import { UnsafeDevRandomProvider, createQrngClient } from '@qsd/quantum';
import {
  COLLAPSE_STEPS,
  ChainObserver,
  IdentityReserve,
  KeyVault,
  MemoryKeyStore,
  MemoryReserveBackend,
  anchorWith,
  assertCollapseDeps,
  executeCollapse,
  type AirdropJournalDoc,
  type ChainEvent,
  type CollapseDeps,
  type CollapseJournalDoc,
  type CollapseStep,
  type HoldingHistory,
  type JournalStore,
} from '@qsd/solana';
import { Crash, Ledger } from './ledger.js';

class HJournal<T> implements JournalStore<T> {
  constructor(private readonly cell: { text?: string } = {}) {}
  async load(): Promise<T | undefined> {
    return this.cell.text === undefined ? undefined : (JSON.parse(this.cell.text, (_k, v) => (v && typeof v === 'object' && '$bigint' in v ? BigInt(v.$bigint) : v)) as T);
  }
  async save(doc: T): Promise<void> {
    this.cell.text = JSON.stringify(doc, (_k, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v));
  }
  reopen(): HJournal<T> {
    return new HJournal<T>(this.cell);
  }
  peek(): T | undefined {
    return this.cell.text === undefined ? undefined : (JSON.parse(this.cell.text) as T);
  }
}

const KEK = new Uint8Array(createHash('sha256').update('agent-h-test-kek').digest());
const noSleep = async () => undefined;

async function collapsedMother(ca: string, measurer: string, supply: { total: bigint; remaining: bigint }): Promise<Coin> {
  const base: Coin = {
    ca,
    name: 'PHOTON',
    ticker: 'PHO',
    image: { uri: 'ipfs://x', hash: 'ab'.repeat(32), lineage: 'cd'.repeat(32) },
    lineageId: 'lineage-1',
    generation: 1,
    identityRoot: 'ef'.repeat(32),
    halfLifeSec: 3600,
    decayProgress: 0,
    decayChannels: [
      { id: 'alpha', probabilityPpm: 700_000, label: 'a', daughterParams: { halfLifeSec: { min: 3600, max: 86_400 }, poolUnits: { min: 100_000n, max: 300_000n } } },
      { id: 'beta', probabilityPpm: 300_000, label: 'b', daughterParams: { halfLifeSec: { min: 7200, max: 172_800 }, poolUnits: { min: 50_000n, max: 400_000n } } },
    ],
    superposition: { supplyMin: 100_000n, supplyMax: 300_000n },
    supply: { totalUnits: supply.total, remainingUnits: supply.remaining, decimals: 6 },
    state: 'superposed',
    lastActivityAt: 1_000_000,
    measurements: [],
    bornAt: 1_000_000,
  };
  const client = createQrngClient({ provider: new UnsafeDevRandomProvider() });
  let coin = base;
  const at = base.bornAt + 400_000; // decayProgress saturated: collapse or tunnel only
  for (let i = 0; i < 50; i++) {
    const { bundle } = await client.measure(measurementInputs(coin, at + i), measurementResolver);
    const r = applyMeasurement(coin, bundle, { at: at + i, by: measurer, verify: { allowUnsafeDev: true } });
    coin = r.coin;
    if (coin.state === 'collapsed') return coin;
    coin = { ...coin, lastActivityAt: base.lastActivityAt }; // undo the tunnel reset so the next draw saturates again
  }
  throw new Error('no collapse in 50 draws');
}

interface World {
  ledger: Ledger;
  payer: Keypair;
  mother: Coin;
  motherCa: string;
  holders: { wallet: string; balance: bigint }[];
  measurer: string;
  observer: ChainObserver;
  events: ChainEvent[];
  deps: CollapseDeps;
  journal: HJournal<CollapseJournalDoc>;
  airdropJournal: HJournal<AirdropJournalDoc>;
  treasuryMotherBefore: bigint;
}

async function world(): Promise<World> {
  const payer = Keypair.generate();
  const ledger = new Ledger(payer);
  ledger.batchSize = 2;
  const motherMint = Keypair.generate().publicKey;
  ledger.createMint(motherMint, 6);
  const holders = Array.from({ length: 5 }, (_, i) => ({ wallet: Keypair.generate().publicKey.toBase58(), balance: BigInt(10 + i * 7) * 1_000_000n }));
  for (const h of holders) ledger.mintTo(motherMint, new PublicKey(h.wallet), h.balance);
  ledger.mintTo(motherMint, payer.publicKey, 200_000_000n); // treasury: covers the 1 % collapse burn
  const total = holders.reduce((a, h) => a + h.balance, 0n) + 200_000_000n;
  const measurer = Keypair.generate().publicKey.toBase58();
  const mother = await collapsedMother(motherMint.toBase58(), measurer, { total, remaining: total });
  const observer = new ChainObserver();
  const events: ChainEvent[] = [];
  observer.subscribe((e) => events.push(e));
  const vault = new KeyVault(KEK, new MemoryKeyStore());
  const reserve = new IdentityReserve(vault, new MemoryReserveBackend());
  const history: HoldingHistory = {
    async factsFor(wallet, _balance, ctx) {
      const i = holders.findIndex((h) => h.wallet === wallet);
      return { firstAcquiredAt: ctx.bornAt + i * 10_000, heldThroughMeasurementIds: [], heldThroughQuietPeriod: i % 2 === 0 };
    },
  };
  const journal = new HJournal<CollapseJournalDoc>();
  const airdropJournal = new HJournal<AirdropJournalDoc>();
  const deps: CollapseDeps = {
    cluster: 'devnet',
    sender: ledger,
    reader: ledger,
    transferSender: ledger,
    anchor: anchorWith({ sender: ledger, observer }),
    snapshot: { sources: [ledger], history },
    launch: { pumpPortalApiUrl: 'https://pumpportal.invalid/api', creator: payer, getMintRentLamports: async () => 1_461_600 },
    vault,
    reserve,
    journal,
    airdropJournal,
    imageBytes: async () => new Uint8Array([1, 2, 3]),
    devnetSupply: { units: 10_000_000n, decimals: 6 },
    observer,
    sleep: noSleep,
  };
  assertCollapseDeps(deps);
  return { ledger, payer, mother, motherCa: motherMint.toBase58(), holders, measurer, observer, events, deps, journal, airdropJournal, treasuryMotherBefore: ledger.balanceOf(payer.publicKey, motherMint) };
}

/** Run executeCollapse, restarting on Crash with reopened journals. */
async function runWithRestarts(w: World, maxRestarts = 10) {
  let restarts = 0;
  for (;;) {
    try {
      const out = await executeCollapse(w.mother, { ...w.deps, journal: w.journal.reopen(), airdropJournal: w.airdropJournal.reopen() });
      return { out, restarts };
    } catch (e) {
      if (!(e instanceof Crash)) throw e;
      restarts++;
      if (restarts > maxRestarts) throw new Error('too many restarts');
    }
  }
}

function assertExactlyOnce(w: World, out: Awaited<ReturnType<typeof executeCollapse>>) {
  const { ledger, payer, motherCa } = w;
  const r = collapseRewards(w.mother.supply.remainingUnits);
  // rewards: one burn of burnedUnits, one measurer transfer of measurerUnits
  expect(ledger.burnedOf(motherCa)).toBe(r.burnedUnits);
  expect(ledger.landedBurns.filter((b) => b.mint === motherCa).length).toBe(1);
  expect(ledger.transfersTo(w.measurer, motherCa)).toEqual({ count: 1, units: r.measurerUnits });
  expect(w.treasuryMotherBefore - ledger.balanceOf(payer.publicKey, motherCa)).toBe(r.removedUnits);
  // daughter launched exactly once
  const daughterCa = out.daughter.ca;
  expect(ledger.mints.get(daughterCa)!.initCount).toBe(1);
  expect(w.events.filter((e) => e.type === 'daughterLaunched').length).toBe(1);
  expect(out.launch.ca).toBe(daughterCa);
  // airdrop exact
  let total = 0n;
  for (const e of out.table.entries) {
    expect(ledger.transfersTo(e.wallet, daughterCa)).toEqual({ count: e.units > 0n ? 1 : 0, units: e.units });
    total += e.units;
  }
  expect(total).toBe(out.table.allocatedUnits);
  expect(ledger.memos.filter((m) => m.memo === `qsd:v1:allocation-root:${out.table.merkleRoot}`).length).toBe(1);
  // dust burned exactly once
  expect(ledger.burnedOf(daughterCa)).toBe(out.table.dustUnits);
  expect(ledger.balanceOf(payer.publicKey, daughterCa)).toBe(10_000_000n - out.table.allocatedUnits - out.table.dustUnits);
  expect(out.daughter.supply.remainingUnits).toBe(10_000_000n - out.table.dustUnits);
  expect(out.mother.daughterCa).toBe(daughterCa);
  expect(out.mother.supply.remainingUnits).toBe(w.mother.supply.remainingUnits - r.burnedUnits);
  // every step journalled once, completed
  const doc = w.journal.peek()!;
  for (const s of COLLAPSE_STEPS) expect(doc.steps[s]?.status).toBe('done');
  expect(doc.completedAt).toBeTruthy();
  // the snapshot excluded the treasury and holds every real holder
  expect(out.snapshot.holders.map((h) => h.wallet).sort()).toEqual(w.holders.map((h) => h.wallet).sort());
  expect(out.snapshot.holders.every((h: HolderSnapshot) => h.wallet !== payer.publicKey.toBase58())).toBe(true);
}

describe('executeCollapse crash / resume (spec §9 l.380-388, §10 l.416)', () => {
  it('no crash: every step exactly once, daughter launched once, holders paid their exact units', async () => {
    const w = await world();
    const { out, restarts } = await runWithRestarts(w);
    expect(restarts).toBe(0);
    expect(out.resumed).toBe(false);
    assertExactlyOnce(w, out);
    expect(w.mother.state).toBe('collapsed');
  }, 120_000);

  for (const step of COLLAPSE_STEPS) {
    it(`crash right after step '${step}' is journalled: resume skips it and finishes; nothing happens twice`, async () => {
      const w = await world();
      let armed = true;
      w.observer.subscribe((e) => {
        if (armed && e.type === 'collapseStep' && e.status === 'done' && e.step === step) {
          armed = false;
          throw new Crash(`after ${step}`);
        }
      });
      const { out, restarts } = await runWithRestarts(w);
      expect(restarts).toBe(1);
      expect(out.resumed).toBe(true);
      assertExactlyOnce(w, out);
      const skipped = w.events.filter((e) => e.type === 'collapseStep' && e.status === 'skipped').map((e) => (e as { step: CollapseStep }).step);
      expect(skipped).toEqual(COLLAPSE_STEPS.slice(0, COLLAPSE_STEPS.indexOf(step) + 1));
    }, 120_000);
  }

  it('crash inside the airdrop after a batch landed but before its confirmation was journalled: resume reconciles by signature, pays nobody twice', async () => {
    const w = await world();
    w.ledger.transferFaults = ['ok', 'confirm-crash'];
    const { out, restarts } = await runWithRestarts(w);
    expect(restarts).toBe(1);
    assertExactlyOnce(w, out);
  }, 120_000);

  it('a journal for another mother / another collapse time is refused; a non-collapsed coin is refused', async () => {
    const w = await world();
    await runWithRestarts(w);
    await expect(executeCollapse({ ...w.mother, ca: Keypair.generate().publicKey.toBase58() }, { ...w.deps, journal: w.journal.reopen() })).rejects.toThrow(/journal is for/);
    await expect(executeCollapse({ ...w.mother, collapsedAt: w.mother.collapsedAt! + 1 }, { ...w.deps, journal: w.journal.reopen() })).rejects.toThrow(/journal is for/);
    await expect(executeCollapse({ ...w.mother, state: 'superposed' }, { ...w.deps, journal: new HJournal<CollapseJournalDoc>() })).rejects.toThrow(/not collapsed/);
  }, 120_000);

  it('FINDING H-S2a (HIGH): crash inside `rewards` after the reward burn landed (before the step is journalled): resume burns the 1 % AGAIN and pays the measurer again', async () => {
    const w = await world();
    w.ledger.sendFaults = ['confirm-crash']; // the first send is the reward burn
    const { out } = await runWithRestarts(w);
    assertExactlyOnce(w, out); // fails: mother burned twice
  }, 120_000);

  it('FINDING H-S2b (HIGH): crash inside `dust-burn` after the burn landed: resume burns the dust again', async () => {
    const w = await world();
    // sends in order: reward burn, measurer transfer, daughter launch, allocation-root anchor, dust burn
    w.ledger.sendFaults = ['ok', 'ok', 'ok', 'ok', 'confirm-crash'];
    const { out } = await runWithRestarts(w);
    assertExactlyOnce(w, out); // fails: dust burned twice (if dust > 0)
    expect(out.table.dustUnits > 0n).toBe(true);
  }, 120_000);

  it('FINDING H-S2c (HIGH): crash inside `daughter-launch` after the mint transaction landed: the README says the launch is "re-checked by signature", but resume re-sends the create with the same mint and the collapse is stuck', async () => {
    const w = await world();
    w.ledger.sendFaults = ['ok', 'ok', 'confirm-crash'];
    const { out } = await runWithRestarts(w); // fails: resume throws "mint already initialized" on every run
    assertExactlyOnce(w, out);
  }, 120_000);
});
