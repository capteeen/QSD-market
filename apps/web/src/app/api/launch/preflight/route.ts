import { NextResponse, type NextRequest } from 'next/server';
import { launchPreflight, tickerTaken, tickerTakenMessage } from '@/server/launch';
import { guarded, json } from '@/server/unavailable';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → { ok, problems[] }: whether a launch can run right now. The launch page calls it before asking the wallet to pay. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return guarded(async () => {
    const result = await launchPreflight();
    const ticker = new URL(req.url).searchParams.get('ticker')?.trim().toUpperCase() ?? '';
    if (ticker && (await tickerTaken(ticker))) {
      return json({ ok: false, problems: [...result.problems, tickerTakenMessage(ticker)] });
    }
    return json(result);
  });
}
