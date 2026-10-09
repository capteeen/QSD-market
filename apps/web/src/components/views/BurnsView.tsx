'use client';
import { DataRow, Panel } from '@qsd/ui-tokens';
import { BURNS, PAGES } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { formatUnits } from '@/lib/format';
import { useBurns } from '@/hooks/useApi';
import { HalfLifeFigure } from '@/components/home/FeatureSection';
import { ACCENT, PageHero, PageShell } from '@/components/page/PageHero';
import { Empty, LoadingPanel, UnavailablePanel } from '@/components/common';
import { BurnsTerminal } from '@/components/terminal/pages';

export function BurnsView() {
  const q = useBurns();
  const data = q.data;
  const d = data && !isUnavailable(data) ? data : null;
  return (
    <PageShell>
      <PageHero accent={ACCENT.decay} eyebrow={BURNS.eyebrow} title={BURNS.title} body={BURNS.caption} arrows={PAGES.burns.arrows} figure={<HalfLifeFigure />} />
      <div className="qsd-pgrid qsd-pgrid--21">
        <div className="qsd-pblock">
          <BurnsTerminal q={q} />
          {d && d.burns.length === 0 ? (
            <div className="qsd-pblock">
              <Empty eyebrow={BURNS.emptyEyebrow} sentence={BURNS.emptySentence} />
            </div>
          ) : null}
        </div>
        <div className="qsd-pblock">
          {q.isPending ? (
            <LoadingPanel eyebrow={BURNS.eyebrow} />
          ) : !d ? (
            <UnavailablePanel eyebrow={BURNS.unavailableEyebrow} reason={data && isUnavailable(data) ? data.unavailable.reason : 'no response'} />
          ) : (
            <Panel eyebrow={BURNS.eyebrow}>
              <DataRow label={BURNS.total} value={formatUnits(BigInt(d.totalBurned), 6)} unit="$QSD" />
              {d.qsdMint ? <DataRow label={BURNS.qsdCa} value={d.qsdMint} /> : <DataRow label={BURNS.qsdCa} unavailable={{ reason: BURNS.qsdCaUnavailable }} />}
            </Panel>
          )}
        </div>
      </div>
    </PageShell>
  );
}
