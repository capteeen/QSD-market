'use client';
import { DataRow, HashDisplay, Panel } from '@qsd/ui-tokens';
import { BURNS } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { formatIso, formatLamports, formatUnits } from '@/lib/format';
import { useBurns } from '@/hooks/useApi';
import { Empty, LoadingPanel, Page, PageHeader, TxLink, UnavailablePanel } from '@/components/common';

export function BurnsView() {
  const q = useBurns();
  const data = q.data;
  return (
    <Page>
      <PageHeader eyebrow={BURNS.eyebrow} title={BURNS.title} />
      <p className="mb-6 text-sm text-muted">{BURNS.caption}</p>
      {q.isPending ? (
        <LoadingPanel eyebrow={BURNS.eyebrow} />
      ) : !data || isUnavailable(data) ? (
        <UnavailablePanel eyebrow={BURNS.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />
      ) : (
        <>
          <Panel>
            <DataRow label={BURNS.total} value={formatUnits(BigInt(data.totalBurned), 6)} unit="$QSD" />
            <div className="qsd-datarow" role="row">
              <span className="qsd-datarow__label" role="rowheader">
                {BURNS.qsdCa}
              </span>
              <span className="qsd-datarow__value" role="cell">
                <HashDisplay {...(data.qsdMint ? { hash: data.qsdMint, full: true } : { unavailable: { reason: BURNS.qsdCaUnavailable } })} />
              </span>
            </div>
          </Panel>
          <div className="mt-6">
            {data.burns.length === 0 ? (
              <Empty eyebrow={BURNS.emptyEyebrow} sentence={BURNS.emptySentence} />
            ) : (
              <Panel>
                <table className="qsd-table">
                  <thead>
                    <tr>
                      <th>{BURNS.cols.at}</th>
                      <th>{BURNS.cols.lamportsIn}</th>
                      <th>{BURNS.cols.qsdBurned}</th>
                      <th>{BURNS.cols.tx}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.burns.map((b) => (
                      <tr key={b.id}>
                        <td>{formatIso(b.at)}</td>
                        <td>{formatLamports(BigInt(b.lamportsIn))}</td>
                        <td>{formatUnits(BigInt(b.qsdBurned), 6)}</td>
                        <td>
                          <TxLink sig={b.tx} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}
          </div>
        </>
      )}
    </Page>
  );
}
