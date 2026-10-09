import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';

export const UNAVAILABLE = { unavailable: { reason: 'the database is not reachable (test)' } };

/** Mock global fetch: every path resolves to `responder(path)` (default: 503 unavailable). */
export function mockFetch(responder: (path: string, init?: RequestInit) => { status?: number; body: unknown } = () => ({ status: 503, body: UNAVAILABLE })): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const r = responder(path, init);
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.body), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function Wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function renderWithQuery(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: Wrapper });
}

/** Text content with the footer removed (for "no digits" assertions). */
export function textWithoutFooter(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelector('[data-testid="footer"]')?.remove();
  return clone.textContent ?? '';
}
