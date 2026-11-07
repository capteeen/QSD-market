'use client';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { EmptyState, Panel, quantumStateColor } from '@qsd/ui-tokens';
import type { CoinState } from '@qsd/protocol';
import { SHARED } from '@/copy';
import { publicCluster } from '@/lib/env';
import { explorerTx, routes } from '@/lib/links';
import { shortAddress } from '@/lib/format';

/** A plain page header (eyebrow + headline + controls) for pages whose state has no hero copy yet. */
export function PageHeader({ eyebrow, title, children, accent }: { eyebrow: string; title?: string; children?: ReactNode; accent?: CSSProperties }) {
  return (
    <header className="qsd-phero" data-dial="false" style={accent}>
      <div className="qsd-phero__copy">
        <span className="qsd-eyebrow">{eyebrow}</span>
        {title ? <h1 className="qsd-phero__title">{title}</h1> : null}
        {children ? <div className="qsd-phero__meta">{children}</div> : null}
      </div>
    </header>
  );
}

export function Page({ children, theme }: { children: ReactNode; wide?: boolean; theme?: 'brightfield' }) {
  return (
    <div className="qsd-page" data-theme={theme}>
      <div className="qsd-page__inner">{children}</div>
    </div>
  );
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
    <span className="qsd-state" data-state={state}>
      <i style={{ background: quantumStateColor[state] }} aria-hidden="true" />
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
