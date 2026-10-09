'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { NAV, SITE_NAME, SHARED } from '@/copy';
import { routes } from '@/lib/links';
import { useLiveStore } from '@/store/live';

const WalletButton = dynamic(() => import('./WalletButton').then((m) => m.WalletButton), { ssr: false });

export function Header() {
  const status = useLiveStore((s) => s.status);
  return (
    <header className="qsd-header">
      <div className="qsd-header__inner">
        <Link href={routes.home} className="qsd-logo" aria-label={SITE_NAME}>
          <span className="qsd-logo__word">{SITE_NAME}</span>
          <span className="qsd-logo__dot" aria-hidden="true" />
        </Link>
        <nav className="qsd-nav">
          <Link href={routes.field}>{NAV.field}</Link>
          <Link href={routes.measure}>{NAV.measure}</Link>
          <Link href={routes.burns}>{NAV.burns}</Link>
          <Link href={routes.how}>{NAV.how}</Link>
          <Link href={routes.me}>{NAV.me}</Link>
        </nav>
        <div className="qsd-header__right">
          <span className="qsd-livedot" title={status} data-status={status}>
            <i aria-hidden="true" />
            <span>{status === 'open' ? SHARED.liveDot : status === 'reconnecting' ? SHARED.reconnecting : ''}</span>
          </span>
          <Link href={routes.launch} className="qsd-btn qsd-btn--accent" data-primary="true">
            {NAV.launch}
          </Link>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
