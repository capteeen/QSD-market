import 'server-only';
import { Queue, type JobsOptions } from 'bullmq';

/** BullMQ queue names. Workers live in src/workers/index.ts (`pnpm --filter web worker`). */
export const QUEUES = {
  ingestTrades: 'ingest-trades',
  autoMeasure: 'auto-measure',
  collapse: 'collapse',
  hourlyBurn: 'hourly-burn',
  snapshot: 'snapshot',
  reconcileCollapses: 'reconcile-collapses',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobData {
  'ingest-trades': { buys: { mint: string; buyer: string; lamports: string; slot: number; signature: string; timestamp: number; tokenUnits?: string; tokenUiAmount: number; source?: string }[] };
  'auto-measure': Record<string, never>;
  collapse: { ca: string };
  'hourly-burn': Record<string, never>;
  snapshot: { ca: string };
  'reconcile-collapses': Record<string, never>;
}

export function bullConnection(): { host: string; port: number; password?: string; username?: string; tls?: Record<string, never> } {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is unset');
  const u = new URL(url);
  const out: ReturnType<typeof bullConnection> = { host: u.hostname, port: Number(u.port || 6379) };
  if (u.password) out.password = decodeURIComponent(u.password);
  if (u.username) out.username = decodeURIComponent(u.username);
  if (u.protocol === 'rediss:') out.tls = {};
  return out;
}

const g = globalThis as unknown as { __qsdQueues?: Map<string, Queue> };

export function queue<N extends QueueName>(name: N): Queue<JobData[N]> {
  g.__qsdQueues ??= new Map();
  let q = g.__qsdQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection() });
    g.__qsdQueues.set(name, q);
  }
  return q as Queue<JobData[N]>;
}

export interface EnqueueOptions extends JobsOptions {
  /**
   * Called with the reason when the job could NOT be scheduled (no REDIS_URL,
   * Redis unreachable, BullMQ error). The caller's own write has already
   * happened by then, so enqueue never throws; a caller that must tell the
   * user (the measurement response: "daughter launch not scheduled") passes
   * this and reports it. The reconciliation job re-enqueues collapsed coins
   * without a daughter later (src/server/reconcile.ts).
   */
  onFailure?: (reason: string) => void;
}

/** Enqueue; failures are logged and reported through `onFailure`, never thrown (the caller's write already happened). */
export async function enqueue<N extends QueueName>(name: N, data: JobData[N], opts?: EnqueueOptions): Promise<void> {
  const { onFailure, ...jobOpts } = opts ?? {};
  if (!process.env.REDIS_URL) {
    console.warn(`[queues] REDIS_URL unset: job ${name} not enqueued`);
    onFailure?.('REDIS_URL is unset: no queue is configured');
    return;
  }
  try {
    await (queue(name) as Queue).add(name, data, { removeOnComplete: 100, removeOnFail: 500, ...jobOpts });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[queues]', name, reason);
    onFailure?.(`the queue refused the job: ${reason}`);
  }
}
