import { NextResponse, type NextRequest } from 'next/server';
import { isAddress } from 'viem';
import { AuthError, issueChallenge } from '@/server/auth';
import { CHALLENGE_LIMIT_MESSAGE, clientIp, takeChallengeBudget } from '@/server/budget';
import { guarded, json } from '@/server/unavailable';
import type { MeasureChallengeResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST { wallet, ca } → a nonce + message to sign with the wallet (valid 5 minutes, single use). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guarded(async () => {
    const body = (await req.json().catch(() => ({}))) as { wallet?: string; ca?: string };
    if (!(await takeChallengeBudget(clientIp(req)))) return NextResponse.json({ error: CHALLENGE_LIMIT_MESSAGE }, { status: 429 });
    if (!body.wallet || !body.ca) return NextResponse.json({ error: 'wallet and ca are required' }, { status: 400 });
    if (!isAddress(body.wallet)) return NextResponse.json({ error: 'wallet is not a valid address' }, { status: 400 });
    try {
      const c = await issueChallenge('measure', body.wallet, body.ca);
      return json(c satisfies MeasureChallengeResponse);
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
