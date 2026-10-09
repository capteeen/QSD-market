import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { activityFor, measurementToDto, summaryFromDb } from '@/server/coins';
import { guarded, json } from '@/server/unavailable';
import { nowSeconds } from '@/lib/format';
import type { LineageCollapseDto, LineageResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return guarded(async () => {
    const lineage = await db().lineage.findUnique({ where: { id: params.id } });
    if (!lineage) return NextResponse.json({ error: 'no such lineage' }, { status: 404 });
    const now = nowSeconds();
    const rows = await db().coin.findMany({
      where: { lineageId: params.id },
      orderBy: { generation: 'asc' },
      include: {
        measurements: { orderBy: { index: 'asc' } },
        channels: true,
        allocation: { include: { _count: { select: { entries: true } } } },
        _count: { select: { measurements: true } },
      },
    });
    const coins = await Promise.all(rows.map(async (r) => summaryFromDb(r, await activityFor(r.ca, now))));
    const collapses: LineageCollapseDto[] = [];
    for (const r of rows) {
      const last = r.measurements[r.measurements.length - 1];
      if (r.state !== 'collapsed' || !last || last.outcomeKind !== 'collapse') continue;
      const daughter = rows.find((d) => d.motherCa === r.ca) ?? null;
      const alloc = daughter?.allocation ?? null;
      let weightMinBps: number | null = null;
      let weightMaxBps: number | null = null;
      if (alloc) {
        const agg = await db().allocationEntry.aggregate({ where: { tableId: alloc.id }, _min: { weightBps: true }, _max: { weightBps: true } });
        weightMinBps = agg._min.weightBps;
        weightMaxBps = agg._max.weightBps;
      }
      const outcome = last.outcome as { kind: string; channelId?: string };
      const channel = outcome.channelId ? r.channels.find((c) => c.channelId === outcome.channelId) : undefined;
      collapses.push({
        motherCa: r.ca,
        motherName: r.name,
        motherGeneration: r.generation,
        daughterCa: daughter?.ca ?? r.daughterCa,
        measurement: measurementToDto(last),
        allocation: alloc
          ? {
              merkleRoot: alloc.merkleRoot,
              rootAnchorTx: alloc.rootAnchorTx,
              totalUnits: alloc.totalUnits.toString(),
              allocatedUnits: alloc.allocatedUnits.toString(),
              dustUnits: alloc.dustUnits.toString(),
              leafCount: alloc.leafCount,
              wallets: alloc._count.entries,
              weightMinBps,
              weightMaxBps,
              collapseAt: alloc.collapseAt,
            }
          : null,
        measurementsSurvived: r.measurements.filter((m) => m.outcomeKind === 'survive').length,
        channelLabel: channel?.label ?? null,
      });
    }
    const res: LineageResponse = { id: lineage.id, genesisCa: lineage.genesisCa, coins, collapses, now };
    return json(res);
  });
}
