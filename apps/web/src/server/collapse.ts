import 'server-only';
import { bondingCurvePda, buyOnPumpFun, decodeBondingCurve, executeCollapse, type CollapseJournalDoc, type AirdropJournalDoc } from '@qsd/solana';
import { getChain } from './chain';
import { db } from './db';
import { coinFromDb, insertCoin, loadCoin, saveCoinState } from './coins';
import { logEvent } from './events';
import { TradeLogHoldingHistory } from './holdingHistory';
import { syncIdentityMirror } from './identityMirror';
import { publish } from './redis';
import { genesisConfig } from './genesis';
import { formatUnits } from '@/lib/format';

/** The slot of the proof anchor of the measurement that collapsed the coin (the authoritative snapshot slot), or null if it was not recorded. */
export function proofAnchorSlot(row: { measurements: { outcomeKind: string; proofSlot: number | null; index: number }[] }): number | null {
  const collapsing = [...row.measurements].sort((a, b) => b.index - a.index).find((m) => m.outcomeKind === 'collapse');
  return collapsing?.proofSlot ?? null;
}

/** Mother image bytes for the daughter's metadata: devnet images live in CoinImage; mainnet images are fetched from their URI. */
async function motherImageBytes(ca: string, imageUri: string): Promise<Uint8Array> {
  const stored = await db().coinImage.findUnique({ where: { coinCa: ca } });
  if (stored) return new Uint8Array(stored.bytes);
  const res = await fetch(imageUri);
  if (!res.ok) throw new Error(`could not fetch the mother image (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** A SOL spending limit from env, or `fallback` when unset. */
function solLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number of SOL`);
  return n;
}

/**
 * Execute (or resume) a collapse through @qsd/solana `executeCollapse`, then
 * mirror the outcome: daughter coin, allocation table + entries, airdrop
 * status, mother's daughterCa and remaining supply, identity mirror, log.
 */
