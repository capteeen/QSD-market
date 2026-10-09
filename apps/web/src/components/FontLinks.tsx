'use client';
import { fontLinks } from '@qsd/ui-tokens';

/** Google Fonts preconnect + stylesheet from the design kit (rendered in <head>; tokens.css also @imports the same families). */
export function FontLinks() {
  return (
    <>
      {fontLinks().map((l) => (
        <link key={l.rel + l.href} rel={l.rel} href={l.href} {...(l.crossOrigin ? { crossOrigin: l.crossOrigin } : {})} />
      ))}
    </>
  );
}
