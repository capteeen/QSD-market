import 'server-only';
import type { Prisma, Coin as DbCoin, Channel as DbChannel, Measurement as DbMeasurement, CoinState as DbCoinState } from '@prisma/client';
import { decayProgress, nextAutoMeasureAt, type Coin, type CoinState, type Measurement, type MeasurementBundle } from '@qsd/protocol';
import type { CoinDto, CoinSummaryDto, MeasurementDto } from '@/lib/types';
import { channelToDto } from '@/lib/coin';
import { db } from './db';

/** Protocol ↔ Prisma state names. */
export function toDbState(s: CoinState): DbCoinState {
  return s === 'measured-alive' ? 'measured_alive' : s;
}
export function fromDbState(s: DbCoinState): CoinState {
  return s === 'measured_alive' ? 'measured-alive' : s;
}

export type DbCoinFull = DbCoin & { channels: DbChannel[]; measurements: DbMeasurement[] };

export const coinInclude = { channels: { orderBy: { position: 'asc' } }, measurements: { orderBy: { index: 'asc' } } } satisfies Prisma.CoinInclude;

export function measurementFromDb(m: DbMeasurement): Measurement {
  return {
    id: m.id,
    at: m.at,
    by: m.by,
    proofBundle: m.proofBundle as unknown as MeasurementBundle,
    outcome: m.outcome as unknown as Measurement['outcome'],
    decayBefore: m.decayBefore,
    decayAfter: m.decayAfter,
  };
}

/** Prisma row → @qsd/protocol Coin (what every protocol function takes). */
export function coinFromDb(row: DbCoinFull): Coin {
  const coin: Coin = {
    ca: row.ca,
    name: row.name,
    ticker: row.ticker,
    image: { uri: row.imageUri, hash: row.imageHash, lineage: row.imageLineage },
    lineageId: row.lineageId,
    generation: row.generation,
    identityRoot: row.identityRoot,
    halfLifeSec: row.halfLifeSec,
    decayProgress: row.decayProgress,
    decayChannels: row.channels.map((c) => ({
      id: c.channelId,
      probabilityPpm: c.probabilityPpm,
      label: c.label,
      daughterParams: { halfLifeSec: { min: c.halfLifeMinSec, max: c.halfLifeMaxSec }, poolUnits: { min: c.poolUnitsMin, max: c.poolUnitsMax } },
    })),
    superposition: { supplyMin: row.supplyMin, supplyMax: row.supplyMax },
    supply: { totalUnits: row.totalUnits, remainingUnits: row.remainingUnits, decimals: row.decimals },
    state: fromDbState(row.state),
    lastActivityAt: row.lastActivityAt,
    measurements: row.measurements.map(measurementFromDb),
    bornAt: row.bornAt,
  };
  if (row.motherCa) coin.motherCa = row.motherCa;
  if (row.daughterCa) coin.daughterCa = row.daughterCa;
  if (row.collapsedAt !== null) coin.collapsedAt = row.collapsedAt;
  return coin;
}

export function measurementToDto(m: DbMeasurement): MeasurementDto {
  return {
    id: m.id,
    index: m.index,
    at: m.at,
    by: m.by,
    outcome: m.outcome as unknown as MeasurementDto['outcome'],
    decayBefore: m.decayBefore,
    decayAfter: m.decayAfter,
    proofBundle: m.proofBundle as unknown as MeasurementDto['proofBundle'],
    precommitTx: m.precommitTx,
    proofTx: m.proofTx,
    attestationKind: m.attestationKind,
  };
}

/**
 * Trading activity 0..1: SOL bought in the last 24 h relative to one half of
 * the coin's quiet window, saturating. Documented in the README; it is a
 * display normalisation, not a protocol quantity.
 */
export async function activityFor(ca: string, now: number): Promise<number> {
  const since = now - 86_400;
  const agg = await db().trade.aggregate({ where: { mint: ca, at: { gte: since } }, _sum: { lamports: true }, _count: { _all: true } });
  const count = agg._count._all;
  if (count === 0) return 0;
  // 10 buys in 24 h saturates; the SOL amount is not comparable across coins without a market cap, so count is used.
  return Math.min(1, count / 10);
}

export function summaryFromDb(row: DbCoin & { measurements?: { id: string }[]; _count?: { measurements: number } }, activity: number): CoinSummaryDto {
  const state = fromDbState(row.state);
  return {
    ca: row.ca,
    name: row.name,
    ticker: row.ticker,
    generation: row.generation,
    lineageId: row.lineageId,
    state,
    halfLifeSec: row.halfLifeSec,
    lastActivityAt: row.lastActivityAt,
    bornAt: row.bornAt,
    collapsedAt: row.collapsedAt,
    superposition: { supplyMin: row.supplyMin.toString(), supplyMax: row.supplyMax.toString() },
    supply: { totalUnits: row.totalUnits.toString(), remainingUnits: row.remainingUnits.toString(), decimals: row.decimals },
    activity,
    nextAutoMeasureAt: nextAutoMeasureAt({ lastActivityAt: row.lastActivityAt, halfLifeSec: row.halfLifeSec, state }),
    measurementCount: row._count?.measurements ?? row.measurements?.length ?? 0,
  };
}

