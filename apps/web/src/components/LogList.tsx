'use client';
import { Panel } from '@qsd/ui-tokens';
import { HOME, SHARED } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { formatIso } from '@/lib/format';
import { useLog } from '@/hooks/useApi';
import { CoinLink, Empty, ProofLink, TxLink } from './common';

/** Every event, newest first, mono, each with its coin, proof and explorer links. */
export function LogList({ limit = 100 }: { limit?: number }) {
  const q = useLog(limit);
  const data = q.data;
  if (q.isPending) {
    return (
      <Panel eyebrow={HOME.logEyebrow} unavailable={{ reason: SHARED.loading, label: 'loading' }}>
        <span />
      </Panel>
    );
  }
  if (!data || isUnavailable(data)) {
    return (
      <Panel eyebrow={HOME.logUnavailableEyebrow} unavailable={{ reason: data?.unavailable.reason ?? SHARED.unavailableDb }}>
        <span />
      </Panel>
    );
  }
  return (
    <Panel eyebrow={HOME.logEyebrow} title={HOME.logTitle}>
      {data.entries.length === 0 ? (
        <Empty eyebrow={HOME.logEmptyEyebrow} sentence={HOME.logEmptySentence} />
      ) : (
        <ol className="divide-y divide-border font-mono text-xs" data-testid="log">
          {data.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <time dateTime={e.at} className="text-muted">
                {formatIso(e.at)}
              </time>
              <span className="uppercase tracking-widest text-probability">{e.type}</span>
              <span className="min-w-0 flex-1 break-words">{e.summary}</span>
              <span className="flex gap-3">
                {e.coinCa ? <CoinLink ca={e.coinCa} label={SHARED.coin} /> : null}
                {e.coinCa && e.refId ? <ProofLink ca={e.coinCa} measurementId={e.refId} /> : null}
                {e.tx ? <TxLink sig={e.tx} label={SHARED.explorerTx} /> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
