import 'server-only';
import { readFileSync } from 'node:fs';
import { validateChannels, PROTOCOL_PARAMS, type Channel } from '@qsd/protocol';

/**
 * Generation-1 launch parameters. @qsd/protocol defines how daughters inherit
 * a lineage's channel table but not what a genesis table is; that is an
 * operator configuration, read from the JSON file named by
 * `QSD_GENESIS_CONFIG`. Nothing is defaulted: without the file, /launch is
 * unavailable and says so.
 *
 * File shape:
 * {
 *   "supplyUnits": "1000000000000000",   // devnet mint supply, base units (mainnet: pump.fun decides)
 *   "decimals": 6,
 *   "poolUnits": { "min": "...", "max": "..." },   // genesis superposition band outer bounds
 *   "channels": [ { "id": "...", "probabilityPpm": 500000, "label": "...",
 *                   "halfLifeSec": { "min": 3600, "max": 604800 },
 *                   "poolUnits": { "min": "...", "max": "..." } } ]
 * }
 */
export interface GenesisConfig {
  supplyUnits: bigint;
  decimals: number;
  poolUnits: { min: bigint; max: bigint };
  channels: Channel[];
}

interface RawChannel {
  id: string;
  probabilityPpm: number;
  label: string;
  halfLifeSec: { min: number; max: number };
  poolUnits: { min: string; max: string };
}

let cached: { config?: GenesisConfig; error?: string } | undefined;

export function genesisConfig(): GenesisConfig {
  const s = genesisStatus();
  if (!s.config) throw new Error(s.error ?? 'genesis config unavailable');
  return s.config;
}

export function genesisStatus(): { config?: GenesisConfig; error?: string } {
  if (cached) return cached;
  const file = process.env.QSD_GENESIS_CONFIG;
  if (!file) return (cached = { error: 'QSD_GENESIS_CONFIG is unset: no generation-1 channel table is configured' });
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      supplyUnits: string;
      decimals: number;
      poolUnits: { min: string; max: string };
      channels: RawChannel[];
    };
    const channels: Channel[] = raw.channels.map((c) => ({
      id: c.id,
      probabilityPpm: c.probabilityPpm,
      label: c.label,
      daughterParams: {
        halfLifeSec: { min: c.halfLifeSec.min, max: c.halfLifeSec.max },
        poolUnits: { min: BigInt(c.poolUnits.min), max: BigInt(c.poolUnits.max) },
      },
    }));
    validateChannels(channels.map((c) => ({ id: c.id, probabilityPpm: c.probabilityPpm })));
    for (const c of channels) {
      if (c.daughterParams.halfLifeSec.min < PROTOCOL_PARAMS.HALF_LIFE_MIN_SEC || c.daughterParams.halfLifeSec.max > PROTOCOL_PARAMS.HALF_LIFE_MAX_SEC) {
        throw new Error(`channel ${c.id}: half-life range outside the protocol bounds`);
      }
      if (c.daughterParams.poolUnits.min < 0n || c.daughterParams.poolUnits.max < c.daughterParams.poolUnits.min) throw new Error(`channel ${c.id}: bad pool range`);
    }
    const pool = { min: BigInt(raw.poolUnits.min), max: BigInt(raw.poolUnits.max) };
    if (pool.min < 0n || pool.max < pool.min) throw new Error('poolUnits: bad range');
    const supplyUnits = BigInt(raw.supplyUnits);
    if (supplyUnits <= 0n) throw new Error('supplyUnits must be positive');
    if (!Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 9) throw new Error('decimals must be 0..9');
    return (cached = { config: { supplyUnits, decimals: raw.decimals, poolUnits: pool, channels } });
  } catch (e) {
    return (cached = { error: `QSD_GENESIS_CONFIG could not be loaded: ${e instanceof Error ? e.message : String(e)}` });
  }
}
