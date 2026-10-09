import 'server-only';
import { db } from './db';
import { chainStatus } from './chain';
import { qrngStatus } from './qrng';
import { redisConfigured } from './redis';
import type { StatsResponse } from '@/lib/types';
import { nowSeconds } from '@/lib/format';

/** The next top of the hour: the burn job is a BullMQ cron at minute 0. Reported only when the burn job is configured to run. */
export function nextBurnAt(): string | null {
  if (!process.env.REDIS_URL || !process.env.QSD_TOKEN_MINT) return null;
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}

export async function computeStats(): Promise<StatsResponse> {
  const now = nowSeconds();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [superposed, measurementsToday, collapses, daughters, tunnels, burned] = await Promise.all([
    db().coin.count({ where: { state: { in: ['superposed', 'measured_alive', 'tunnelled'] } } }),
    db().measurement.count({ where: { at: { gte: Math.floor(dayStart.getTime() / 1000) } } }),
    db().measurement.count({ where: { outcomeKind: 'collapse' } }),
    db().coin.count({ where: { generation: { gt: 1 } } }),
    db().measurement.count({ where: { outcomeKind: 'tunnel' } }),
    db().burn.aggregate({ _sum: { qsdBurned: true } }),
  ]);
  return {
    counters: { superposed, measurementsToday, collapses, daughters, tunnels, qsdBurned: (burned._sum.qsdBurned ?? 0n).toString() },
    nextBurnAt: nextBurnAt(),
    health: { db: true, redis: redisConfigured(), qrng: qrngStatus(), chain: chainStatus() },
    now,
  };
}
