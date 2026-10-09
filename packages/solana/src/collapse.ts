/**
 * Collapse orchestration — fully automatic, no human in the loop, every
 * step journalled and resumable:
 *
 *   1. snapshot         holders at the collapse slot (DAS / gPA) + HoldingHistory — before any token moves
 *   2. rewards          collapseRewards(remaining): burn + pay the measurer (from the protocol treasury's mother holdings)
 *   3. daughter-key     fresh mint keypair, encrypted into the vault → the daughter's ca is known
 *   4. daughter-identity  WOTS/Merkle identity in the identity reserve → identityRoot
 *   5. daughter-launch  pump.fun (mainnet) / SPL mint (devnet)
 *   6. allocation       deriveDaughterParams → resolvePoolUnits → computeAllocation → buildDaughterCoin
 *   7. airdrop          runAirdrop (anchors the Merkle root, journalled separately, resumable)
 *   8. dust-burn        burn table.dustUnits of the daughter
 *
 * A step that finished is never repeated; a step that crashed mid-way is
 * re-run from its own journal (airdrop) or re-checked by signature (burns,
 * launch). Nothing here invents a value: a treasury that cannot cover the
 * reward burn or the allocation pool stops the collapse with a clear error.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { createBurnInstruction, createTransferInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import {
  PROTOCOL_PARAMS,
  buildDaughterCoin,
  collapseMeasurement,
  collapseRewards,
  computeAllocation,
  deriveDaughterParams,
  resolvePoolUnits,
  type AllocationTable,
  type Coin,
  type DaughterParams,
  type HolderSnapshot,
  type UnixSeconds,
} from '@qsd/protocol';
import { runAirdrop, type AirdropJournal, type AirdropReport, type TransferSender } from './airdrop.js';
import type { AnchorFn } from './anchor.js';
import type { Cluster } from './config.js';
import { ChainConfigError, ChainUnavailableError, InvalidCollapseError } from './errors.js';
import { LeasedJournal, type JournalStore, type Leasable, type Sleep } from './journal.js';
import type { KeyVault } from './keys.js';
import { launchDaughter, type LaunchDeps, type LaunchResult } from './launch.js';
import type { ChainObserver } from './observer.js';
import { buyCostLamports, devBuySolForUnits, type BondingCurveState } from './pump.js';
import type { IdentityReserve } from './reserve.js';
import { holderSnapshotAtSlot, type SnapshotDeps, type SnapshotResult } from './snapshot.js';
import { sendTracked, settle, type ChainReader, type SentTransaction, type TransactionSender } from './sender.js';
import type { TransactionInstruction } from '@solana/web3.js';

export type CollapseStep = 'rewards' | 'snapshot' | 'daughter-key' | 'daughter-identity' | 'daughter-launch' | 'allocation' | 'airdrop' | 'dust-burn';
export const COLLAPSE_STEPS: readonly CollapseStep[] = ['snapshot', 'rewards', 'daughter-key', 'daughter-identity', 'daughter-launch', 'allocation', 'airdrop', 'dust-burn'];

export interface StepRecord<T> {
  status: 'done';
  at: string;
  result: T;
}

export interface RewardsResult {
  removedUnits: bigint;
  measurerUnits: bigint;
  burnedUnits: bigint;
  burnTx: string;
  measurerTx?: string;
  measurer: string;
}

/** A single transaction inside a step, journalled as soon as its signature is known and decided by the chain on resume. */
export interface TrackedSend {
  signature: string;
  lastValidBlockHeight: number;
  status: 'sent' | 'confirmed' | 'failed' | 'expired';
  at: string;
}

export interface CollapseJournalDoc extends Leasable {
  motherCa: string;
  collapseAt: UnixSeconds;
  /** The slot the snapshot is taken for: the proof anchor's slot when the caller knows it, else the orchestration start slot. */
  collapseSlot: number;
  collapseSlotSource: 'proof-anchor' | 'orchestration-start';
  startedAt: string;
  /** Per-transaction records inside steps, keyed by `<step>.<name>`. */
  sends: Record<string, TrackedSend>;
  /** Mother units the reward removes, fixed before its first transaction (less than 1 % when capped to the treasury's holdings). */
  rewardRemovedUnits?: string;
  steps: {
    rewards?: StepRecord<RewardsResult>;
    snapshot?: StepRecord<SnapshotResult>;
    'daughter-key'?: StepRecord<{ ca: string; vaultLabel: string }>;
    'daughter-identity'?: StepRecord<{ identityRoot: string }>;
    'daughter-launch'?: StepRecord<LaunchResult>;
    allocation?: StepRecord<{ params: DaughterParams; poolUnits: bigint; table: AllocationTable; daughter: Coin }>;
    airdrop?: StepRecord<AirdropReport>;
    'dust-burn'?: StepRecord<{ dustUnits: bigint; burnTx?: string }>;
  };
  completedAt?: string;
}

