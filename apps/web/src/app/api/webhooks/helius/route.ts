import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Trade indexing is not configured for this deployment.
 * Elysium trade indexing is not configured, so this route accepts nothing and writes nothing.
 */
export async function POST(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Trade indexing is not configured. No trade was stored.' },
    { status: 501 },
  );
}
