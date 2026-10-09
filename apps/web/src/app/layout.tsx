import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { FontLinks } from '@/components/FontLinks';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';
import { SITE_NAME, SITE_TAGLINE } from '@/copy';

export const metadata: Metadata = {
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: 'A pump.fun launchpad where a coin that stops trading decays into a daughter coin, resolved by attested quantum randomness.',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-qsd>
      <head>
        <FontLinks />
      </head>
      <body data-qsd>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
