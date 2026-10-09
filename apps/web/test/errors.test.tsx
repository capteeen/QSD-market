// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FOOTER_DISCLAIMER } from '@/copy';
import './setup-mocks';

/**
 * H-W2: an unknown route and a render error must still carry the footer
 * disclaimer. `not-found.tsx` and `error.tsx` render inside the root layout;
 * `global-error.tsx` replaces it and therefore renders the footer itself.
 */
describe('error pages carry the disclaimer', () => {
  it('not-found renders inside the root layout with the footer, no digits', async () => {
    const { default: RootLayout } = await import('@/app/layout');
    const { default: NotFound } = await import('@/app/not-found');
    const html = renderToStaticMarkup(
      <RootLayout>
        <NotFound />
      </RootLayout>,
    );
    expect(html.split(FOOTER_DISCLAIMER).length - 1).toBe(1);
    expect(html).toMatch(/data-testid="not-found"/);
  });

  it('error.tsx renders inside the root layout with the footer and the error message, and offers a retry', async () => {
    const { default: RootLayout } = await import('@/app/layout');
    const { default: ErrorPage } = await import('@/app/error');
    const html = renderToStaticMarkup(
      <RootLayout>
        <ErrorPage error={Object.assign(new Error('render failed in a view'), { digest: 'x' })} reset={() => undefined} />
      </RootLayout>,
    );
    expect(html.split(FOOTER_DISCLAIMER).length - 1).toBe(1);
    expect(html).toContain('render failed in a view');
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
  });

  it('global-error.tsx carries its own html/body AND the footer disclaimer exactly once', async () => {
    const { default: GlobalError } = await import('@/app/global-error');
    const html = renderToStaticMarkup(<GlobalError error={new Error('layout failed')} reset={() => undefined} />);
    expect(html).toMatch(/^<html/);
    expect(html.split(FOOTER_DISCLAIMER).length - 1).toBe(1);
    expect(html).toMatch(/<footer[^>]*data-testid="footer"/);
    expect(html).toContain('layout failed');
  });
});
