import 'server-only';
import Redis from 'ioredis';
import type { LiveEvent } from '@/lib/types';

export const EVENTS_CHANNEL = 'qsd:events';

const g = globalThis as unknown as { __qsdRedis?: Redis };

export function redisConfigured(): boolean {
  return !!process.env.REDIS_URL;
}

/** Shared publisher connection. Lazy: nothing connects at import or build time. */
export function redis(): Redis {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is unset');
  if (!g.__qsdRedis) {
    g.__qsdRedis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    g.__qsdRedis.on('error', (e) => console.error('[redis]', e.message));
  }
  return g.__qsdRedis;
}

/** A dedicated subscriber connection (pub/sub blocks the connection). Caller closes it. */
export function redisSubscriber(): Redis {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is unset');
  const sub = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  sub.on('error', (e) => console.error('[redis:sub]', e.message));
  return sub;
}

/** Publish a live event. Failures are logged, never thrown: the write already happened. */
export async function publish(event: LiveEvent): Promise<void> {
  if (!redisConfigured()) return;
  try {
    const r = redis();
    if (r.status === 'wait') await r.connect();
    await r.publish(EVENTS_CHANNEL, JSON.stringify(event));
  } catch (e) {
    console.error('[redis:publish]', e instanceof Error ? e.message : String(e));
  }
}
