'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { DataRow, HashDisplay, Panel } from '@qsd/ui-tokens';
import { ME } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { formatPercent, formatUnits, formatUnix } from '@/lib/format';
import { useMe } from '@/hooks/useApi';
import { MeTerminal } from '@/components/terminal/pages';
import { CoinLink, Empty, LoadingPanel, Page, PageHeader, StateLabel, UnavailablePanel } from '@/components/common';

export function MeView() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const q = useMe(wallet);
  if (!wallet) {
    return (
      <Page>
        <PageHeader eyebrow={ME.eyebrow} title={ME.title} />
        <MeTerminal wallet={null} q={q} />
        <div className="mb-6" />
        <Empty eyebrow={ME.connectEyebrow} sentence={ME.connectSentence} />
      </Page>
    );
  }
  const data = q.data;
  return (
    <Page>
      <PageHeader eyebrow={`${ME.eyebrow} · ${wallet}`} title={ME.title} />
      <MeTerminal wallet={wallet} q={q} />
      <div className="mb-6" />
      {q.isPending ? (
        <LoadingPanel eyebrow={ME.eyebrow} />
      ) : !data || isUnavailable(data) ? (
        <UnavailablePanel eyebrow={ME.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel eyebrow={ME.coinsCreated}>
            {data.created.length === 0 ? (
              <p className="text-sm text-muted">{ME.noneCreated}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.created.map((c) => (
                  <li key={c.ca} className="flex items-center gap-3">
                    <CoinLink ca={c.ca} label={c.ticker} /> <StateLabel state={c.state} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel eyebrow={ME.coinsHeld}>
            {data.held.length === 0 ? (
              <p className="text-sm text-muted">{ME.noneHeld}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.held.map((h) => (
                  <li key={h.coin.ca} className="flex flex-wrap items-center gap-3">
                    <CoinLink ca={h.coin.ca} label={h.coin.ticker} /> <StateLabel state={h.coin.state} />
                    <span className="text-muted">bought {h.tradedUnits ? formatUnits(BigInt(h.tradedUnits), h.coin.supply.decimals) : h.tradedUiAmount}</span>
                    {h.firstAcquiredAt !== null ? <span className="text-muted">since {formatUnix(h.firstAcquiredAt)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel eyebrow={ME.received}>
            {data.received.length === 0 ? (
              <p className="text-sm text-muted">{ME.noReceived}</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {data.received.map((r) => (
                  <li key={r.daughterCa}>
                    <div className="flex flex-wrap items-center gap-3">
                      <CoinLink ca={r.daughterCa} /> <span className="text-muted">from</span> <CoinLink ca={r.motherCa} />
                    </div>
                    <DataRow label="units" value={r.units} />
                    <DataRow label="share" value={formatPercent(r.sharePpb / 1e9, 3)} />
                    <DataRow label="weight" value={`${(r.weightBps / 10_000).toFixed(4)}×`} />
                    <DataRow label="airdrop status" {...(r.status ? { value: r.status } : { unavailable: { reason: 'no airdrop record for this wallet yet' } })} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel eyebrow={ME.lineages}>
            {data.received.length === 0 && data.held.length === 0 ? (
              <p className="text-sm text-muted">{ME.noLineages}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {[...new Set([...data.held.map((h) => h.coin.lineageId), ...data.created.map((c) => c.lineageId)])].map((l) => (
                  <li key={l}>
                    <a className="qsd-link" href={`/lineage/${l}`}>
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel eyebrow={ME.identity}>
            {data.identities.length === 0 ? (
              <p className="text-sm text-muted">{ME.noneCreated}</p>
            ) : (
              <ul className="space-y-3">
                {data.identities.map((i) => (
                  <li key={i.coinCa}>
                    <CoinLink ca={i.coinCa} />
                    <div className="qsd-datarow" role="row">
                      <span className="qsd-datarow__label">{ME.identityRoot}</span>
                      <span className="qsd-datarow__value">
                        <HashDisplay hash={i.root} />
                      </span>
                    </div>
                    <DataRow label={ME.remainingKeys} value={i.remaining} />
                    <DataRow label={ME.nextIndex} value={i.nextIndex} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </Page>
  );
}
