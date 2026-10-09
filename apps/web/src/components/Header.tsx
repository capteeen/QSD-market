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
    <header className="sticky top-0 z-20 border-b border-border bg-void/80 backdrop-blur-glass">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
        <Link href={routes.home} className="font-heading text-lg tracking-wide">
          {SITE_NAME}
        </Link>
        <nav className="flex flex-wrap gap-x-4 text-xs uppercase tracking-widest text-muted">
          <Link className="hover:text-text" href={routes.field}>{NAV.field}</Link>
          <Link className="hover:text-text" href={routes.launch}>{NAV.launch}</Link>
          <Link className="hover:text-text" href={routes.measure}>{NAV.measure}</Link>
          <Link className="hover:text-text" href={routes.burns}>{NAV.burns}</Link>
          <Link className="hover:text-text" href={routes.how}>{NAV.how}</Link>
          <Link className="hover:text-text" href={routes.me}>{NAV.me}</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-muted" title={status}>
            <span className="inline-block h-2 w-2 rounded-quantum" style={{ background: status === 'open' ? 'var(--qsd-probability)' : status === 'reconnecting' ? 'var(--qsd-decay)' : 'var(--qsd-dead)' }} />
            {status === 'open' ? SHARED.liveDot : status === 'reconnecting' ? SHARED.reconnecting : ''}
          </span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
