import type { NextResponse } from 'next/server';
import { chainStatus, getChain, serverCluster } from '@/server/chain';
import { genesisStatus } from '@/server/genesis';
import { launchCosts, launchPresets } from '@/server/launch';
import { guarded, json } from '@/server/unavailable';
import type { LaunchQuoteResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Cost breakdown from env; every missing number is reported as missing, never defaulted. */
export async function GET(): Promise<NextResponse> {
  return guarded(async () => {
    const costs = launchCosts();
    const reasons: LaunchQuoteResponse['reasons'] = {};
    if (costs.launchCostLamports === null) reasons.launchCost = 'the launch cost is not set';
    if (costs.identityReserveLamports === null) reasons.identityReserve = 'the identity reserve is not set';
    let payTo: string | null = null;
    const cs = chainStatus();
    if (cs.configured) {
      try {
        payTo = getChain().creatorAddress();
      } catch (e) {
        reasons.payTo = `protocol creator key not loadable (${e instanceof Error ? e.message : String(e)})`;
      }
    } else reasons.payTo = cs.reason ?? 'chain not configured';
    const g = genesisStatus();
    if (g.error) reasons.payTo = reasons.payTo ? `${reasons.payTo}; ${g.error}` : g.error;
    const res: LaunchQuoteResponse = {
      cluster: serverCluster(),
      launchCostLamports: costs.launchCostLamports?.toString() ?? null,
      identityReserveLamports: costs.identityReserveLamports?.toString() ?? null,
      devBuyLamports: null,
      presets: launchPresets().map((p) => ({ id: p.id, label: p.label, maxWindowSec: p.maxWindowSec })),
      payTo: g.error ? null : payTo,
      reasons,
    };
    return json(res);
  });
}
