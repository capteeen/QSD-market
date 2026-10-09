/**
 * Google Fonts loading helpers.
 *
 * `tokens.css` already carries a CSS `@import` for the same families, so a
 * plain app needs nothing else. Next.js apps that want preconnect hints and
 * a <link> in <head> (rather than a CSS import) can use these instead.
 */

export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@600&display=swap';

export interface FontLink {
  rel: 'preconnect' | 'stylesheet';
  href: string;
  crossOrigin?: 'anonymous';
}

/**
 * Returns the <link> descriptors to render in a document head.
 *
 *   // app/layout.tsx
 *   import { fontLinks } from '@qsd/ui-tokens';
 *   <head>{fontLinks().map((l) => <link key={l.href + l.rel} {...l} />)}</head>
 */
export function fontLinks(): readonly FontLink[] {
  return [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
    { rel: 'stylesheet', href: GOOGLE_FONTS_HREF },
  ];
}

/** The same links as a raw HTML string, for non-React heads. */
export function fontLinksHtml(): string {
  return fontLinks()
    .map((l) => {
      const cross = l.crossOrigin ? ` crossorigin="${l.crossOrigin}"` : '';
      return `<link rel="${l.rel}" href="${l.href}"${cross}>`;
    })
    .join('\n');
}