export type CollapseJournal = JournalStore<CollapseJournalDoc>;

export interface CollapseDeps {
  cluster: Cluster;
  sender: TransactionSender;
  reader: ChainReader;
  transferSender: TransferSender;
  anchor: AnchorFn;
  snapshot: SnapshotDeps;
  launch: Omit<LaunchDeps, 'cluster' | 'sender' | 'reader'> & { creator: Keypair; getMintRentLamports: () => Promise<number> };
  vault: KeyVault;
  reserve: IdentityReserve;
  journal: CollapseJournal;
  airdropJournal: AirdropJournal;
  /** The mother's image bytes for the daughter's metadata (fetched by the app). */
  imageBytes: () => Promise<Uint8Array>;
  /**
   * Mainnet: pump.fun access for the money steps. The daughter's dev buy is
   * sized to its resolved airdrop pool, and a treasury short of the mother
   * units a collapse reward removes buys the difference on the mother's curve.
   */
  pump?: {
    /** The mother's bonding curve, or undefined if it has none. */
    curve(mint: PublicKey): Promise<BondingCurveState | undefined>;
    buy(p: { mint: PublicKey; units: bigint; decimals: number }, onSent: (sent: SentTransaction) => Promise<void>): Promise<string>;
    /** Refuse a daughter launch whose dev buy would cost more than this (SOL). */
    maxDaughterDevBuySol: number;
    /**
     * Refuse a reward shortfall buy that would cost more than this (SOL).
     * 0 = never buy: the reward is then capped to the mother units the
     * treasury already holds (from the launch dev buy) instead of 1 %.
     */
    maxShortfallSol: number;
    /** Kept back for transaction costs when checking the wallet can pay (lamports). Default 0.03 SOL. */
    overheadLamports?: bigint;
  };
  /** Devnet only: daughter supply to mint. */
  devnetSupply?: { units: bigint; decimals: number };
  /**
   * Slot of the collapse measurement's proof-anchor transaction (from the
   * measurement journal). The snapshot is taken for this slot; without it the
   * orchestration start slot is used and recorded as such (README §9, H-S6).
   */
  collapseSlot?: number;
  leaseTtlMs?: number;
  /** Wallets excluded from the snapshot besides the treasury (bonding curve, pools). */
  excludeOwners?: string[];
  observer?: ChainObserver;
  log?: (line: string) => void;
  /** Injectable backoff sleep for the airdrop retries (tests). */
  sleep?: Sleep;
}

export interface CollapseOutcome {
  mother: Coin;
  daughter: Coin;
  table: AllocationTable;
  rewards: RewardsResult;
  snapshot: SnapshotResult;
  launch: LaunchResult;
  airdrop: AirdropReport;
  dustBurnTx?: string;
  resumed: boolean;
  /** How many slots after the collapse slot the holder data was observed. */
  snapshotSlotLag: number;
}

const mintKeyLabel = (ca: string) => `qsd/mint/${ca}`;

/** Execute (or resume) the collapse of a `collapsed` mother coin. */
export async function executeCollapse(mother: Coin, deps: CollapseDeps): Promise<CollapseOutcome> {
  if (mother.state !== 'collapsed' || mother.collapsedAt === undefined) {
    throw new InvalidCollapseError(`coin ${mother.ca} is '${mother.state}', not collapsed`);
  }
  const collapseAt = mother.collapsedAt;

  const leased = new LeasedJournal<CollapseJournalDoc>(deps.journal, { ...(deps.sleep ? { sleep: deps.sleep } : {}), ...(deps.leaseTtlMs !== undefined ? { ttlMs: deps.leaseTtlMs } : {}) });
  const resumed = (await deps.journal.load()) !== undefined;
  const startSlot = resumed ? 0 : deps.collapseSlot ?? (await deps.reader.getSlot());
  const d = await leased.acquire(() => ({
    motherCa: mother.ca,
    collapseAt,
    collapseSlot: startSlot,
    collapseSlotSource: deps.collapseSlot !== undefined ? 'proof-anchor' : 'orchestration-start',
    startedAt: new Date().toISOString(),
    sends: {},
    steps: {},
  }));
  try {
    return await executeCollapseLeased(mother, deps, d, leased, resumed);
  } finally {
    await leased.release(d).catch(() => undefined);
  }
}

