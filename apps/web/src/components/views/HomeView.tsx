'use client';
import Link from 'next/link';
import { useMemo, type CSSProperties } from 'react';
import { FIELD, HOME, STORY } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { fieldCoin } from '@/lib/coin';
import { routes } from '@/lib/links';
import { useCoins, useStats } from '@/hooks/useApi';
import { useNow } from '@/hooks/useNow';
import { liveMeasurements } from '@/store/live';
import { FieldScene } from '@/components/scenes';
import { Counters } from '@/components/Counters';
import { LogList } from '@/components/LogList';
import { Empty, UnavailablePanel } from '@/components/common';
import { StackStory } from '@/components/home/StackStory';
import { DaughterFigure, DotGridFigure, FeatureSection, HalfLifeFigure, RangesFigure } from '@/components/home/FeatureSection';
import { XmssVerifyTerminal } from '@/components/terminal/XmssVerifyTerminal';
import { DecayTerminal } from '@/components/terminal/DecayTerminal';
import { ResolverTerminal } from '@/components/terminal/ResolverTerminal';
import { MerkleTerminal } from '@/components/terminal/MerkleTerminal';

/** Per-section accent, as the `--accent` custom property (ui-tokens variables). */
const ACCENT = {
  collapse: { ['--accent' as string]: 'var(--qsd-collapse)' } as CSSProperties,
  decay: { ['--accent' as string]: 'var(--qsd-decay)' } as CSSProperties,
  probability: { ['--accent' as string]: 'var(--qsd-probability)' } as CSSProperties,
  teal: { ['--accent' as string]: 'var(--qsd-teal)' } as CSSProperties,
};

export function HomeView() {
  const coins = useCoins();
  const stats = useStats();
  const now = useNow(5000);
  const fieldCoins = useMemo(() => (coins.data && !isUnavailable(coins.data) ? coins.data.coins.map((c) => fieldCoin(c, now)) : []), [coins.data, now]);
  const nextBurn = stats.data && !isUnavailable(stats.data) ? stats.data.nextBurnAt : null;
  const burnReason = stats.data && isUnavailable(stats.data) ? stats.data.unavailable.reason : HOME.nextBurnUnavailable;
  const F = STORY.features;
  const steps = HOME.steps;

  return (
    <>
      <StackStory nextBurn={nextBurn} burnReason={burnReason} />

      <FeatureSection id="launch" accent={ACCENT.collapse} eyebrow={F.launch.eyebrow} title={F.launch.title} body={steps[0].body} arrows={F.launch.arrows} centre={<RangesFigure />} terminal={<XmssVerifyTerminal />} />
      <FeatureSection id="decay" accent={ACCENT.decay} eyebrow={F.decay.eyebrow} title={F.decay.title} body={steps[1].body} arrows={F.decay.arrows} centre={<HalfLifeFigure />} terminal={<DecayTerminal />} />
      <FeatureSection id="measure" accent={ACCENT.probability} eyebrow={F.measure.eyebrow} title={F.measure.title} body={steps[2].body} arrows={F.measure.arrows} centre={<DotGridFigure />} terminal={<ResolverTerminal />} />
      <FeatureSection id="daughter" accent={ACCENT.teal} eyebrow={F.daughter.eyebrow} title={F.daughter.title} body={steps[3].body} arrows={F.daughter.arrows} centre={<DaughterFigure />} terminal={<MerkleTerminal />} />

      <section id="live" className="qsd-live" data-theme="darkfield">
        <div className="qsd-live__inner">
          <div className="qsd-live__head">
            <div>
              <span className="qsd-eyebrow">{STORY.liveEyebrow}</span>
              <h2 className="qsd-feature__title">{STORY.liveTitle}</h2>
              <p className="qsd-feature__body">{STORY.liveBody}</p>
            </div>
            <Link href={routes.field} className="qsd-btn">
              {STORY.fieldLink} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="qsd-live__field">
            <FieldScene coins={fieldCoins} liveMeasurements={liveMeasurements} showEmptyState={false} />
            {coins.data && !isUnavailable(coins.data) && coins.data.coins.length === 0 ? (
              <div className="qsd-live__state">
                <Empty eyebrow={HOME.fieldEmptyEyebrow} sentence={HOME.fieldEmptySentence} action={{ label: HOME.launch, href: routes.launch }} />
              </div>
            ) : coins.data && isUnavailable(coins.data) ? (
              <div className="qsd-live__state">
                <UnavailablePanel eyebrow={FIELD.unavailableEyebrow} reason={coins.data.unavailable.reason} />
              </div>
            ) : null}
          </div>
          <div className="qsd-live__grid">
            <Counters />
            <LogList />
          </div>
        </div>
      </section>
    </>
  );
}
