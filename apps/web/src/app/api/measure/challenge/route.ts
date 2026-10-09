import { NextResponse, type NextRequest } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { issueChallenge } from '@/server/auth';
import { guarded, json } from '@/server/unavailable';
import type { MeasureChallengeResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST { wallet, ca } → a nonce + message to sign with the wallet (valid 5 minutes, single use). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guarded(async () => {
    const body = (await req.json().catch(() => ({}))) as { wallet?: string; ca?: string };
    if (!body.wallet || !body.ca) return NextResponse.json({ error: 'wallet and ca are required' }, { status: 400 });
    try {
      new PublicKey(body.wallet);
    } catch {
      return NextResponse.json({ error: 'wallet is not a valid public key' }, { status: 400 });
    }
    const c = await issueChallenge('measure', body.wallet, body.ca);
    return json(c satisfies MeasureChallengeResponse);
  });
}
