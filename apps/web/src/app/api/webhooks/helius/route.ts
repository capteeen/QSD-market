import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Solana / Helius indexing is not the chain this app settles on.
 * Elysium trade indexing is not configured, so this route accepts nothing and writes nothing.
 */
export async function POST(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Elysium trade indexing is not configured. Solana webhooks are not accepted, and no trade was stored.' },
    { status: 501 },
  );
}
