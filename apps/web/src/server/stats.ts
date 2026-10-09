import 'server-only';
import { db } from './db';
import { chainStatus } from './chain';
import { qrngStatus } from './qrng';
import { redisConfigured } from './redis';
import { scheduledBurnAt } from './burnSchedule';
import type { StatsResponse } from '@/lib/types';
import { nowSeconds } from '@/lib/format';

/**
 * The slot the hourly-burn cron (`0 * * * *`) would fire at next, from the
 * configuration alone. NOT what the home page shows: `computeStats` reports
 * the scheduler's own `next` (burnSchedule.ts) so the countdown exists only
 * when a worker has registered the job. This helper is what the worker logs
 * when it registers the cron, so the two can be compared in the logs.
 */
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
  const [superposed, measurementsToday, collapses, daughters, tunnels, burned, burnAt] = await Promise.all([
    db().coin.count({ where: { state: { in: ['superposed', 'measured_alive', 'tunnelled'] } } }),
    db().measurement.count({ where: { at: { gte: Math.floor(dayStart.getTime() / 1000) } } }),
    db().measurement.count({ where: { outcomeKind: 'collapse' } }),
    db().coin.count({ where: { generation: { gt: 1 } } }),
    db().measurement.count({ where: { outcomeKind: 'tunnel' } }),
    db().burn.aggregate({ _sum: { qsdBurned: true } }),
    scheduledBurnAt(),
  ]);
  return {
    counters: { superposed, measurementsToday, collapses, daughters, tunnels, qsdBurned: (burned._sum.qsdBurned ?? 0n).toString() },
    nextBurnAt: burnAt,
    health: { db: true, redis: redisConfigured(), qrng: qrngStatus(), chain: chainStatus() },
    now,
  };
}
