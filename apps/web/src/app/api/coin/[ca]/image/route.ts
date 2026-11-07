import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { guarded } from '@/server/unavailable';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { ca: string } }): Promise<NextResponse> {
  return guarded(async () => {
    const img = await db().coinImage.findUnique({ where: { coinCa: params.ca } });
    if (!img) return NextResponse.json({ error: 'no image' }, { status: 404 });
    return new NextResponse(new Uint8Array(img.bytes), { headers: { 'content-type': img.mime, 'cache-control': 'public, max-age=31536000, immutable' } });
  });
}
