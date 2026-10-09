/**
 * Mapping between the API DTO (bigint as strings) and @qsd/protocol `Coin`,
 * plus the scene inputs derived from a coin. Pure; used on both sides.
 */
import { decayProgress, nextAutoMeasureAt, type Coin, type Channel } from '@qsd/protocol';
import type { SuperpositionInput, FieldCoin, LineageInput } from '@qsd/scene/model';
import type { QuantumState } from '@qsd/ui-tokens';
import type { ChannelDto, CoinDto, CoinSummaryDto } from './types';

export function channelFromDto(c: ChannelDto): Channel {
  return {
    id: c.id,
    probabilityPpm: c.probabilityPpm,
    label: c.label,
    daughterParams: {
      halfLifeSec: { min: c.halfLifeSec.min, max: c.halfLifeSec.max },
      poolUnits: { min: BigInt(c.poolUnits.min), max: BigInt(c.poolUnits.max) },
    },
  };
}

export function channelToDto(c: Channel): ChannelDto {
  return {
    id: c.id,
    probabilityPpm: c.probabilityPpm,
    label: c.label,
    halfLifeSec: { min: c.daughterParams.halfLifeSec.min, max: c.daughterParams.halfLifeSec.max },
    poolUnits: { min: c.daughterParams.poolUnits.min.toString(), max: c.daughterParams.poolUnits.max.toString() },
  };
}

export function coinFromDto(d: CoinDto): Coin {
  const coin: Coin = {
    ca: d.ca,
    name: d.name,
    ticker: d.ticker,
    image: { uri: d.image.uri, hash: d.image.hash, lineage: d.image.lineage },
    lineageId: d.lineageId,
    generation: d.generation,
    identityRoot: d.identityRoot,
    halfLifeSec: d.halfLifeSec,
    decayProgress: d.decayProgress,
    decayChannels: d.decayChannels.map(channelFromDto),
    superposition: { supplyMin: BigInt(d.superposition.supplyMin), supplyMax: BigInt(d.superposition.supplyMax) },
    supply: { totalUnits: BigInt(d.supply.totalUnits), remainingUnits: BigInt(d.supply.remainingUnits), decimals: d.supply.decimals },
    state: d.state,
    lastActivityAt: d.lastActivityAt,
    measurements: d.measurements.map((m) => ({
      id: m.id,
      at: m.at,
      by: m.by,
      proofBundle: m.proofBundle as Coin['measurements'][number]['proofBundle'],
      outcome: m.outcome,
      decayBefore: m.decayBefore,
      decayAfter: m.decayAfter,
    })),
    bornAt: d.bornAt,
  };
  if (d.motherCa) coin.motherCa = d.motherCa;
  if (d.daughterCa) coin.daughterCa = d.daughterCa;
  if (d.collapsedAt !== null) coin.collapsedAt = d.collapsedAt;
  return coin;
}

/** Protocol CoinState → ui-tokens QuantumState (same vocabulary). */
export function quantumState(state: Coin['state']): QuantumState {
  return state;
}

export function superpositionInput(c: Pick<CoinDto, 'superposition' | 'halfLifeSec' | 'decayChannels'>): SuperpositionInput {
  return {
    supplyMin: BigInt(c.superposition.supplyMin),
    supplyMax: BigInt(c.superposition.supplyMax),
    halfLifeSec: c.halfLifeSec,
    decayChannels: c.decayChannels.map((ch) => ({ id: ch.id, probability: ch.probabilityPpm, label: ch.label })),
  };
}

/** Relative width of the supply band: (max − min) / max, clamped 0..1. */
export function uncertainty(s: { supplyMin: string; supplyMax: string }): number {
  const min = BigInt(s.supplyMin);
  const max = BigInt(s.supplyMax);
  if (max <= 0n) return 0;
  const ppm = Number(((max - min) * 1_000_000n) / max) / 1_000_000;
  return Math.min(1, Math.max(0, ppm));
}

export function liveDecay(c: Pick<CoinSummaryDto, 'lastActivityAt' | 'halfLifeSec' | 'state'>, now: number): number {
  return decayProgress({ lastActivityAt: c.lastActivityAt, halfLifeSec: c.halfLifeSec, state: c.state }, now);
}

export function liveNextAuto(c: Pick<CoinSummaryDto, 'lastActivityAt' | 'halfLifeSec' | 'state'>): number | null {
  return nextAutoMeasureAt({ lastActivityAt: c.lastActivityAt, halfLifeSec: c.halfLifeSec, state: c.state });
}

export function fieldCoin(c: CoinSummaryDto, now: number): FieldCoin {
  return {
    ca: c.ca,
    uncertainty: uncertainty(c.superposition),
    activity: Math.min(1, Math.max(0, c.activity)),
    decayProgress: liveDecay(c, now),
    state: quantumState(c.state),
  };
}

export function lineageInput(c: CoinDto, mother?: CoinDto | null): LineageInput {
  const li: LineageInput = { ca: c.ca, generation: c.generation };
  if (mother && (mother.state === 'collapsed' || mother.state === 'tunnelled')) {
    const last = mother.measurements[mother.measurements.length - 1];
    const m: NonNullable<LineageInput['mother']> = {
      ca: mother.ca,
      generation: mother.generation,
      finalState: mother.state,
      measurementsSurvived: mother.measurements.filter((x) => x.outcome.kind === 'survive').length,
    };
    if (last && last.outcome.kind === 'collapse') {
      const channelId = last.outcome.channelId;
      const ch = mother.decayChannels.find((x) => x.id === channelId);
      if (ch) m.channelLabel = ch.label;
    }
    li.mother = m;
  }
  return li;
}
