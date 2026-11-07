'use client';
import { useMemo } from 'react';
import { isMeasurable } from '@qsd/protocol';
import { MEASURE, PAGES } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { useCoins, useStats } from '@/hooks/useApi';
import { DotGridFigure } from '@/components/home/FeatureSection';
import { ACCENT, PageHero, PageShell } from '@/components/page/PageHero';
import { Empty, LoadingPanel, UnavailablePanel } from '@/components/common';
import { MeasureQueueTerminal, StatusTerminal } from '@/components/terminal/pages';

export function MeasureQueueView() {
  const q = useCoins();
  const stats = useStats();
  const data = q.data;
  const list = useMemo(() => {
    if (!data || isUnavailable(data)) return [];
    return data.coins.filter((c) => isMeasurable(c.state) && c.nextAutoMeasureAt !== null).sort((a, b) => a.nextAutoMeasureAt! - b.nextAutoMeasureAt!);
  }, [data]);
  const loaded = !!data && !isUnavailable(data);
  return (
    <PageShell>
      <PageHero accent={ACCENT.probability} eyebrow={MEASURE.eyebrow} title={MEASURE.title} body={MEASURE.caption} arrows={PAGES.measure.arrows} figure={<DotGridFigure />} />
      <div className="qsd-pgrid qsd-pgrid--21">
        <div className="qsd-pblock">
          <MeasureQueueTerminal q={q} list={list} />
          {q.isPending ? (
            <div className="qsd-pblock">
              <LoadingPanel eyebrow={MEASURE.eyebrow} />
            </div>
          ) : null}
          {!q.isPending && !loaded ? (
            <div className="qsd-pblock">
              <UnavailablePanel eyebrow={MEASURE.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />
            </div>
          ) : null}
          {loaded && list.length === 0 ? (
            <div className="qsd-pblock">
              <Empty eyebrow={MEASURE.emptyEyebrow} sentence={MEASURE.emptySentence} />
            </div>
          ) : null}
        </div>
        <StatusTerminal q={stats} />
      </div>
    </PageShell>
  );
}
