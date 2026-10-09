import './setup-mocks';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, waitFor } from '@testing-library/react';
import { HowView } from '@/components/views/HowView';
import { mockFetch, renderWithQuery } from './helpers';

const docsDir = path.resolve(__dirname, '../../../docs');
const physics = readFileSync(path.join(docsDir, 'physics.md'), 'utf8');
const economics = readFileSync(path.join(docsDir, 'economics.md'), 'utf8');

function firstHeading(md: string): string {
  const m = md.match(/^# (.+)$/m);
  if (!m) throw new Error('no heading');
  return m[1]!.trim();
}

/** Rows of the first GFM table whose header row contains `headerCell`, as arrays of cell texts. */
function tableRows(md: string, headerCell: string): string[][] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith('|') && l.includes(headerCell));
  if (start < 0) throw new Error(`no table with ${headerCell}`);
  const rows: string[][] = [];
  for (let i = start + 2; i < lines.length && lines[i]!.startsWith('|'); i++) {
    rows.push(
      lines[i]!
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim().replace(/`/g, '')),
    );
  }
  return rows;
}

afterEach(() => vi.unstubAllGlobals());

describe('/how renders the documents verbatim', () => {
  it('contains the exact first heading and every summary-table row of each doc', async () => {
    mockFetch((p) => (p.startsWith('/api/how') ? { body: { physics, economics, source: { physics: 'physics.md', economics: 'economics.md' } } } : { status: 503, body: { unavailable: { reason: 'x' } } }));
    const { container, getByText } = renderWithQuery(<HowView />);
    await waitFor(() => expect(container.querySelector('article h1')).toBeInTheDocument());
    expect(container.querySelector('article h1')?.textContent).toBe(firstHeading(physics));
    const physicsText = container.querySelector('article')!.textContent!.replace(/\s+/g, ' ');
    for (const row of tableRows(physics, 'Term in QSD')) for (const cell of row) expect(physicsText).toContain(cell.replace(/\s+/g, ' '));
    // Every table of physics.md has exactly its rows rendered.
    const physicsRows = tableRows(physics, 'Term in QSD').length;
    expect(container.querySelectorAll('article table tbody tr').length).toBe(physicsRows);

    fireEvent.click(getByText('economics'));
    await waitFor(() => expect(container.querySelector('article h1')?.textContent).toBe(firstHeading(economics)));
    const econText = container.querySelector('article')!.textContent!.replace(/\s+/g, ' ');
    for (const row of tableRows(economics, 'Constant')) for (const cell of row) expect(econText).toContain(cell.replace(/\s+/g, ' '));
    for (const row of tableRows(economics, 'Half-life preset')) for (const cell of row) expect(econText).toContain(cell.replace(/\s+/g, ' '));
  });
});
