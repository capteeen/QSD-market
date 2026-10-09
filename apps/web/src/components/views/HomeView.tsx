'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { Countdown, Panel } from '@qsd/ui-tokens';
import { FIELD, HOME } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { fieldCoin } from '@/lib/coin';
import { routes } from '@/lib/links';
import { useCoins, useStats } from '@/hooks/useApi';
import { useNow } from '@/hooks/useNow';
import { liveMeasurements } from '@/store/live';
import { FieldScene } from '@/components/scenes';
import { Counters } from '@/components/Counters';
import { LogList } from '@/components/LogList';
import { Empty, Page, UnavailablePanel } from '@/components/common';

export function HomeView() {
  const coins = useCoins();
  const stats = useStats();
  const now = useNow(5000);
  const fieldCoins = useMemo(() => (coins.data && !isUnavailable(coins.data) ? coins.data.coins.map((c) => fieldCoin(c, now)) : []), [coins.data, now]);
  const nextBurn = stats.data && !isUnavailable(stats.data) ? stats.data.nextBurnAt : null;
  const burnReason = stats.data && isUnavailable(stats.data) ? stats.data.unavailable.reason : HOME.nextBurnUnavailable;

  return (
    <>
      <section className="relative w-full lg:h-[78vh] lg:min-h-[560px]">
        {/* phones: the scene sits above the copy; lg and up: full-bleed, the copy over its left side */}
        <div className="relative h-[52vh] min-h-[340px] lg:absolute lg:inset-0 lg:h-auto">
          <FieldScene coins={fieldCoins} liveMeasurements={liveMeasurements} showEmptyState={false} shiftX={0.17} shiftMinWidth={1024} />
        </div>
        <div className="relative flex max-w-md flex-col gap-3 px-4 pb-6 sm:px-8 lg:absolute lg:left-[6vw] lg:top-[10vh] lg:p-0">
          <div className="qsd-glass p-6">
            <span className="qsd-eyebrow">{HOME.eyebrow}</span>
            <h1 className="mt-2 text-3xl">{HOME.h1}</h1>
            <p className="mt-3 text-sm leading-relaxed">{HOME.sentence}</p>
            <div className="mt-5 flex gap-3">
              <Link href={routes.launch} className="qsd-btn" data-primary="true">
                {HOME.launch}
              </Link>
              <Link href={routes.how} className="qsd-btn">
                {HOME.how}
              </Link>
            </div>
            <div className="mt-5 flex items-baseline gap-3 text-xs text-muted">
              <span className="uppercase tracking-widest">{HOME.nextBurnLabel}</span>
              <Countdown size="sm" {...(nextBurn ? { target: nextBurn } : { unavailable: { reason: burnReason } })} />
            </div>
          </div>
          {coins.data && !isUnavailable(coins.data) && coins.data.coins.length === 0 ? (
            <Empty eyebrow={HOME.fieldEmptyEyebrow} sentence={HOME.fieldEmptySentence} action={{ label: HOME.launch, href: routes.launch }} />
          ) : coins.data && isUnavailable(coins.data) ? (
            <UnavailablePanel eyebrow={FIELD.unavailableEyebrow} reason={coins.data.unavailable.reason} />
          ) : null}
        </div>
      </section>
      <Page>
        <Panel eyebrow={HOME.stepsEyebrow}>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {HOME.steps.map((s, i) => (
              <li key={s.title}>
                <span className="text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-1 text-lg">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Panel>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_2fr]">
          <Counters />
          <LogList />
        </div>
      </Page>
    </>
  );
}
