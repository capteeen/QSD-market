import { NextResponse, type NextRequest } from 'next/server';
import { isAddress } from 'viem';
import { AuthError, issueChallenge } from '@/server/auth';
import { CHALLENGE_LIMIT_MESSAGE, DAY_MS, LAUNCH_GLOBAL_LIMIT_MESSAGE, LAUNCH_WALLET_LIMIT_MESSAGE, budgetOpen, clientIp, launchGlobalLimit, launchWalletLimit, takeChallengeBudget } from '@/server/budget';
import { guarded, json } from '@/server/unavailable';
import type { LaunchChallengeResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST { wallet, ticker } → a nonce the creator signs before a launch. The signature is bound to the ticker. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guarded(async () => {
    if (!(await takeChallengeBudget(clientIp(req)))) return NextResponse.json({ error: CHALLENGE_LIMIT_MESSAGE }, { status: 429 });
    const body = (await req.json().catch(() => ({}))) as { wallet?: string; ticker?: string };
    const ticker = body.ticker?.trim().toUpperCase() ?? '';
    if (!body.wallet || !ticker) return NextResponse.json({ error: 'wallet and ticker are required' }, { status: 400 });
    if (!isAddress(body.wallet)) return NextResponse.json({ error: 'wallet is not a valid address' }, { status: 400 });
    if (!/^[A-Z0-9]{1,10}$/.test(ticker)) return NextResponse.json({ error: 'ticker must be 1–10 uppercase letters or digits' }, { status: 400 });
    if (!(await budgetOpen(`launch:wallet:${body.wallet.toLowerCase()}`, launchWalletLimit(), DAY_MS))) {
      return NextResponse.json({ error: LAUNCH_WALLET_LIMIT_MESSAGE }, { status: 429 });
    }
    if (!(await budgetOpen('launch:global', launchGlobalLimit(), DAY_MS))) {
      return NextResponse.json({ error: LAUNCH_GLOBAL_LIMIT_MESSAGE }, { status: 429 });
    }
    try {
      const c = await issueChallenge('launch', body.wallet, ticker);
      return json(c satisfies LaunchChallengeResponse);
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
