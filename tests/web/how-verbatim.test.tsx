// @vitest-environment jsdom
/**
 * Agent H — /how renders /docs/physics.md and /docs/economics.md VERBATIM
 * (SPEC §8 /how). readDocs() is compared with the files on disk, the API route
 * is exercised, and HowView's article is compared heading by heading and as a
 * whole against an independent render of the file text.
 */
import './client-mocks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fireEvent, waitFor } from '@testing-library/react';
import { HOW } from '@/copy';
import { HowView } from '@/components/views/HowView';
import { renderPage, stubFetch } from './render';

const ROOT = path.resolve(__dirname, '../..');
const PHYSICS = readFileSync(path.join(ROOT, 'docs/physics.md'), 'utf8');
const ECONOMICS = readFileSync(path.join(ROOT, 'docs/economics.md'), 'utf8');

const headingsOf = (md: string): string[] => {
  const out: string[] = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push(m[2]!.replace(/`/g, '').replace(/\*\*/g, '').replace(/\\/g, ''));
  }
  return out;
};
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

afterEach(() => vi.unstubAllGlobals());

describe('readDocs and GET /api/how', () => {
  it('readDocs() returns the two files byte for byte with their paths', async () => {
    const { readDocs } = await import('@/server/docs');
    const d = await readDocs();
    expect(d.physics).toBe(PHYSICS);
    expect(d.economics).toBe(ECONOMICS);
    expect(path.resolve(d.source.physics)).toBe(path.join(ROOT, 'docs/physics.md'));
    expect(path.resolve(d.source.economics)).toBe(path.join(ROOT, 'docs/economics.md'));
  });

  it('GET /api/how serves them unchanged with no-store; a missing docs dir → 503 unavailable', async () => {
    const { GET } = await import('@/app/api/how/route');
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const b = (await r.json()) as { physics: string; economics: string };
    expect(b.physics).toBe(PHYSICS);
    expect(b.economics).toBe(ECONOMICS);
    process.env.QSD_DOCS_DIR = '/nonexistent/agent-h';
    const bad = await GET();
    expect(bad.status).toBe(503);
    expect(((await bad.json()) as { unavailable: { reason: string } }).unavailable.reason).toMatch(/could not be read/);
    delete process.env.QSD_DOCS_DIR;
  });
});

describe('HowView', () => {
  async function renderHow() {
    stubFetch((p) => (p === '/api/how' ? { body: { physics: PHYSICS, economics: ECONOMICS, source: { physics: '/repo/docs/physics.md', economics: '/repo/docs/economics.md' } } } : { status: 503, body: { unavailable: { reason: 'x' } } }));
    const r = renderPage(<HowView />);
    await waitFor(() => expect(r.container.querySelector('article.qsd-markdown')).not.toBeNull());
    return r;
  }

  for (const [tab, md] of [
    ['physics', PHYSICS],
    ['economics', ECONOMICS],
  ] as const) {
    it(`${tab}: every heading of the file appears in the article, in order, at the same level; nothing added, nothing dropped`, async () => {
      const r = await renderHow();
      if (tab === 'economics') fireEvent.click(r.getByText(HOW.economicsTab));
      await waitFor(() => expect(r.container.querySelector(`article[data-doc="${tab}"]`)).not.toBeNull());
      const article = r.container.querySelector(`article[data-doc="${tab}"]`)!;
      const rendered = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => norm(h.textContent ?? ''));
      expect(rendered).toEqual(headingsOf(md).map(norm));
      expect(rendered.length).toBeGreaterThan(5);
    });

    it(`${tab}: the article body is exactly an unmodified markdown render of the file (apart from the source note)`, async () => {
      const r = await renderHow();
      if (tab === 'economics') fireEvent.click(r.getByText(HOW.economicsTab));
      await waitFor(() => expect(r.container.querySelector(`article[data-doc="${tab}"]`)).not.toBeNull());
      const article = r.container.querySelector(`article[data-doc="${tab}"]`)!;
      const note = article.querySelector('p.text-xs');
      expect(norm(note?.textContent ?? '')).toBe(norm(`${HOW.sourceNote} /repo/docs/${tab}.md`));
      note?.remove();
      // both sides serialised by the same DOM so that `<hr>` vs `<hr/>` and attribute quoting cannot differ
      const holder = document.createElement('div');
      holder.innerHTML = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>);
      expect(norm(article.innerHTML)).toBe(norm(holder.innerHTML));
      // the sentences the site relies on are really there
      const text = norm(article.textContent ?? '');
      if (tab === 'physics') {
        expect(text).toContain('does NOT claim');
        expect(text).toMatch(/where the trust actually sits/i);
      } else {
        expect(text).toMatch(/burn/i);
      }
    });
  }

  it('the API being unavailable shows the reason, never a cached or inlined copy of the documents', async () => {
    stubFetch(() => ({ status: 503, body: { unavailable: { reason: 'the documents could not be read (agent h)' } } }));
    const { container } = renderPage(<HowView />);
    await waitFor(() => expect(container.textContent).toContain('the documents could not be read (agent h)'));
    expect(container.textContent).not.toContain('does NOT claim');
    // the view has no copy of the documents at build time
    const src = readFileSync(path.join(ROOT, 'apps/web/src/components/views/HowView.tsx'), 'utf8');
    expect(src).not.toMatch(/physics\.md['"]|import .*\.md/);
  });
});