async function executeCollapseLeased(mother: Coin, deps: CollapseDeps, d: CollapseJournalDoc, leased: LeasedJournal<CollapseJournalDoc>, resumed: boolean): Promise<CollapseOutcome> {
  const last = collapseMeasurement(mother);
  const collapseAt = mother.collapsedAt as UnixSeconds;
  const log = deps.log ?? (() => undefined);
  const treasury = deps.sender.payer;
  const motherMint = new PublicKey(mother.ca);
  if (d.motherCa !== mother.ca || d.collapseAt !== collapseAt) {
    throw new InvalidCollapseError(`collapse journal is for ${d.motherCa}@${d.collapseAt}, not ${mother.ca}@${collapseAt}`);
  }
  d.sends ??= {};
  const save = () => leased.save(d);

  /**
   * Exactly-once send inside a step: the signature is journalled before
   * submission (when the sender can prepare) or right after `send()`; on
   * resume a journalled signature is decided by the chain, never re-sent
   * while it could still land.
   */
  const sendOnce = async (key: string, build: () => TransactionInstruction[], opts: Parameters<TransactionSender['send']>[1] = {}): Promise<TrackedSend> => {
    const rec = d.sends[key];
    if (rec) {
      if (rec.status === 'confirmed') return rec;
      if (rec.status === 'sent') {
        const s = await settle(deps.sender, rec.signature, rec.lastValidBlockHeight);
        if (s === 'confirmed' || s === 'finalized') {
          rec.status = 'confirmed';
          await save();
          log(`resume: ${key} ${rec.signature} confirmed`);
          return rec;
        }
        rec.status = s;
        await save();
        log(`resume: ${key} ${rec.signature} ${s}; re-sending`);
      }
      // failed / expired: fall through and send again under a new key version
    }
    const sent: SentTransaction = await sendTracked(deps.sender, build(), opts, async (st) => {
      d.sends[key] = { signature: st.signature, lastValidBlockHeight: st.lastValidBlockHeight, status: 'sent', at: new Date().toISOString() };
      await save();
    });
    const s = await settle(deps.sender, sent.signature, sent.lastValidBlockHeight);
    const cur = d.sends[key] as TrackedSend;
    if (s === 'confirmed' || s === 'finalized') {
      cur.status = 'confirmed';
      await save();
      return cur;
    }
    cur.status = s;
    await save();
    throw new ChainUnavailableError(`${key} transaction ${sent.signature} ${s}`);
  };
  const step = async <K extends CollapseStep>(name: K, run: () => Promise<NonNullable<CollapseJournalDoc['steps'][K]>['result']>): Promise<NonNullable<CollapseJournalDoc['steps'][K]>['result']> => {
    const existing = d.steps[name];
    if (existing) {
      deps.observer?.emit({ type: 'collapseStep', step: name, status: 'skipped' });
      return existing.result as NonNullable<CollapseJournalDoc['steps'][K]>['result'];
    }
    deps.observer?.emit({ type: 'collapseStep', step: name, status: 'started' });
    const result = await run();
    (d.steps as Record<string, StepRecord<unknown>>)[name] = { status: 'done', at: new Date().toISOString(), result };
    await save();
    deps.observer?.emit({ type: 'collapseStep', step: name, status: 'done' });
    log(`collapse ${mother.ca}: ${name} done`);
    return result;
  };

  /** The protocol's reward split applied to a removed amount smaller than 1 %. */
  const rewardsFor = (removedUnits: bigint) => {
    const measurerUnits = (removedUnits * BigInt(PROTOCOL_PARAMS.MEASURER_SHARE_OF_BURN_BPS)) / 10_000n;
    return { removedUnits, measurerUnits, burnedUnits: removedUnits - measurerUnits };
  };
  /** Buy `units` mother units on its bonding curve; the signature is journalled under 'rewards.shortfall-buy' so a resume never buys twice. */
  const buyRewardShortfall = async (units: bigint): Promise<void> => {
    const pump = deps.pump!;
    const key = 'rewards.shortfall-buy';
    const rec = d.sends[key];
    if (rec?.status === 'confirmed') return;
    if (rec?.status === 'sent') {
      const s = await settle(deps.sender, rec.signature, rec.lastValidBlockHeight);
      rec.status = s === 'finalized' ? 'confirmed' : s;
      await save();
      if (rec.status === 'confirmed') return;
    }
    const curve = await pump.curve(motherMint);
    if (!curve || curve.complete) {
      throw new ChainUnavailableError(`treasury is ${units} mother units short of the collapse reward and ${mother.ca} has left its bonding curve; buy ${units} units into the fee wallet to resume`);
    }
    const cost = buyCostLamports(curve, units);
    const max = BigInt(Math.round(pump.maxShortfallSol * 1e9));
    if (cost > max) throw new ChainUnavailableError(`buying the ${units}-unit reward shortfall would cost ~${cost} lamports, above the ${max} limit; buy them into the fee wallet to resume`);
    await assertAffordable(cost, 'the collapse reward shortfall');
    const sig = await pump.buy({ mint: motherMint, units, decimals: mother.supply.decimals }, async (st) => {
      d.sends[key] = { signature: st.signature, lastValidBlockHeight: st.lastValidBlockHeight, status: 'sent', at: new Date().toISOString() };
      await save();
    });
    const cur = d.sends[key];
    if (cur) cur.status = 'confirmed';
    await save();
    log(`collapse ${mother.ca}: bought ${units} mother units for the reward (~${cost} lamports) in ${sig}`);
  };
  const assertAffordable = async (lamports: bigint, what: string): Promise<void> => {
    const need = lamports + (deps.pump?.overheadLamports ?? 30_000_000n);
    const balance = await deps.reader.getBalanceLamports(treasury);
    if (balance < need) throw new ChainUnavailableError(`fee wallet holds ${balance} lamports but ${what} needs ~${need}; top it up to resume this collapse`);
  };

  // 1. snapshot at the collapse slot — before any reward moves mother tokens
  const snapshot = await step('snapshot', () =>
    holderSnapshotAtSlot(
      {
        mint: mother.ca,
        bornAt: mother.bornAt,
        collapseAt,
        collapseSlot: d.collapseSlot,
        quietPeriodStart: mother.lastActivityAt,
        measurements: mother.measurements,
        excludeOwners: [treasury.toBase58(), ...(deps.excludeOwners ?? [])],
      },
      deps.snapshot,
    ),
  );
  if (snapshot.holders.length === 0) throw new InvalidCollapseError(`no holders of ${mother.ca} at slot ${snapshot.observedSlot}; nothing to allocate`);

  // 2. rewards (after the snapshot, so the measurer's reward is not part of the holder set)
  const rewards = await step('rewards', async () => {
    let r = collapseRewards(mother.supply.remainingUnits);
    if (d.rewardRemovedUnits !== undefined) r = rewardsFor(BigInt(d.rewardRemovedUnits));
    if (!d.sends['rewards.burn']) {
      let held = await deps.reader.getTokenBalance(treasury, motherMint);
      if (held < r.removedUnits && deps.cluster === 'mainnet-beta' && deps.pump) {
        if (deps.pump.maxShortfallSol > 0) {
          await buyRewardShortfall(r.removedUnits - held);
          held = await deps.reader.getTokenBalance(treasury, motherMint);
        } else {
          log(`collapse ${mother.ca}: reward capped to the treasury's ${held} mother units (1 % would be ${r.removedUnits})`);
          r = rewardsFor(held);
        }
      }
      d.rewardRemovedUnits = r.removedUnits.toString();
      await save();
      if (held < r.removedUnits) {
        throw new ChainUnavailableError(`treasury holds ${held} mother units but the collapse reward removes ${r.removedUnits}; cannot execute rewards honestly`);
      }
    }
    const ata = getAssociatedTokenAddressSync(motherMint, treasury);
    const measurer = last.by;
    const payMeasurer = measurer !== PROTOCOL_PARAMS.AUTO_MEASURER_ID && r.measurerUnits > 0n;
    const burnUnits = payMeasurer ? r.burnedUnits : r.removedUnits;
    if (r.removedUnits === 0n) return { ...r, burnTx: '', measurer };
    const burn = await sendOnce('rewards.burn', () => [createBurnInstruction(ata, motherMint, treasury, burnUnits)]);
    deps.observer?.emit({ type: 'burnSent', txSignature: burn.signature, mint: mother.ca, units: burnUnits.toString() });
    const out: RewardsResult = { ...r, burnTx: burn.signature, measurer };
    if (payMeasurer) {
      const to = new PublicKey(measurer);
      const toAta = getAssociatedTokenAddressSync(motherMint, to, true);
      const tx = await sendOnce('rewards.measurer', () => [
        createAssociatedTokenAccountIdempotentInstruction(treasury, toAta, to, motherMint),
        createTransferInstruction(ata, toAta, treasury, r.measurerUnits),
      ]);
      out.measurerTx = tx.signature;
    }
    return out;
  });

  // 3. daughter mint key
  const key = await step('daughter-key', async () => {
    const kp = Keypair.generate();
    const ca = kp.publicKey.toBase58();
    await deps.vault.storeKeypair(mintKeyLabel(ca), kp);
    return { ca, vaultLabel: mintKeyLabel(ca) };
  });
  const daughterCa = key.ca;

  // 4. daughter identity
  const identity = await step('daughter-identity', async () => {
    const existing = await deps.reserve.entry(daughterCa);
    if (existing) return { identityRoot: existing.identityRoot };
    const { entry } = await deps.reserve.createForCoin(daughterCa);
    return { identityRoot: entry.identityRoot };
  });

  // 5. launch, with a dev buy that covers the airdrop pool (pump.fun sends the creator's dev buy to the treasury)
  const params = deriveDaughterParams(mother, collapseAt);
  const poolUnits = resolvePoolUnits(mother.superposition, last.outcome.poolPointPpm);
  const launch = await step('daughter-launch', async () => {
    const mintKp = await deps.vault.loadKeypair(key.vaultLabel);
    const launchKey = 'daughter-launch.create';
    const rec = d.sends[launchKey];
    // Idempotency from the mint itself: if the mint exists on-chain the launch happened.
    let existing: { amount: bigint; decimals: number } | undefined;
    try {
      existing = await deps.reader.getTokenSupply(mintKp.publicKey);
    } catch {
      existing = undefined;
    }
    if (existing && existing.amount > 0n) {
      if (!rec) throw new ChainUnavailableError(`daughter mint ${daughterCa} exists on-chain but its launch signature was never journalled; record it under sends['${launchKey}'] to resume`);
      if (rec.status === 'sent') {
        const s = await settle(deps.sender, rec.signature, rec.lastValidBlockHeight);
        rec.status = s === 'finalized' ? 'confirmed' : s;
        await save();
      }
      const res: LaunchResult = { ca: daughterCa, txSignature: rec.signature, supply: { totalUnits: existing.amount, decimals: existing.decimals }, path: deps.cluster === 'mainnet-beta' ? 'pump.fun' : 'devnet-spl' };
      log(`resume: daughter ${daughterCa} already launched in ${rec.signature}`);
      deps.observer?.emit({ type: 'daughterLaunched', ca: res.ca, txSignature: res.txSignature });
      return res;
    }
    if (rec && rec.status === 'sent') {
      // Journalled but the mint does not exist yet: it may still land. Decide first.
      const s = await settle(deps.sender, rec.signature, rec.lastValidBlockHeight);
      rec.status = s === 'finalized' ? 'confirmed' : s;
      await save();
      if (s === 'confirmed' || s === 'finalized') {
        const supply = await deps.reader.getTokenSupply(mintKp.publicKey);
        const res: LaunchResult = { ca: daughterCa, txSignature: rec.signature, supply: { totalUnits: supply.amount, decimals: supply.decimals }, path: deps.cluster === 'mainnet-beta' ? 'pump.fun' : 'devnet-spl' };
        deps.observer?.emit({ type: 'daughterLaunched', ca: res.ca, txSignature: res.txSignature });
        return res;
      }
    }
    let devBuySol = 0;
    if (deps.cluster === 'mainnet-beta') {
      if (!deps.pump) throw new ChainConfigError('mainnet collapse needs pump deps to size the daughter dev buy');
      devBuySol = devBuySolForUnits(poolUnits);
      if (devBuySol > deps.pump.maxDaughterDevBuySol) {
        throw new ChainUnavailableError(`the daughter's airdrop pool of ${poolUnits} units needs a ~${devBuySol} SOL dev buy, above the ${deps.pump.maxDaughterDevBuySol} SOL limit; launch refused`);
      }
      await assertAffordable(BigInt(Math.round(devBuySol * 1e9)), `the daughter's ${devBuySol} SOL dev buy`);
      log(`collapse ${mother.ca}: daughter dev buy ${devBuySol} SOL for a pool of ${poolUnits} units`);
    }
    const plan = {
      name: params.name,
      symbol: mother.ticker,
      description: `Daughter of ${mother.name} (${mother.ca}), generation ${params.generation}. qsd.market`,
      imageBytes: await deps.imageBytes(),
      devBuySol,
      mint: mintKp,
      ...(deps.devnetSupply ? { devnetSupplyUnits: deps.devnetSupply.units, devnetDecimals: deps.devnetSupply.decimals } : {}),
    };
    const res = await launchDaughter(plan, {
      ...deps.launch,
      cluster: deps.cluster,
      sender: deps.sender,
      reader: deps.reader,
      onSent: async (st) => {
        d.sends[launchKey] = { signature: st.signature, lastValidBlockHeight: st.lastValidBlockHeight, status: 'sent', at: new Date().toISOString() };
        await save();
      },
    });
    const sentRec = d.sends[launchKey];
    if (sentRec) sentRec.status = 'confirmed';
    deps.observer?.emit({ type: 'daughterLaunched', ca: res.ca, txSignature: res.txSignature });
    return res;
  });
  if (launch.ca !== daughterCa) throw new InvalidCollapseError(`launched mint ${launch.ca} differs from the journalled daughter key ${daughterCa}`);

  // 6. allocation
  const alloc = await step('allocation', async () => {
    const held = await deps.reader.getTokenBalance(treasury, new PublicKey(daughterCa));
    if (held < poolUnits) {
      throw new ChainUnavailableError(`treasury holds ${held} daughter units but the resolved pool is ${poolUnits}; the dev buy must cover the allocation pool`);
    }
    const table = computeAllocation({
      snapshot: snapshot.holders as HolderSnapshot[],
      measurements: mother.measurements,
      bornAt: mother.bornAt,
      collapseAt,
      quietPeriodStart: mother.lastActivityAt,
      totalDaughterUnits: poolUnits,
    });
    const daughter = buildDaughterCoin(mother, params, {
      ca: daughterCa,
      identityRoot: identity.identityRoot,
      bornAt: collapseAt,
      supply: { totalUnits: launch.supply.totalUnits, remainingUnits: launch.supply.totalUnits, decimals: launch.supply.decimals },
      ...(launch.imageUri ? { imageUri: launch.imageUri } : {}),
    });
    return { params, poolUnits, table, daughter };
  });

  // 7. airdrop (anchors the Merkle root; own journal)
  const airdrop = await step('airdrop', () =>
    runAirdrop({
      table: alloc.table,
      mint: daughterCa,
      sender: deps.transferSender,
      journal: deps.airdropJournal,
      anchor: deps.anchor,
      ...(deps.observer ? { observer: deps.observer } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.leaseTtlMs !== undefined ? { leaseTtlMs: deps.leaseTtlMs } : {}),
      log,
    }),
  );

  // 8. dust burn
  const dust = await step('dust-burn', async () => {
    const dustUnits = alloc.table.dustUnits;
    if (dustUnits <= 0n) return { dustUnits };
    const mint = new PublicKey(daughterCa);
    const ata = getAssociatedTokenAddressSync(mint, treasury);
    const tx = await sendOnce('dust-burn.burn', () => [createBurnInstruction(ata, mint, treasury, dustUnits)]);
    deps.observer?.emit({ type: 'burnSent', txSignature: tx.signature, mint: daughterCa, units: dustUnits.toString() });
    return { dustUnits, burnTx: tx.signature };
  });

  d.completedAt = d.completedAt ?? new Date().toISOString();
  await save();

  const daughter: Coin = {
    ...alloc.daughter,
    supply: { ...alloc.daughter.supply, remainingUnits: alloc.daughter.supply.totalUnits - dust.dustUnits },
  };
  const motherOut: Coin = {
    ...mother,
    daughterCa,
    supply: { ...mother.supply, remainingUnits: mother.supply.remainingUnits - rewards.burnedUnits - (rewards.measurerTx ? 0n : rewards.measurerUnits) },
  };
  const out: CollapseOutcome = { mother: motherOut, daughter, table: alloc.table, rewards, snapshot, launch, airdrop, resumed, snapshotSlotLag: snapshot.observedSlot - snapshot.requestedSlot };
  if (dust.burnTx) out.dustBurnTx = dust.burnTx;
  return out;
}

export function assertCollapseDeps(deps: CollapseDeps): void {
  if (deps.cluster === 'devnet' && !deps.devnetSupply) throw new ChainConfigError('devnet collapse needs devnetSupply');
  if (!deps.launch.creator.publicKey.equals(deps.sender.payer)) throw new ChainConfigError('launch creator must be the sender payer');
}
