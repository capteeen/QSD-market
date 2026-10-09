import { NextResponse, type NextRequest } from 'next/server';
import { parseHeliusWebhook, WebhookAuthError } from '@qsd/solana';
import { ingestBuy } from '@/server/trades';
import { enqueue } from '@/server/queues';
import { isDbUnavailable } from '@/server/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Helius enhanced-transaction webhook. Authenticated with the `Authorization`
 * header against QSD_WEBHOOK_SECRET (constant-time, in @qsd/solana). Each buy
 * is stored, the Zeno reset applied, and the event published. If the
 * database is unreachable the buys are queued for the worker instead.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 });
  }
  let buys;
  try {
    buys = parseHeliusWebhook(body, req.headers.get('authorization') ?? undefined, { secret: process.env.QSD_WEBHOOK_SECRET });
  } catch (e) {
    if (e instanceof WebhookAuthError) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  let stored = 0;
  let applied = 0;
  const queued: typeof buys = [];
  for (const buy of buys) {
    try {
      const r = await ingestBuy(buy);
      if (r.stored) stored++;
      if (r.applied) applied++;
    } catch (e) {
      if (isDbUnavailable(e)) queued.push(buy);
      else console.error('[webhook]', e instanceof Error ? e.message : String(e));
    }
  }
  if (queued.length) {
    await enqueue('ingest-trades', {
      buys: queued.map((b) => ({
        mint: b.mint,
        buyer: b.buyer,
        lamports: b.lamports.toString(),
        slot: b.slot,
        signature: b.signature,
        timestamp: b.timestamp,
        tokenUiAmount: b.tokenUiAmount,
        ...(b.tokenUnits !== undefined ? { tokenUnits: b.tokenUnits.toString() } : {}),
        ...(b.source !== undefined ? { source: b.source } : {}),
      })),
    });
  }
  return NextResponse.json({ received: buys.length, stored, applied, queued: queued.length });
}
