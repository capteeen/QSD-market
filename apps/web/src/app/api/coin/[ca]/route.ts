import { NextResponse } from 'next/server';
import { coinToDto, loadCoin } from '@/server/coins';
import { guarded, json } from '@/server/unavailable';
import { nowSeconds } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { ca: string } }): Promise<NextResponse> {
  return guarded(async () => {
    const row = await loadCoin(params.ca);
    if (!row) return NextResponse.json({ error: 'no such coin' }, { status: 404 });
    return json(await coinToDto(row, nowSeconds()));
  });
}
