import type { NextRequest } from 'next/server';
import { EVENTS_CHANNEL, redisSubscriber, redisConfigured } from '@/server/redis';
import type { LiveEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 15_000;

/** Server-Sent Events from the Redis `qsd:events` channel, with a heartbeat. 503 when Redis is not configured. */
export async function GET(req: NextRequest): Promise<Response> {
  if (!redisConfigured()) {
    return new Response(JSON.stringify({ unavailable: { reason: 'the live event stream is not configured (REDIS_URL is unset)' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  const sub = redisSubscriber();
  try {
    await sub.connect();
    await sub.subscribe(EVENTS_CHANNEL);
  } catch (e) {
    sub.disconnect();
    return new Response(JSON.stringify({ unavailable: { reason: `the live event stream is not reachable (${e instanceof Error ? e.message : String(e)})` } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (ev: LiveEvent): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* closed */
        }
      };
      sub.on('message', (_channel: string, message: string) => {
        try {
          send(JSON.parse(message) as LiveEvent);
        } catch {
          /* malformed */
        }
      });
      send({ type: 'heartbeat', at: new Date().toISOString() });
      heartbeat = setInterval(() => send({ type: 'heartbeat', at: new Date().toISOString() }), HEARTBEAT_MS);
      req.signal.addEventListener('abort', () => {
        if (heartbeat) clearInterval(heartbeat);
        sub.disconnect();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      sub.disconnect();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
