import { NextResponse, type NextRequest } from 'next/server';
import { MeasurementUnavailableError } from '@qsd/quantum';
import { AuthError, verifyChallenge } from '@/server/auth';
import { MeasureError, performMeasurement } from '@/server/measure';
import { coinToDto, loadCoin, measurementToDto } from '@/server/coins';
import { chainStatus } from '@/server/chain';
import { qrngStatus } from '@/server/qrng';
import { guarded, json, unavailable } from '@/server/unavailable';
import { nowSeconds } from '@/lib/format';
import type { MeasureResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * POST { ca, wallet, nonce, signature } — wallet-signature authenticated.
 * Runs the real measurement (pre-commit anchor → QRNG draw → proof anchor →
 * apply) and returns the Measurement with both transaction signatures.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guarded(async () => {
    const body = (await req.json().catch(() => ({}))) as { ca?: string; wallet?: string; nonce?: string; signature?: string };
    if (!body.ca) return NextResponse.json({ error: 'ca is required' }, { status: 400 });
    if (!body.wallet || !body.nonce || !body.signature) {
      return NextResponse.json({ error: 'wallet authentication required: wallet, nonce and signature' }, { status: 401 });
    }
    try {
      await verifyChallenge({ purpose: 'measure', wallet: body.wallet, subject: body.ca, nonce: body.nonce, signature: body.signature });
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
      throw e;
    }
    const q = qrngStatus();
    if (!q.configured) return unavailable(`the quantum random number provider is not configured (${q.reason ?? 'unknown'})`);
    const c = chainStatus();
    if (!c.configured) return unavailable(`the chain is not configured (${c.reason ?? 'unknown'})`);
    try {
      const r = await performMeasurement(body.ca, body.wallet);
      const row = await loadCoin(body.ca);
      if (!row) return NextResponse.json({ error: 'coin vanished' }, { status: 500 });
      const m = row.measurements.find((x) => x.id === r.measurement.id);
      if (!m) return NextResponse.json({ error: 'measurement not persisted' }, { status: 500 });
      const res: MeasureResponse = { measurement: measurementToDto(m), coin: await coinToDto(row, nowSeconds()), daughterLaunch: r.daughterLaunch };
      return json(res);
    } catch (e) {
      if (e instanceof MeasureError) return NextResponse.json({ error: e.message }, { status: 409 });
      if (e instanceof MeasurementUnavailableError) return unavailable(e.message);
      throw e;
    }
  });
}
