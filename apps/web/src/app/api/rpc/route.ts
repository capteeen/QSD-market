import { NextResponse } from 'next/server';
import { rpcProxyAllows, rpcProxyWithinLimit } from '@/server/rpcProxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST JSON-RPC → Elysium. ELYSIUM_RPC_URL (or an Alchemy key) stays server-side.
 * With neither set, the public relay for the selected network is used. Only the methods
 * a wallet payment needs are relayed, and each client IP is limited per minute.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const { rpcUrlFromEnv } = await import('@/server/chain');
  let upstream: string;
  try {
    upstream = rpcUrlFromEnv(process.env);
  } catch (e) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: e instanceof Error ? e.message : 'Elysium RPC is not configured' } }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, { status: 400 });
  }
  if (!rpcProxyAllows(body)) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'method not relayed' } }, { status: 403 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  if (!(await rpcProxyWithinLimit(ip, Array.isArray(body) ? body.length : 1))) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'rate limited' } }, { status: 429 });
  }
  const res = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}
