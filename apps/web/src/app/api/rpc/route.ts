import { NextResponse } from 'next/server';
import { rpcProxyAllows, rpcProxyWithinLimit } from '@/server/rpcProxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST JSON-RPC → the server's SOLANA_RPC_URL. The browser's wallet connection
 * uses this when NEXT_PUBLIC_SOLANA_RPC_URL is unset, so the RPC key never
 * reaches the browser and the public mainnet endpoint (which refuses browsers
 * with 403) is never used. Only the methods a wallet payment needs are relayed,
 * and each client IP is limited per minute so nobody can spend the RPC quota.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const upstream = process.env.SOLANA_RPC_URL?.trim();
  if (!upstream) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'SOLANA_RPC_URL is not configured' } }, { status: 503 });
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
