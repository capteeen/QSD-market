'use client';
import { useMemo } from 'react';
import { isMeasurable } from '@qsd/protocol';
import { MEASURE } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { useCoins, useStats } from '@/hooks/useApi';
import { Page, PageHeader } from '@/components/common';
import { MeasureQueueTerminal, StatusTerminal } from '@/components/terminal/pages';

export function MeasureQueueView() {
  const q = useCoins();
  const stats = useStats();
  const data = q.data;
  const list = useMemo(() => {
    if (!data || isUnavailable(data)) return [];
    return data.coins.filter((c) => isMeasurable(c.state) && c.nextAutoMeasureAt !== null).sort((a, b) => a.nextAutoMeasureAt! - b.nextAutoMeasureAt!);
  }, [data]);
  return (
    <Page wide>
      <PageHeader eyebrow={MEASURE.eyebrow} title={MEASURE.title} />
      <p className="mb-6 text-sm text-muted">{MEASURE.caption}</p>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <MeasureQueueTerminal q={q} list={list} />
        <StatusTerminal q={stats} />
      </div>
    </Page>
  );
}
