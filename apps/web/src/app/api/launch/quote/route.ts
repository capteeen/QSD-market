import type { NextResponse } from 'next/server';
import { chainStatus, getChain, serverCluster } from '@/server/chain';
import { genesisStatus } from '@/server/genesis';
import { launchCosts } from '@/server/launch';
import { guarded, json } from '@/server/unavailable';
import type { LaunchQuoteResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Cost breakdown from env; every missing number is reported as missing, never defaulted. */
export async function GET(): Promise<NextResponse> {
  return guarded(async () => {
    const costs = launchCosts();
    const reasons: LaunchQuoteResponse['reasons'] = {};
    if (costs.launchCostLamports === null) reasons.launchCost = 'QSD_LAUNCH_COST_LAMPORTS is unset';
    if (costs.identityReserveLamports === null) reasons.identityReserve = 'QSD_IDENTITY_RESERVE_LAMPORTS is unset';
    if (costs.devBuyLamports === null) reasons.devBuy = 'QSD_LAUNCH_DEV_BUY_LAMPORTS is unset';
    let payTo: string | null = null;
    const cs = chainStatus();
    if (cs.configured) {
      try {
        payTo = (await getChain().creator()).publicKey.toBase58();
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
      devBuyLamports: costs.devBuyLamports?.toString() ?? null,
      payTo: g.error ? null : payTo,
      reasons,
    };
    return json(res);
  });
}