export async function runCollapse(ca: string, log: (line: string) => void = console.log): Promise<void> {
  const row = await loadCoin(ca);
  if (!row) throw new Error(`no such coin ${ca}`);
  const mother = coinFromDb(row);
  if (mother.state !== 'collapsed') throw new Error(`coin ${ca} is ${mother.state}, not collapsed`);
  if (mother.daughterCa) {
    log(`collapse ${ca}: daughter ${mother.daughterCa} already recorded`);
    return;
  }
  const chain = getChain();
  const { creator, sender, reader, transferSender, anchor, getMintRentLamports } = await chain.withCreator();
  const maxDaughterDevBuySol = solLimit('QSD_DAUGHTER_DEV_BUY_MAX_SOL', 2);
  const maxShortfallSol = solLimit('QSD_REWARD_SHORTFALL_MAX_SOL', 0.5);
  // H-W13: the holder snapshot is taken at the slot the collapse proof was anchored in (recorded on the
  // collapsing measurement), not at whatever slot this worker happens to start at.
  const collapseSlot = proofAnchorSlot(row);
  if (collapseSlot === null) log(`collapse ${ca}: no proof-anchor slot recorded on the collapsing measurement; the snapshot slot will be the orchestration start`);

  const outcome = await executeCollapse(mother, {
    ...(collapseSlot !== null ? { collapseSlot } : {}),
    cluster: chain.config.cluster,
    sender,
    reader,
    transferSender,
    anchor,
    snapshot: { sources: chain.snapshotSources, history: new TradeLogHoldingHistory() },
    launch: { creator, getMintRentLamports, pumpPortalApiUrl: chain.config.pumpPortalApiUrl, ...(chain.config.pinataJwt ? { pinataJwt: chain.config.pinataJwt } : {}) },
    vault: chain.vault,
    reserve: chain.reserve,
    journal: chain.journal<CollapseJournalDoc>(`collapse-${ca}`),
    airdropJournal: chain.airdropJournal(ca) as never,
    imageBytes: () => motherImageBytes(ca, mother.image.uri),
    pump: {
      async curve(mint) {
        const info = await chain.connection.getAccountInfo(bondingCurvePda(mint), 'confirmed');
        return info ? decodeBondingCurve(info.data) : undefined;
      },
      buy: (p, onSent) => buyOnPumpFun(p, { sender, pumpPortalApiUrl: chain.config.pumpPortalApiUrl, onSent }),
      maxDaughterDevBuySol,
      maxShortfallSol,
    },
    ...(chain.config.cluster === 'devnet' ? { devnetSupply: { units: genesisConfig().supplyUnits, decimals: genesisConfig().decimals } } : {}),
    observer: chain.observer,
    log,
  });

  const { daughter, table, airdrop, rewards } = outcome;
  // Daughter row (idempotent on resume).
  const existing = await db().coin.findUnique({ where: { ca: daughter.ca } });
  if (!existing) {
    await insertCoin(daughter, { launchPath: outcome.launch.path, launchTx: outcome.launch.txSignature });
    const motherImage = await db().coinImage.findUnique({ where: { coinCa: ca } });
    if (motherImage && !outcome.launch.imageUri) await db().coinImage.create({ data: { coinCa: daughter.ca, mime: motherImage.mime, bytes: motherImage.bytes } });
  }
  const mergedMother = { ...outcome.mother, daughterCa: daughter.ca };
  await saveCoinState(mergedMother);

  const journal = (await chain.airdropJournal(daughter.ca).load()) as AirdropJournalDoc | undefined;
  await db().allocationTable.upsert({
    where: { daughterCa: daughter.ca },
    create: {
      motherCa: ca,
      daughterCa: daughter.ca,
      version: table.version,
      totalUnits: table.totalUnits,
      allocatedUnits: table.allocatedUnits,
      dustUnits: table.dustUnits,
      merkleRoot: table.merkleRoot,
      leafCount: table.leafCount,
      rootAnchorTx: airdrop.rootAnchorSignature,
      collapseAt: mother.collapsedAt!,
      entries: {
        create: table.entries.map((e) => ({ wallet: e.wallet, bagUnits: e.bagUnits, bagFractionPpb: e.bagFractionPpb, weightBps: e.weightBps, sharePpb: e.sharePpb, units: e.units, leaf: e.leaf })),
      },
    },
    update: { rootAnchorTx: airdrop.rootAnchorSignature },
  });
  const tableRow = await db().allocationTable.findUniqueOrThrow({ where: { daughterCa: daughter.ca } });
  if (journal) {
    for (const rec of Object.values(journal.entries)) {
      await db().airdropEntry.upsert({
        where: { tableId_wallet: { tableId: tableRow.id, wallet: rec.wallet } },
        create: { tableId: tableRow.id, wallet: rec.wallet, units: BigInt(rec.units), status: rec.status, txSignature: rec.txSignature ?? null },
        update: { status: rec.status, txSignature: rec.txSignature ?? null },
      });
      if (rec.status === 'confirmed') {
        await db().balanceChange.upsert({
          where: { signature_mint_wallet_kind: { signature: rec.txSignature ?? `airdrop-${daughter.ca}-${rec.wallet}`, mint: daughter.ca, wallet: rec.wallet, kind: 'airdrop' } },
          create: { signature: rec.txSignature ?? `airdrop-${daughter.ca}-${rec.wallet}`, mint: daughter.ca, wallet: rec.wallet, kind: 'airdrop', deltaUnits: BigInt(rec.units), deltaUi: Number(BigInt(rec.units)) / 10 ** daughter.supply.decimals, slot: 0, at: daughter.bornAt },
          update: {},
        });
      }
    }
  }
  await syncIdentityMirror(daughter.ca);

  if (!existing) {
    await logEvent({
      type: 'daughter',
      coinCa: daughter.ca,
      tx: outcome.launch.txSignature,
      summary: `${daughter.ticker} born (generation ${daughter.generation}) from ${mother.ticker}; ${table.entries.length} holder${table.entries.length === 1 ? '' : 's'} allocated ${formatUnits(table.allocatedUnits, daughter.supply.decimals)} units, root ${table.merkleRoot.slice(0, 16)}…`,
      data: { motherCa: ca, merkleRoot: table.merkleRoot, rootAnchorTx: airdrop.rootAnchorSignature, burnTx: rewards.burnTx, measurerTx: rewards.measurerTx ?? null },
    });
    await logEvent({
      type: 'airdrop',
      coinCa: daughter.ca,
      tx: airdrop.rootAnchorSignature,
      summary: `${daughter.ticker} airdrop: ${airdrop.confirmedWallets}/${airdrop.wallets} wallets confirmed, ${formatUnits(airdrop.confirmedUnits, daughter.supply.decimals)} units`,
    });
  }
  await publish({ type: 'coin', ca });
  await publish({ type: 'coin', ca: daughter.ca });
}
