'use client';
import { BURNS } from '@/copy';
import { useBurns } from '@/hooks/useApi';
import { Page, PageHeader } from '@/components/common';
import { BurnsTerminal } from '@/components/terminal/pages';

export function BurnsView() {
  const q = useBurns();
  return (
    <Page>
      <PageHeader eyebrow={BURNS.eyebrow} title={BURNS.title} />
      <p className="mb-6 text-sm text-muted">{BURNS.caption}</p>
      <BurnsTerminal q={q} />
    </Page>
  );
}
