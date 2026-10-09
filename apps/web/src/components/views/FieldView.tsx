'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Countdown, Panel } from '@qsd/ui-tokens';
import { FIELD, PAGES } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { coinTree, fieldCoin, liveDecay, uncertainty } from '@/lib/coin';
import { formatHalfLife, formatPercent } from '@/lib/format';
import { routes } from '@/lib/links';
import { useCoins, useStats } from '@/hooks/useApi';
import { StatusTerminal } from '@/components/terminal/pages';
import { LogList } from '@/components/LogList';
import { useNow } from '@/hooks/useNow';
import { liveMeasurements } from '@/store/live';
import { FieldScene } from '@/components/scenes';
import { DotGridFigure } from '@/components/home/FeatureSection';
import { ACCENT, PageHero, PageShell } from '@/components/page/PageHero';
import { Empty, LoadingPanel, StateLabel, UnavailablePanel } from '@/components/common';
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
  const stats = useStats();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('decay');
  const data = q.data;
  const list = useMemo(() => {
    if (!data || isUnavailable(data)) return [];
    const rows = data.coins.filter((c) => matches(c, filter));
    const key = (c: CoinSummaryDto): number => (sort === 'uncertainty' ? uncertainty(c.superposition) : sort === 'halfLife' ? c.halfLifeSec : liveDecay(c, now));
    // Mothers are ordered by the chosen key; each daughter follows the coin it was born from.
    return coinTree(rows, (a, b) => key(b) - key(a));
  }, [data, filter, sort, now]);

  return (
    <PageShell>
      <PageHero accent={ACCENT.probability} eyebrow={FIELD.eyebrow} title={FIELD.title} body={PAGES.field.body} arrows={PAGES.field.arrows} figure={<DotGridFigure />}>
        <div className="qsd-filters">
          <label>
            {FIELD.filterLabel}
            <select className="qsd-input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">{FIELD.filterAll}</option>
              <option value="superposed">{FIELD.filterSuperposed}</option>
              <option value="collapsed">{FIELD.filterCollapsed}</option>
              <option value="tunnelled">{FIELD.filterTunnelled}</option>
            </select>
          </label>
          <label>
            {FIELD.sortLabel}
            <select className="qsd-input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="uncertainty">{FIELD.sortUncertainty}</option>
              <option value="halfLife">{FIELD.sortHalfLife}</option>
              <option value="decay">{FIELD.sortDecay}</option>
            </select>
          </label>
        </div>
      </PageHero>
      <div className="qsd-pscene">
        <FieldScene coins={list.map((r) => fieldCoin(r.coin, now))} liveMeasurements={liveMeasurements} showEmptyState={false} />
      </div>
      <div className="qsd-pgrid qsd-pgrid--12">
        <StatusTerminal q={stats} />
        <LogList limit={20} />
      </div>
      <div className="qsd-pblock">
        {q.isPending ? (
          <LoadingPanel eyebrow={FIELD.eyebrow} />
        ) : !data || isUnavailable(data) ? (
          <UnavailablePanel eyebrow={FIELD.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />
        ) : data.coins.length === 0 ? (
          <Empty eyebrow={FIELD.emptyEyebrow} sentence={FIELD.emptySentence} action={{ label: 'Launch', href: routes.launch }} />
        ) : list.length === 0 ? (
          <Empty eyebrow={FIELD.emptyFilteredEyebrow} sentence={FIELD.emptyFilteredSentence} />
        ) : (
          <Panel eyebrow={FIELD.eyebrow}>
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
                  {list.map(({ coin: c, depth, last }) => (
                    <tr key={c.ca} data-depth={Math.min(depth, 4)} data-last={last ? 'true' : 'false'}>
                      <td className="qsd-table__tree">
                        {depth > 0 ? <span className="qsd-launched__tree" aria-hidden="true" /> : null}
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
                      <td>{c.nextAutoMeasureAt !== null ? <Countdown size="sm" target={new Date(c.nextAutoMeasureAt * 1000).toISOString()} /> : <span className="text-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
