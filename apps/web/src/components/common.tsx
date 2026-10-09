'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState, Panel, quantumStateColor } from '@qsd/ui-tokens';
import type { CoinState } from '@qsd/protocol';
import { SHARED } from '@/copy';
import { publicCluster } from '@/lib/env';
import { explorerTx, routes } from '@/lib/links';
import { shortAddress } from '@/lib/format';

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <span className="qsd-eyebrow">{eyebrow}</span>
        {title ? <h1 className="mt-1 text-2xl">{title}</h1> : null}
      </div>
      {children}
    </div>
  );
}

export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full ${wide ? 'max-w-7xl' : 'max-w-6xl'} px-4 py-8 sm:px-8`}>{children}</div>;
}

/** The page-level honest state for a 503 payload. */
export function UnavailablePanel({ eyebrow, reason }: { eyebrow: string; reason: string }) {
  return (
    <Panel eyebrow={eyebrow} unavailable={{ reason }}>
      <span />
    </Panel>
  );
}

export function LoadingPanel({ eyebrow }: { eyebrow: string }) {
  return (
    <Panel eyebrow={eyebrow} unavailable={{ reason: SHARED.loading, label: 'loading' }}>
      <span />
    </Panel>
  );
}

export function StateLabel({ state }: { state: CoinState }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm" data-state={state}>
      <span className="inline-block h-2.5 w-2.5 rounded-quantum" style={{ background: quantumStateColor[state] }} aria-hidden="true" />
      {SHARED.stateLabels[state]}
    </span>
  );
}

export function TxLink({ sig, label }: { sig: string; label?: string }) {
  return (
    <a className="qsd-link font-mono text-xs" href={explorerTx(sig, publicCluster())} target="_blank" rel="noreferrer" title={sig}>
      {label ?? shortAddress(sig, 6, 6)}
    </a>
  );
}

export function CoinLink({ ca, label }: { ca: string; label?: string }) {
  return (
    <Link className="qsd-link font-mono text-xs" href={routes.coin(ca)} title={ca}>
      {label ?? shortAddress(ca, 6, 6)}
    </Link>
  );
}

export function ProofLink({ ca, measurementId }: { ca: string; measurementId: string }) {
  return (
    <Link className="qsd-link font-mono text-xs" href={routes.proof(ca, measurementId)}>
      {SHARED.proof}
    </Link>
  );
}

export function Empty({ eyebrow, sentence, action }: { eyebrow: string; sentence: string; action?: { label: string; href: string } }) {
  return <EmptyState eyebrow={eyebrow} sentence={sentence} {...(action ? { action } : {})} />;
}

export function Button({ children, primary, ...rest }: { children: ReactNode; primary?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="qsd-btn" data-primary={primary ? 'true' : 'false'} {...rest}>
      {children}
    </button>
  );
}
