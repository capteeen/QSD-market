'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Countdown, Panel } from '@qsd/ui-tokens';
import { FIELD } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { fieldCoin, liveDecay, uncertainty } from '@/lib/coin';
import { formatHalfLife, formatPercent } from '@/lib/format';
import { routes } from '@/lib/links';
import { useCoins } from '@/hooks/useApi';
import { useNow } from '@/hooks/useNow';
import { liveMeasurements } from '@/store/live';
import { FieldScene } from '@/components/scenes';
import { Empty, LoadingPanel, Page, PageHeader, StateLabel, UnavailablePanel } from '@/components/common';
import type { CoinSummaryDto } from '@/lib/types';

type Filter = 'all' | 'superposed' | 'collapsed' | 'tunnelled';
type Sort = 'uncertainty' | 'halfLife' | 'decay';

function matches(c: CoinSummaryDto, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'superposed') return c.state === 'superposed' || c.state === 'measured-alive';
  return c.state === f;
}

export function FieldView() {
  const q = useCoins();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('decay');
  const data = q.data;
  const list = useMemo(() => {
    if (!data || isUnavailable(data)) return [];
    const rows = data.coins.filter((c) => matches(c, filter));
    const key = (c: CoinSummaryDto): number => (sort === 'uncertainty' ? uncertainty(c.superposition) : sort === 'halfLife' ? c.halfLifeSec : liveDecay(c, now));
    return rows.sort((a, b) => key(b) - key(a));
  }, [data, filter, sort, now]);

  return (
    <Page wide>
      <PageHeader eyebrow={FIELD.eyebrow} title={FIELD.title}>
        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-2 text-muted">
            {FIELD.filterLabel}
            <select className="qsd-input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">{FIELD.filterAll}</option>
              <option value="superposed">{FIELD.filterSuperposed}</option>
              <option value="collapsed">{FIELD.filterCollapsed}</option>
              <option value="tunnelled">{FIELD.filterTunnelled}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-muted">
            {FIELD.sortLabel}
            <select className="qsd-input w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="uncertainty">{FIELD.sortUncertainty}</option>
              <option value="halfLife">{FIELD.sortHalfLife}</option>
              <option value="decay">{FIELD.sortDecay}</option>
            </select>
          </label>
        </div>
      </PageHeader>
      <div className="mb-6 h-[50vh] min-h-[360px] w-full border-card border-border">
        <FieldScene coins={list.map((c) => fieldCoin(c, now))} liveMeasurements={liveMeasurements} showEmptyState={false} />
      </div>
      {q.isPending ? (
        <LoadingPanel eyebrow={FIELD.eyebrow} />
      ) : !data || isUnavailable(data) ? (
        <UnavailablePanel eyebrow={FIELD.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />
      ) : data.coins.length === 0 ? (
        <Empty eyebrow={FIELD.emptyEyebrow} sentence={FIELD.emptySentence} action={{ label: 'Launch', href: routes.launch }} />
      ) : list.length === 0 ? (
        <Empty eyebrow={FIELD.emptyFilteredEyebrow} sentence={FIELD.emptyFilteredSentence} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="qsd-table">
              <thead>
                <tr>
                  <th>{FIELD.columns.coin}</th>
                  <th>{FIELD.columns.state}</th>
                  <th>{FIELD.columns.generation}</th>
                  <th>{FIELD.columns.halfLife}</th>
                  <th>{FIELD.columns.decay}</th>
                  <th>{FIELD.columns.uncertainty}</th>
                  <th>{FIELD.columns.nextAuto}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.ca}>
                    <td>
                      <Link className="qsd-link" href={routes.coin(c.ca)}>
                        {c.ticker}
                      </Link>{' '}
                      <span className="text-muted">{c.name}</span>
                    </td>
                    <td>
                      <StateLabel state={c.state} />
                    </td>
                    <td>{c.generation}</td>
                    <td>{formatHalfLife(c.halfLifeSec)}</td>
                    <td>{formatPercent(liveDecay(c, now))}</td>
                    <td>{formatPercent(uncertainty(c.superposition))}</td>
                    <td>
                      {c.nextAutoMeasureAt !== null ? (
                        <Countdown size="sm" target={new Date(c.nextAutoMeasureAt * 1000).toISOString()} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </Page>
  );
}
