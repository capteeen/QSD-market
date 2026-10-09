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
import type { JournalStore, Sleep } from './journal.js';
import type { KeyVault } from './keys.js';
import { launchDaughter, type LaunchDeps, type LaunchResult } from './launch.js';
import type { ChainObserver } from './observer.js';
import type { IdentityReserve } from './reserve.js';
import { holderSnapshotAtSlot, type SnapshotDeps, type SnapshotResult } from './snapshot.js';
import type { ChainReader, TransactionSender } from './sender.js';

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

export interface CollapseJournalDoc {
  version: 1;
  motherCa: string;
  collapseAt: UnixSeconds;
  collapseSlot: number;
  startedAt: string;
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
  devBuySol: number;
  /** Devnet only: daughter supply to mint. */
  devnetSupply?: { units: bigint; decimals: number };
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
}

const mintKeyLabel = (ca: string) => `qsd/mint/${ca}`;

async function confirmOrThrow(sender: TransactionSender, sig: string, lvbh: number, what: string): Promise<void> {
  const s = await sender.confirm(sig, lvbh);
  if (s === 'failed' || s === 'expired') throw new ChainUnavailableError(`${what} transaction ${sig} ${s}`);
}

/** Execute (or resume) the collapse of a `collapsed` mother coin. */
export async function executeCollapse(mother: Coin, deps: CollapseDeps): Promise<CollapseOutcome> {
  if (mother.state !== 'collapsed' || mother.collapsedAt === undefined) {
    throw new InvalidCollapseError(`coin ${mother.ca} is '${mother.state}', not collapsed`);
  }
  const last = collapseMeasurement(mother);
  const collapseAt = mother.collapsedAt;
  const log = deps.log ?? (() => undefined);
  const treasury = deps.sender.payer;
  const motherMint = new PublicKey(mother.ca);

  let doc = await deps.journal.load();
  const resumed = doc !== undefined;
  if (!doc) {
    doc = { version: 1, motherCa: mother.ca, collapseAt, collapseSlot: await deps.reader.getSlot(), startedAt: new Date().toISOString(), steps: {} };
    await deps.journal.save(doc);
  } else if (doc.motherCa !== mother.ca || doc.collapseAt !== collapseAt) {
    throw new InvalidCollapseError(`collapse journal is for ${doc.motherCa}@${doc.collapseAt}, not ${mother.ca}@${collapseAt}`);
  }
  const d = doc;
  const save = () => deps.journal.save(d);
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
    const r = collapseRewards(mother.supply.remainingUnits);
    const held = await deps.reader.getTokenBalance(treasury, motherMint);
    if (held < r.removedUnits) {
      throw new ChainUnavailableError(`treasury holds ${held} mother units but the collapse reward removes ${r.removedUnits}; cannot execute rewards honestly`);
    }
    const ata = getAssociatedTokenAddressSync(motherMint, treasury);
    const measurer = last.by;
    const payMeasurer = measurer !== PROTOCOL_PARAMS.AUTO_MEASURER_ID && r.measurerUnits > 0n;
    const burnUnits = payMeasurer ? r.burnedUnits : r.removedUnits;
    const burn = await deps.sender.send([createBurnInstruction(ata, motherMint, treasury, burnUnits)]);
    await confirmOrThrow(deps.sender, burn.signature, burn.lastValidBlockHeight, 'reward burn');
    deps.observer?.emit({ type: 'burnSent', txSignature: burn.signature, mint: mother.ca, units: burnUnits.toString() });
    const out: RewardsResult = { ...r, burnTx: burn.signature, measurer };
    if (payMeasurer) {
      const to = new PublicKey(measurer);
      const toAta = getAssociatedTokenAddressSync(motherMint, to, true);
      const tx = await deps.sender.send([
        createAssociatedTokenAccountIdempotentInstruction(treasury, toAta, to, motherMint),
        createTransferInstruction(ata, toAta, treasury, r.measurerUnits),
      ]);
      await confirmOrThrow(deps.sender, tx.signature, tx.lastValidBlockHeight, 'measurer reward');
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

  // 5. launch
  const params = deriveDaughterParams(mother, collapseAt);
  const launch = await step('daughter-launch', async () => {
    const mintKp = await deps.vault.loadKeypair(key.vaultLabel);
    const plan = {
      name: params.name,
      symbol: mother.ticker,
      description: `Daughter of ${mother.name} (${mother.ca}), generation ${params.generation}. qsd.market`,
      imageBytes: await deps.imageBytes(),
      devBuySol: deps.devBuySol,
      mint: mintKp,
      ...(deps.devnetSupply ? { devnetSupplyUnits: deps.devnetSupply.units, devnetDecimals: deps.devnetSupply.decimals } : {}),
    };
    const res = await launchDaughter(plan, { ...deps.launch, cluster: deps.cluster, sender: deps.sender, reader: deps.reader });
    deps.observer?.emit({ type: 'daughterLaunched', ca: res.ca, txSignature: res.txSignature });
    return res;
  });
  if (launch.ca !== daughterCa) throw new InvalidCollapseError(`launched mint ${launch.ca} differs from the journalled daughter key ${daughterCa}`);

  // 6. allocation
  const alloc = await step('allocation', async () => {
    const poolUnits = resolvePoolUnits(mother.superposition, last.outcome.poolPointPpm);
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
      log,
    }),
  );

  // 8. dust burn
  const dust = await step('dust-burn', async () => {
    const dustUnits = alloc.table.dustUnits;
    if (dustUnits <= 0n) return { dustUnits };
    const mint = new PublicKey(daughterCa);
    const ata = getAssociatedTokenAddressSync(mint, treasury);
    const tx = await deps.sender.send([createBurnInstruction(ata, mint, treasury, dustUnits)]);
    await confirmOrThrow(deps.sender, tx.signature, tx.lastValidBlockHeight, 'dust burn');
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
  const out: CollapseOutcome = { mother: motherOut, daughter, table: alloc.table, rewards, snapshot, launch, airdrop, resumed };
  if (dust.burnTx) out.dustBurnTx = dust.burnTx;
  return out;
}

export function assertCollapseDeps(deps: CollapseDeps): void {
  if (deps.cluster === 'devnet' && !deps.devnetSupply) throw new ChainConfigError('devnet collapse needs devnetSupply');
  if (!deps.launch.creator.publicKey.equals(deps.sender.payer)) throw new ChainConfigError('launch creator must be the sender payer');
}
