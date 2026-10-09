import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { collapseMeasurement, collapseRewards, resolvePoolUnits, verifyAllocationProof, allocationProof } from '@qsd/protocol';
import {
  ChainObserver,
  InvalidCollapseError,
  KeyVault,
  MemoryAirdropJournal,
  MemoryJournalStore,
  MemoryKeyStore,
  MemoryReserveBackend,
  IdentityReserve,
  anchorWith,
  decodeAnchorMemo,
  executeCollapse,
  recordChainEvents,
  type CollapseJournalDoc,
  type HoldingHistory,
} from '../src/index.js';
import { FakeChain, fakeTokenAccountSource } from './helpers/fakeChain.js';
import { coin, collapsedCoin } from './helpers/coin.js';

describe('executeCollapse', () => {
  it('runs every step against the real instruction stream, journals them, and resumes after a crash without repeating paid steps', async () => {
    const payer = Keypair.generate();
    const chain = new FakeChain(payer);
    chain.batchSize = 2;
    const motherMint = Keypair.generate().publicKey;
    const { mother: collapsed0 } = await collapsedCoin(coin({ ca: motherMint.toBase58() }));
    const mother = { ...collapsed0, supply: { totalUnits: 1_000_000_000n, remainingUnits: 1_000_000_000n, decimals: 6 } };
    // mother ledger: treasury holds 100M, three holders, a "pool" wallet excluded
    chain.createMint(motherMint, 6);
    chain.mintTo(motherMint, payer.publicKey, 100_000_000n);
    const holders = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    chain.mintTo(motherMint, holders[0]!.publicKey, 500_000_000n);
    chain.mintTo(motherMint, holders[1]!.publicKey, 300_000_000n);
    chain.mintTo(motherMint, holders[2]!.publicKey, 100_000_000n);
    const pool = Keypair.generate();
    chain.mintTo(motherMint, pool.publicKey, 0n);

    const history: HoldingHistory = {
      async factsFor(wallet, _balance, ctx) {
        const i = holders.findIndex((h) => h.publicKey.toBase58() === wallet);
        return { firstAcquiredAt: ctx.bornAt + i * 1000, heldThroughMeasurementIds: ctx.measurements.map((m) => m.id), heldThroughQuietPeriod: i === 0 };
      },
    };
    const vault = new KeyVault(randomBytes(32), new MemoryKeyStore());
    const reserve = new IdentityReserve(vault, new MemoryReserveBackend());
    const observer = new ChainObserver();
    const rec = recordChainEvents(observer);
    const journal = new MemoryJournalStore<CollapseJournalDoc>();
    const airdropJournal = new MemoryAirdropJournal();
    const deps = () => ({
      cluster: 'devnet' as const,
      sender: chain,
      reader: chain,
      transferSender: chain,
      anchor: anchorWith({ sender: chain, observer }),
      snapshot: { sources: [fakeTokenAccountSource(chain)], history },
      launch: { creator: payer, pumpPortalApiUrl: 'https://pumpportal.fun/api', getMintRentLamports: async () => 1_461_600 },
      vault,
      reserve,
      journal,
      airdropJournal,
      imageBytes: async () => new Uint8Array([1]),
      devnetSupply: { units: 1_000_000_000_000_000n, decimals: 6 },
      excludeOwners: [pool.publicKey.toBase58()],
      observer,
      sleep: async () => undefined,
    });

    // First attempt: the airdrop's second batch never gets through (transient submit errors until the attempt budget is spent)
    chain.submitBehaviours = Array.from({ length: 12 }, (_, i) => (i === 0 ? 'ok' : 'transient'));
    await expect(executeCollapse(mother, { ...deps(), log: () => undefined })).rejects.toThrow(/airdrop: .* attempted/);
    const partial = (await journal.load())!;
    expect(Object.keys(partial.steps)).toEqual(['snapshot', 'rewards', 'daughter-key', 'daughter-identity', 'daughter-launch', 'allocation']);
    const sendsBefore = chain.sendCalls;

    // Resume: finishes airdrop + dust burn, repeats nothing else
    chain.submitBehaviours = [];
    const out = await executeCollapse(mother, deps());
    expect(out.resumed).toBe(true);
    const doc = (await journal.load())!;
    expect(doc.completedAt).toBeTruthy();
    expect(Object.keys(doc.steps)).toHaveLength(8);
    // no second reward burn / launch: only the dust burn (1 send) plus airdrop prepares
    expect(chain.sendCalls - sendsBefore).toBe(out.table.dustUnits > 0n ? 1 : 0);

    // rewards executed exactly as the protocol computes them
    const r = collapseRewards(mother.supply.remainingUnits);
    expect(out.rewards.burnedUnits).toBe(r.burnedUnits);
    const measurer = collapseMeasurement(mother).by;
    expect(chain.balanceOf(measurer, motherMint)).toBe(r.measurerUnits);
    expect(chain.balanceOf(payer.publicKey, motherMint)).toBe(100_000_000n - r.removedUnits);
    expect(chain.mints.get(motherMint.toBase58())!.supply).toBe(1_000_000_000n - r.burnedUnits);

    // snapshot excludes the treasury and the pool
    expect(out.snapshot.holders.map((h) => h.wallet).sort()).toEqual(holders.map((h) => h.publicKey.toBase58()).sort());

    // daughter: real mint, identity from the reserve, allocation pool from the collapse draw
    const daughterMint = new PublicKey(out.daughter.ca);
    expect(out.daughter.motherCa).toBe(mother.ca);
    expect(out.daughter.generation).toBe(2);
    expect(out.daughter.name).toBe('PHOTON·2');
    expect((await reserve.entry(out.daughter.ca))!.identityRoot).toBe(out.daughter.identityRoot);
    const pool_ = resolvePoolUnits(mother.superposition, collapseMeasurement(mother).outcome.poolPointPpm);
    expect(out.table.totalUnits).toBe(pool_);
    expect(out.table.allocatedUnits + out.table.dustUnits).toBe(pool_);

    // every holder got exactly its units; the treasury kept supply − pool; dust burned
    let paid = 0n;
    for (const e of out.table.entries) {
      expect(chain.balanceOf(e.wallet, daughterMint)).toBe(e.units);
      paid += e.units;
      expect(verifyAllocationProof(out.table.merkleRoot, { wallet: e.wallet, units: e.units }, allocationProof(out.table, e.wallet))).toBe(true);
    }
    expect(paid).toBe(out.table.allocatedUnits);
    expect(chain.balanceOf(payer.publicKey, daughterMint)).toBe(1_000_000_000_000_000n - pool_);
    expect(chain.mints.get(out.daughter.ca)!.supply).toBe(1_000_000_000_000_000n - out.table.dustUnits);
    expect(out.daughter.supply.remainingUnits).toBe(1_000_000_000_000_000n - out.table.dustUnits);

    // the Merkle root was anchored exactly once
    const roots = chain.memos.map((m) => decodeAnchorMemo(m.memo)).filter((d) => d?.kind === 'allocation-root');
    expect(roots).toEqual([{ kind: 'allocation-root', hash: out.table.merkleRoot }]);
    expect(out.airdrop.rootAnchorSignature).toBe(chain.memos.find((m) => decodeAnchorMemo(m.memo)?.kind === 'allocation-root')!.signature);

    // a third run is a no-op returning the same outcome
    const again = await executeCollapse(mother, deps());
    expect(again.daughter.ca).toBe(out.daughter.ca);
    expect(rec.events.filter((e) => e.type === 'daughterLaunched')).toHaveLength(1);
  });

  it('refuses a coin that is not collapsed and a treasury that cannot cover the reward', async () => {
    const payer = Keypair.generate();
    const chain = new FakeChain(payer);
    const base = coin();
    const deps = {
      cluster: 'devnet' as const,
      sender: chain,
      reader: chain,
      transferSender: chain,
      anchor: anchorWith({ sender: chain }),
      snapshot: { sources: [fakeTokenAccountSource(chain)] },
      launch: { creator: payer, pumpPortalApiUrl: '', getMintRentLamports: async () => 0 },
      vault: new KeyVault(randomBytes(32), new MemoryKeyStore()),
      reserve: new IdentityReserve(new KeyVault(randomBytes(32), new MemoryKeyStore()), new MemoryReserveBackend()),
      journal: new MemoryJournalStore<CollapseJournalDoc>(),
      airdropJournal: new MemoryAirdropJournal(),
      imageBytes: async () => new Uint8Array(),
    };
    await expect(executeCollapse(base, deps)).rejects.toThrow(InvalidCollapseError);
    const motherMint = Keypair.generate().publicKey;
    const { mother } = await collapsedCoin(coin({ ca: motherMint.toBase58() }));
    chain.createMint(motherMint, 6);
    chain.mintTo(motherMint, Keypair.generate().publicKey, 1_000n);
    // no HoldingHistory → NotImplementedError, never zeroed defaults
    await expect(executeCollapse(mother, { ...deps, journal: new MemoryJournalStore<CollapseJournalDoc>() })).rejects.toThrow(/HoldingHistory/);
    const history = { async factsFor() { return { firstAcquiredAt: mother.bornAt, heldThroughMeasurementIds: [], heldThroughQuietPeriod: true }; } };
    await expect(executeCollapse(mother, { ...deps, snapshot: { sources: [fakeTokenAccountSource(chain)], history }, journal: new MemoryJournalStore<CollapseJournalDoc>() })).rejects.toThrow(/treasury holds 0 mother units/);
  });

  describe('mainnet money steps', () => {
    const setup = async (balanceLamports: bigint) => {
      const payer = Keypair.generate();
      const chain = new FakeChain(payer);
      chain.lamports = balanceLamports;
      const motherMint = Keypair.generate().publicKey;
      const { mother: m0 } = await collapsedCoin(coin({ ca: motherMint.toBase58() }));
      // a 5 % pool (pump.fun supply of 1B tokens at 6 decimals)
      const mother = { ...m0, supply: { totalUnits: 1_000_000_000_000_000n, remainingUnits: 1_000_000_000_000_000n, decimals: 6 }, superposition: { supplyMin: 50_000_000_000_000n, supplyMax: 50_000_000_000_000n } };
      chain.createMint(motherMint, 6);
      chain.mintTo(motherMint, Keypair.generate().publicKey, 1_000_000_000n);
      const buys: { units: bigint }[] = [];
      let fetches = 0;
      const deps = {
        cluster: 'mainnet-beta' as const,
        sender: chain,
        reader: chain,
        transferSender: chain,
        anchor: anchorWith({ sender: chain }),
        snapshot: { sources: [fakeTokenAccountSource(chain)], history: { async factsFor() { return { firstAcquiredAt: mother.bornAt, heldThroughMeasurementIds: [], heldThroughQuietPeriod: true }; } } },
        launch: { creator: payer, pumpPortalApiUrl: 'https://pumpportal.fun/api', getMintRentLamports: async () => 0, fetchImpl: (async () => { fetches++; throw new Error('no network in tests'); }) as unknown as typeof fetch },
        vault: new KeyVault(randomBytes(32), new MemoryKeyStore()),
        reserve: new IdentityReserve(new KeyVault(randomBytes(32), new MemoryKeyStore()), new MemoryReserveBackend()),
        journal: new MemoryJournalStore<CollapseJournalDoc>(),
        airdropJournal: new MemoryAirdropJournal(),
        imageBytes: async () => new Uint8Array([1]),
        pump: {
          curve: async () => ({ ...{ virtualSolReserves: 30_000_000_000n, virtualTokenReserves: 1_073_000_000_000_000n }, realTokenReserves: 0n, realSolReserves: 0n, tokenTotalSupply: 0n, complete: false }),
          buy: async (p: { mint: PublicKey; units: bigint }, onSent: (s: { signature: string; lastValidBlockHeight: number }) => Promise<void>) => {
            await onSent({ signature: 'buy-sig', lastValidBlockHeight: 1 });
            buys.push({ units: p.units });
            chain.mintTo(p.mint, payer.publicKey, p.units);
            return 'buy-sig';
          },
          maxDaughterDevBuySol: 2,
          maxShortfallSol: 0.5,
        },
      };
      return { chain, mother, deps, buys, fetches: () => fetches };
    };

    it('buys the mother-token reward shortfall once, then refuses a daughter launch the wallet cannot afford, before any pump.fun request', async () => {
      const { mother, deps, buys, fetches } = await setup(1_000_000_000n); // 1 SOL: enough for the shortfall, not the ~1.5 SOL dev buy
      await expect(executeCollapse(mother, deps)).rejects.toThrow(/fee wallet holds 1000000000 lamports but the daughter's 1\.\d+ SOL dev buy needs/);
      expect(buys).toEqual([{ units: 10_000_000_000_000n }]); // 1 % of remaining supply
      const j = (await deps.journal.load())!;
      expect(j.sends['rewards.shortfall-buy']?.status).toBe('confirmed');
      expect(Object.keys(j.steps)).toEqual(['snapshot', 'rewards', 'daughter-key', 'daughter-identity']);
      expect(fetches()).toBe(0);
      // a resume does not buy again
      await expect(executeCollapse(mother, deps)).rejects.toThrow(/dev buy needs/);
      expect(buys).toHaveLength(1);
    });

    it('refuses a pool whose dev buy exceeds the limit, and a shortfall buy above its limit', async () => {
      const a = await setup(100_000_000_000n);
      await expect(executeCollapse(a.mother, { ...a.deps, pump: { ...a.deps.pump, maxDaughterDevBuySol: 1 } })).rejects.toThrow(/above the 1 SOL limit; launch refused/);
      const b = await setup(100_000_000_000n);
      await expect(executeCollapse(b.mother, { ...b.deps, pump: { ...b.deps.pump, maxShortfallSol: 0.1 } })).rejects.toThrow(/reward shortfall would cost/);
      expect(b.buys).toEqual([]);
    });
  });
});
