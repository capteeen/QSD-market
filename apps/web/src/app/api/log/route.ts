import type { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { guarded, json } from '@/server/unavailable';
import type { LogResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return guarded(async () => {
    const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? '100') || 100));
    const rows = await db().eventLog.findMany({ orderBy: { at: 'desc' }, take: limit });
    const res: LogResponse = {
      entries: rows.map((r) => ({ id: r.id, type: r.type, at: r.at.toISOString(), coinCa: r.coinCa, refId: r.refId, tx: r.tx, summary: r.summary })),
    };
    return json(res);
  });
}