export async function coinToDto(row: DbCoinFull, now: number): Promise<CoinDto> {
  const coin = coinFromDb(row);
  const [activity, holderCount] = await Promise.all([
    activityFor(row.ca, now),
    db().trade.findMany({ where: { mint: row.ca }, distinct: ['buyer'], select: { buyer: true } }).then((r) => r.length),
  ]);
  return {
    ca: coin.ca,
    name: coin.name,
    ticker: coin.ticker,
    image: coin.image,
    lineageId: coin.lineageId,
    generation: coin.generation,
    motherCa: coin.motherCa ?? null,
    daughterCa: coin.daughterCa ?? null,
    identityRoot: coin.identityRoot,
    halfLifeSec: coin.halfLifeSec,
    decayProgress: decayProgress(coin, now),
    decayChannels: coin.decayChannels.map(channelToDto),
    superposition: { supplyMin: coin.superposition.supplyMin.toString(), supplyMax: coin.superposition.supplyMax.toString() },
    supply: { totalUnits: coin.supply.totalUnits.toString(), remainingUnits: coin.supply.remainingUnits.toString(), decimals: coin.supply.decimals },
    state: coin.state,
    lastActivityAt: coin.lastActivityAt,
    bornAt: coin.bornAt,
    collapsedAt: coin.collapsedAt ?? null,
    launchPath: row.launchPath,
    launchTx: row.launchTx,
    createdBy: row.createdBy,
    measurements: row.measurements.map(measurementToDto),
    now,
    holderCount: holderCount === 0 ? (await db().trade.count({ where: { mint: row.ca } })) === 0 ? null : 0 : holderCount,
    activity,
    nextAutoMeasureAt: nextAutoMeasureAt(coin),
  };
}

export async function loadCoin(ca: string): Promise<DbCoinFull | null> {
  return db().coin.findUnique({ where: { ca }, include: coinInclude });
}

/** Persist the scalar state of a protocol Coin after a transition (measurement, buy, collapse). */
export async function saveCoinState(coin: Coin): Promise<void> {
  await db().coin.update({
    where: { ca: coin.ca },
    data: {
      state: toDbState(coin.state),
      decayProgress: coin.decayProgress,
      lastActivityAt: coin.lastActivityAt,
      collapsedAt: coin.collapsedAt ?? null,
      remainingUnits: coin.supply.remainingUnits,
      daughterCa: coin.daughterCa ?? null,
    },
  });
}

/** Insert a brand-new protocol Coin (launch or daughter birth) with its channel table. */
export async function insertCoin(coin: Coin, extra: { launchPath: string; launchTx: string; launchBundle?: unknown; createdBy?: string }): Promise<void> {
  await db().$transaction(async (tx) => {
    await tx.lineage.upsert({ where: { id: coin.lineageId }, create: { id: coin.lineageId, genesisCa: coin.motherCa ? (await genesisOf(tx, coin)) : coin.ca }, update: {} });
    await tx.coin.create({
      data: {
        ca: coin.ca,
        name: coin.name,
        ticker: coin.ticker,
        imageUri: coin.image.uri,
        imageHash: coin.image.hash,
        imageLineage: coin.image.lineage,
        lineageId: coin.lineageId,
        generation: coin.generation,
        motherCa: coin.motherCa ?? null,
        daughterCa: coin.daughterCa ?? null,
        identityRoot: coin.identityRoot,
        halfLifeSec: coin.halfLifeSec,
        decayProgress: coin.decayProgress,
        supplyMin: coin.superposition.supplyMin,
        supplyMax: coin.superposition.supplyMax,
        totalUnits: coin.supply.totalUnits,
        remainingUnits: coin.supply.remainingUnits,
        decimals: coin.supply.decimals,
        state: toDbState(coin.state),
        lastActivityAt: coin.lastActivityAt,
        bornAt: coin.bornAt,
        collapsedAt: coin.collapsedAt ?? null,
        launchPath: extra.launchPath,
        launchTx: extra.launchTx,
        ...(extra.launchBundle !== undefined ? { launchBundle: extra.launchBundle as Prisma.InputJsonValue } : {}),
        createdBy: extra.createdBy ?? null,
        channels: {
          create: coin.decayChannels.map((c, i) => ({
            channelId: c.id,
            position: i,
            probabilityPpm: c.probabilityPpm,
            label: c.label,
            halfLifeMinSec: c.daughterParams.halfLifeSec.min,
            halfLifeMaxSec: c.daughterParams.halfLifeSec.max,
            poolUnitsMin: c.daughterParams.poolUnits.min,
            poolUnitsMax: c.daughterParams.poolUnits.max,
          })),
        },
      },
    });
  });
}

async function genesisOf(tx: Prisma.TransactionClient, coin: Coin): Promise<string> {
  const existing = await tx.lineage.findUnique({ where: { id: coin.lineageId } });
  return existing?.genesisCa ?? coin.motherCa ?? coin.ca;
}

/** Append a measurement row (id = bundleHash) with its anchor signatures. */
export async function insertMeasurement(ca: string, m: Measurement, index: number, anchors: { precommitTx?: string; proofTx?: string }): Promise<void> {
  await db().measurement.create({
    data: {
      id: m.id,
      coinCa: ca,
      index,
      at: m.at,
      by: m.by,
      proofBundle: m.proofBundle as unknown as Prisma.InputJsonValue,
      outcomeKind: m.outcome.kind,
      outcome: m.outcome as unknown as Prisma.InputJsonValue,
      decayBefore: m.decayBefore,
      decayAfter: m.decayAfter,
      precommitTx: anchors.precommitTx ?? null,
      proofTx: anchors.proofTx ?? null,
      attestationKind: m.proofBundle.draw.attestation.kind,
    },
  });
}
