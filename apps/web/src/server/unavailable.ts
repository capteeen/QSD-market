import 'server-only';
import { NextResponse } from 'next/server';
import { dbUnavailableReason, isDbUnavailable } from './db';

/** The honest 503: `{ unavailable: { reason } }`. Pages render the kit's unavailable state from it. */
export function unavailable(reason: string, status = 503): NextResponse {
  return NextResponse.json({ unavailable: { reason } }, { status });
}

/** JSON with bigint support (decimal strings). */
export function json(data: unknown, init?: ResponseInit): NextResponse {
  const body = JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  return new NextResponse(body, { ...init, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(init?.headers ?? {}) } });
}

/**
 * Run a handler; a database connection failure becomes a 503 unavailable
 * response instead of a crash. Other errors are reported as 500 with their
 * message (never a stack).
 */
export async function guarded(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (isDbUnavailable(e)) return unavailable(dbUnavailableReason(e));
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
