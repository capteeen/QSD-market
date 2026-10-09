'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { Countdown, Panel } from '@qsd/ui-tokens';
import { PROTOCOL_PARAMS, collapseRewards, isMeasurable } from '@qsd/protocol';
import { MEASURE } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { liveDecay } from '@/lib/coin';
import { formatBps, formatPercent, formatUnits } from '@/lib/format';
import { routes } from '@/lib/links';
import { useCoins } from '@/hooks/useApi';
import { useNow } from '@/hooks/useNow';
import { Empty, LoadingPanel, Page, PageHeader, UnavailablePanel } from '@/components/common';

export function MeasureQueueView() {
  const q = useCoins();
  const now = useNow();
  const data = q.data;
  const list = useMemo(() => {
    if (!data || isUnavailable(data)) return [];
    return data.coins.filter((c) => isMeasurable(c.state) && c.nextAutoMeasureAt !== null).sort((a, b) => a.nextAutoMeasureAt! - b.nextAutoMeasureAt!);
  }, [data]);
  return (
    <Page wide>
      <PageHeader eyebrow={MEASURE.eyebrow} title={MEASURE.title} />
      <p className="mb-6 text-sm text-muted">{MEASURE.caption}</p>
      {q.isPending ? (
        <LoadingPanel eyebrow={MEASURE.eyebrow} />
      ) : !data || isUnavailable(data) ? (
        <UnavailablePanel eyebrow={MEASURE.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />
      ) : list.length === 0 ? (
        <Empty eyebrow={MEASURE.emptyEyebrow} sentence={MEASURE.emptySentence} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="qsd-table">
              <thead>
                <tr>
                  <th>{MEASURE.cols.coin}</th>
                  <th>{MEASURE.cols.autoAt}</th>
                  <th>{MEASURE.cols.decay}</th>
                  <th>{MEASURE.cols.rewardCollapse}</th>
                  <th>{MEASURE.cols.rewardSurvive}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const r = collapseRewards(BigInt(c.supply.remainingUnits));
                  return (
                    <tr key={c.ca}>
                      <td>
                        <Link className="qsd-link" href={routes.coin(c.ca)}>
                          {c.ticker}
                        </Link>
                      </td>
                      <td>
                        <Countdown size="sm" target={new Date(c.nextAutoMeasureAt! * 1000).toISOString()} />
                      </td>
                      <td>{formatPercent(liveDecay(c, now))}</td>
                      <td>
                        {formatUnits(r.measurerUnits, c.supply.decimals)} {c.ticker}
                      </td>
                      <td>fee rebate {formatBps(PROTOCOL_PARAMS.SURVIVE_FEE_REBATE_BPS, 0)}</td>
                      <td>
                        <Link className="qsd-link" href={routes.coin(c.ca)}>
                          {MEASURE.measureLink}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </Page>
  );
}
