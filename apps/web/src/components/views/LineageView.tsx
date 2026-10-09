'use client';
import Link from 'next/link';
import { DataRow, HashDisplay, LineageBreadcrumb, Panel, ProofBadge, type AttestationKind } from '@qsd/ui-tokens';
import { LINEAGE, PAGES, SHARED } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { formatBps, formatUnits, formatUnix, shortAddress } from '@/lib/format';
import { routes } from '@/lib/links';
import { useLineage } from '@/hooks/useApi';
import { LineageTerminal } from '@/components/terminal/pages';
import { ACCENT, PageHero, PageShell } from '@/components/page/PageHero';
import { CoinLink, Empty, LoadingPanel, Page, ProofLink, TxLink, UnavailablePanel } from '@/components/common';

export function LineageView({ id }: { id: string }) {
  const q = useLineage(id);
  const data = q.data;
  if (q.isPending) {
    return (
      <Page>
        <LoadingPanel eyebrow={LINEAGE.eyebrow} />
      </Page>
    );
  }
  if (!data || isUnavailable(data)) {
    const reason = data?.unavailable.reason ?? 'no response';
    return (
      <Page>
        {/no such lineage/i.test(reason) ? <Empty eyebrow={LINEAGE.notFoundEyebrow} sentence={LINEAGE.notFoundSentence} /> : <UnavailablePanel eyebrow={LINEAGE.unavailableEyebrow} reason={reason} />}
      </Page>
    );
  }
  const decimals = data.coins[0]?.supply.decimals ?? 0;
  return (
    <PageShell>
      <PageHero accent={ACCENT.teal} eyebrow={`${LINEAGE.eyebrow} · ${shortAddress(data.id, 8, 8)}`} title={LINEAGE.title} body={PAGES.lineage.body} />
      <div className="mb-6">
        <LineageBreadcrumb
          nodes={data.coins.map((c) => ({ label: c.ticker, href: routes.coin(c.ca), generation: c.generation, state: c.state }))}
          renderLink={(n, children) => <Link href={n.href!}>{children}</Link>}
        />
      </div>
      <LineageTerminal data={data} />
      <div className="mb-6" />
      {data.collapses.length === 0 ? (
        <Empty eyebrow="NO COLLAPSE YET" sentence="No coin in this lineage has collapsed; the lineage is its generation-one coin." />
      ) : (
        <div className="qsd-pgrid">
          {data.collapses.map((c) => (
            <Panel key={c.motherCa} eyebrow={`${LINEAGE.collapseEyebrow} · generation ${c.motherGeneration} → ${c.motherGeneration + 1}`} title={c.motherName}>
              <div className="qsd-pcols">
                <div className="qsd-datarow" role="row">
                  <span className="qsd-datarow__label">mother</span>
                  <span className="qsd-datarow__value">
                    <CoinLink ca={c.motherCa} />
                  </span>
                </div>
                <div className="qsd-datarow" role="row">
                  <span className="qsd-datarow__label">daughter</span>
                  <span className="qsd-datarow__value">{c.daughterCa ? <CoinLink ca={c.daughterCa} /> : <span className="text-muted">— the collapse is still executing</span>}</span>
                </div>
                <DataRow label={LINEAGE.measurementsSurvived} value={c.measurementsSurvived} />
                {c.channelLabel ? <DataRow label={LINEAGE.channel} value={c.channelLabel} /> : <DataRow label={LINEAGE.channel} unavailable={{ reason: 'no channel recorded' }} />}
                {c.measurement ? (
                  <>
                    <DataRow label="collapsed at" value={formatUnix(c.measurement.at)} />
                    <div className="qsd-datarow" role="row">
                      <span className="qsd-datarow__label">{LINEAGE.proofLabel}</span>
                      <span className="qsd-datarow__value flex items-center gap-3">
                        <ProofBadge status="unverified" reason="open the coin page to verify in your browser" attestationKind={c.measurement.attestationKind as AttestationKind} />
                        <ProofLink ca={c.motherCa} measurementId={c.measurement.id} />
                        {c.measurement.proofTx ? <TxLink sig={c.measurement.proofTx} label={SHARED.explorerTx} /> : null}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
              <h3 className="mt-5 text-lg">{LINEAGE.cohortsTitle}</h3>
              {c.allocation ? (
                <div className="qsd-pcols">
                  <div className="qsd-datarow" role="row">
                    <span className="qsd-datarow__label">{LINEAGE.allocationRoot}</span>
                    <span className="qsd-datarow__value">
                      <HashDisplay hash={c.allocation.merkleRoot} />
                    </span>
                  </div>
                  <div className="qsd-datarow" role="row">
                    <span className="qsd-datarow__label">{LINEAGE.rootAnchorTx}</span>
                    <span className="qsd-datarow__value">{c.allocation.rootAnchorTx ? <TxLink sig={c.allocation.rootAnchorTx} /> : <span className="text-muted">— not anchored</span>}</span>
                  </div>
                  <DataRow label={LINEAGE.cohortWallets} value={c.allocation.wallets} />
                  <DataRow label={LINEAGE.cohortUnits} value={formatUnits(BigInt(c.allocation.allocatedUnits), decimals)} />
                  <DataRow label={LINEAGE.cohortDust} value={formatUnits(BigInt(c.allocation.dustUnits), decimals)} />
                  {c.allocation.weightMinBps !== null && c.allocation.weightMaxBps !== null ? (
                    <DataRow label={LINEAGE.cohortWeightRange} value={`${(c.allocation.weightMinBps / 10_000).toFixed(4)}× – ${(c.allocation.weightMaxBps / 10_000).toFixed(4)}× (${formatBps(c.allocation.weightMaxBps - c.allocation.weightMinBps)} spread)`} />
                  ) : (
                    <DataRow label={LINEAGE.cohortWeightRange} unavailable={{ reason: 'no entries' }} />
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">{LINEAGE.cohortsEmpty}</p>
              )}
            </Panel>
          ))}
        </div>
      )}
    </PageShell>
  );
}
