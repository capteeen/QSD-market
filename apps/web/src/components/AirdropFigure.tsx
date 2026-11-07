'use client';
import { useEffect, useRef, useState } from 'react';
import { Panel } from '@qsd/ui-tokens';
import { AIRDROP } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { formatUnix } from '@/lib/format';
import { useLineage } from '@/hooks/useApi';
import { Empty, LoadingPanel, UnavailablePanel } from '@/components/common';
import type { AirdropProgressDto, LineageCollapseDto, LineageResponse } from '@/lib/types';

const MAX_DOTS = 400;

/**
 * The airdrop moment, from the journal mirror: a three-step timeline (collapse → daughter born → airdrop)
 * and one square per cohort wallet that fills as its transfer confirms. Every number is a real row count;
 * when nothing has happened yet the figure says so.
 */
export function AirdropFigure({ collapse, daughterBornAt }: { collapse: LineageCollapseDto; daughterBornAt: number | null }) {
  const alloc = collapse.allocation;
  if (!alloc) return <p className="qsd-note">{AIRDROP.stillExecuting}</p>;
  const a = alloc.airdrop;
  const total = Math.max(a.wallets, alloc.wallets);
  const done = total > 0 && a.confirmed >= total;
  const started = a.confirmed + a.sent > 0;
  const airdropLabel = done ? AIRDROP.airdropDone : started ? AIRDROP.airdropRunning : AIRDROP.airdropPending;
  const progress = total > 0 ? a.confirmed / total : 0;
  return (
    <figure className="qsd-airdrop" data-done={done ? 'true' : 'false'}>
      <ol className="qsd-airdrop__steps" style={{ ['--progress' as string]: progress }}>
        <Step label={AIRDROP.stepCollapse} at={collapse.measurement?.at ?? alloc.collapseAt} state="done" />
        <Step label={AIRDROP.stepBorn} at={daughterBornAt} state={daughterBornAt !== null ? 'done' : 'pending'} />
        <Step label={AIRDROP.stepAirdrop} at={a.lastConfirmedAt} state={done ? 'done' : started ? 'running' : 'pending'} note={airdropLabel} />
      </ol>
      {total === 0 ? (
        <p className="qsd-note">{AIRDROP.noWallets}</p>
      ) : (
        <>
          <Dots a={a} total={total} />
          <figcaption className="qsd-airdrop__legend">
            <span>
              {total} {AIRDROP.wallets}
            </span>
            <span data-status="confirmed">
              <i aria-hidden="true" /> {a.confirmed} {AIRDROP.confirmed}
            </span>
            <span data-status="sent">
              <i aria-hidden="true" /> {a.sent} {AIRDROP.sent}
            </span>
            <span data-status="pending">
              <i aria-hidden="true" /> {Math.max(0, total - a.confirmed - a.sent)} {AIRDROP.pending}
            </span>
            {total > MAX_DOTS ? (
              <span>
                {AIRDROP.showing} {MAX_DOTS} {AIRDROP.of} {total}
              </span>
            ) : null}
          </figcaption>
        </>
      )}
    </figure>
  );
}

function Step({ label, at, state, note }: { label: string; at: number | null; state: 'done' | 'running' | 'pending'; note?: string }) {
  return (
    <li className="qsd-airdrop__step" data-state={state}>
      <i aria-hidden="true" />
      <span className="qsd-airdrop__steplabel">{label}</span>
      <span className="qsd-airdrop__time">{at !== null ? formatUnix(at) : (note ?? '—')}</span>
    </li>
  );
}

/** One square per wallet, confirmed first, then sent, then pending; scaled down past MAX_DOTS, keeping the proportions. */
function Dots({ a, total }: { a: AirdropProgressDto; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setShown(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const n = Math.min(total, MAX_DOTS);
  const scale = n / total;
  const confirmed = Math.round(a.confirmed * scale);
  const sent = Math.round(a.sent * scale);
  const dots: ('confirmed' | 'sent' | 'pending')[] = [];
  for (let i = 0; i < n; i++) dots.push(i < confirmed ? 'confirmed' : i < confirmed + sent ? 'sent' : 'pending');
  return (
    <div ref={ref} className="qsd-airdrop__dots" data-shown={shown ? 'true' : 'false'} role="img" aria-label={`${a.confirmed} ${AIRDROP.of} ${total} ${AIRDROP.walletsConfirmed}`}>
      {dots.map((s, i) => (
        <i key={i} data-status={s} style={{ ['--i' as string]: i }} />
      ))}
    </div>
  );
}

/**
 * The airdrop panel on a coin page: the collapse this coin is the mother of, or the one it was born from.
 * Fetches the lineage; shows the kit's states while loading or when the API is unavailable.
 */
export function AirdropPanel({ lineageId, motherCa }: { lineageId: string; motherCa: string }) {
  const q = useLineage(lineageId);
  const data = q.data;
  let body: React.ReactNode;
  if (q.isPending) return <LoadingPanel eyebrow={AIRDROP.eyebrow} />;
  if (!data || isUnavailable(data)) return <UnavailablePanel eyebrow={AIRDROP.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />;
  const collapse = data.collapses.find((c) => c.motherCa === motherCa);
  if (!collapse) body = <Empty eyebrow={AIRDROP.eyebrow} sentence={AIRDROP.notCollapsed} />;
  else body = <AirdropFigure collapse={collapse} daughterBornAt={daughterBornAt(data, collapse)} />;
  return (
    <Panel eyebrow={AIRDROP.eyebrow} title={AIRDROP.title}>
      <p className="qsd-note mb-3">{AIRDROP.caption}</p>
      {body}
    </Panel>
  );
}

export function daughterBornAt(data: LineageResponse, collapse: LineageCollapseDto): number | null {
  return collapse.daughterCa ? (data.coins.find((c) => c.ca === collapse.daughterCa)?.bornAt ?? null) : null;
}
