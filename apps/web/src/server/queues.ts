import 'server-only';
import { Queue, type JobsOptions } from 'bullmq';

/** BullMQ queue names. Workers live in src/workers/index.ts (`pnpm --filter web worker`). */
export const QUEUES = {
  ingestTrades: 'ingest-trades',
  autoMeasure: 'auto-measure',
  collapse: 'collapse',
  hourlyBurn: 'hourly-burn',
  snapshot: 'snapshot',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobData {
  'ingest-trades': { buys: { mint: string; buyer: string; lamports: string; slot: number; signature: string; timestamp: number; tokenUnits?: string; tokenUiAmount: number; source?: string }[] };
  'auto-measure': Record<string, never>;
  collapse: { ca: string };
  'hourly-burn': Record<string, never>;
  snapshot: { ca: string };
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

/** Enqueue; failures are logged, never thrown (the caller's write already happened). */
export async function enqueue<N extends QueueName>(name: N, data: JobData[N], opts?: JobsOptions): Promise<void> {
  if (!process.env.REDIS_URL) {
    console.warn(`[queues] REDIS_URL unset: job ${name} not enqueued`);
    return;
  }
  try {
    await (queue(name) as Queue).add(name, data, { removeOnComplete: 100, removeOnFail: 500, ...opts });
  } catch (e) {
    console.error('[queues]', name, e instanceof Error ? e.message : String(e));
  }
}
