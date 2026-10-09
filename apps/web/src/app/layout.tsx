import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { FontLinks } from '@/components/FontLinks';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';
import { SITE_NAME, SITE_TAGLINE } from '@/copy';

const DESCRIPTION = 'A pump.fun launchpad where a coin that stops trading decays into a daughter coin, resolved by attested quantum randomness.';

export const metadata: Metadata = {
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: DESCRIPTION,
  // icon.png, apple-icon.png, favicon.ico and opengraph-image.png beside this file are picked up by the app router's file conventions.
  openGraph: { title: `${SITE_NAME} — ${SITE_TAGLINE}`, description: DESCRIPTION, siteName: SITE_NAME, type: 'website' },
  twitter: { card: 'summary_large_image', title: `${SITE_NAME} — ${SITE_TAGLINE}`, description: DESCRIPTION },
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
