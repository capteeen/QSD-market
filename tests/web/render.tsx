/** Agent H — render helpers for the jsdom page tests: a fetch stand-in per path and a TanStack Query wrapper. */
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// vitest runs without globals here, so Testing Library does not auto-clean between tests.
afterEach(() => cleanup());

export type Responder = (path: string, init?: RequestInit) => { status?: number; body: unknown };

export const DOWN = { unavailable: { reason: 'the database is not reachable (agent h test)' } };

/** Every fetch resolves through `responder(path)`; the default is a 503 `{ unavailable }` for everything. */
export function stubFetch(responder: Responder = () => ({ status: 503, body: DOWN })): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const r = responder(path, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function QueryWrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, refetchInterval: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function renderPage(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: QueryWrapper });
}

/** textContent of the container without the footer (the disclaimer is checked separately). */
export function bodyText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelector('[data-testid="footer"]')?.remove();
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}
