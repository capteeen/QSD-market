'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HOW } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { useHow } from '@/hooks/useApi';
import { LoadingPanel, Page, PageHeader, UnavailablePanel } from '@/components/common';

/** /docs/physics.md and /docs/economics.md rendered verbatim (no sanitiser, no rewriting: these are our own files). */
export function HowView() {
  const q = useHow();
  const [tab, setTab] = useState<'physics' | 'economics'>('physics');
  const data = q.data;
  return (
    <Page>
      <PageHeader eyebrow={HOW.eyebrow}>
        <div className="flex gap-2">
          <button type="button" className="qsd-btn" data-primary={tab === 'physics' ? 'true' : 'false'} onClick={() => setTab('physics')}>
            {HOW.physicsTab}
          </button>
          <button type="button" className="qsd-btn" data-primary={tab === 'economics' ? 'true' : 'false'} onClick={() => setTab('economics')}>
            {HOW.economicsTab}
          </button>
        </div>
      </PageHeader>
      {q.isPending ? (
        <LoadingPanel eyebrow={HOW.eyebrow} />
      ) : !data || isUnavailable(data) ? (
        <UnavailablePanel eyebrow={HOW.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />
      ) : (
        <article className="qsd-markdown" data-doc={tab}>
          <p className="text-xs text-muted">
            {HOW.sourceNote} <code>{tab === 'physics' ? data.source.physics : data.source.economics}</code>
          </p>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{tab === 'physics' ? data.physics : data.economics}</ReactMarkdown>
        </article>
      )}
    </Page>
  );
}
