import 'server-only';
import { bullConnection, QUEUES } from './queues';
import { Queue } from 'bullmq';

/** The repeatable job id the worker registers for the hourly burn (src/workers/index.ts). */
export const HOURLY_BURN_JOB_ID = 'hourly-burn-cron';

const LOOKUP_TIMEOUT_MS = 2_500;

/**
 * H-W8: the next burn time comes from the scheduler, not from configuration.
 * It is the `next` timestamp of the hourly-burn repeatable job as BullMQ holds
 * it in Redis — present only if a worker registered the cron. No Redis, no
 * registered job, or a lookup that fails or hangs → null (the page shows the
 * countdown as unavailable rather than counting down to a burn nobody runs).
 */
export async function scheduledBurnAt(): Promise<string | null> {
  if (!process.env.REDIS_URL || !process.env.QSD_TOKEN_MINT) return null;
  let q: Queue | null = null;
  try {
    q = new Queue(QUEUES.hourlyBurn, { connection: { ...bullConnection(), maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: LOOKUP_TIMEOUT_MS } });
    const jobs = await Promise.race([
      q.getRepeatableJobs(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('scheduler lookup timed out')), LOOKUP_TIMEOUT_MS)),
    ]);
    const cron = jobs.find((j) => j.id === HOURLY_BURN_JOB_ID) ?? jobs.find((j) => j.pattern === '0 * * * *');
    if (!cron || typeof cron.next !== 'number' || cron.next <= Date.now()) return null;
    return new Date(cron.next).toISOString();
  } catch (e) {
    console.warn('[burn-schedule]', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    if (q) await q.close().catch(() => undefined);
  }
}
