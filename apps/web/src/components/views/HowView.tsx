'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HOW, PAGES } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { useHow } from '@/hooks/useApi';
import { ACCENT, PageHero, PageShell } from '@/components/page/PageHero';
import { LoadingPanel, UnavailablePanel } from '@/components/common';
import { XmssVerifyTerminal } from '@/components/terminal/XmssVerifyTerminal';

/** /docs/physics.md and /docs/economics.md rendered verbatim (no sanitiser, no rewriting: these are our own files), on paper. */
export function HowView() {
  const q = useHow();
  const [tab, setTab] = useState<'physics' | 'economics'>('physics');
  const data = q.data;
  return (
    <PageShell theme="brightfield">
      <PageHero accent={ACCENT.ink} eyebrow={HOW.eyebrow} title={HOW.title} body={PAGES.how.body} arrows={PAGES.how.arrows}>
        <div className="qsd-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'physics'} className="qsd-btn" data-primary={tab === 'physics' ? 'true' : 'false'} onClick={() => setTab('physics')}>
            {HOW.physicsTab}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'economics'} className="qsd-btn" data-primary={tab === 'economics' ? 'true' : 'false'} onClick={() => setTab('economics')}>
            {HOW.economicsTab}
          </button>
        </div>
      </PageHero>
      <div className="qsd-pgrid qsd-pgrid--32">
        <div className="qsd-pblock">
          {q.isPending ? (
            <LoadingPanel eyebrow={HOW.eyebrow} />
          ) : !data || isUnavailable(data) ? (
            <UnavailablePanel eyebrow={HOW.unavailableEyebrow} reason={data?.unavailable.reason ?? 'no response'} />
          ) : (
            <article className="qsd-markdown qsd-docs" data-doc={tab}>
              <p className="qsd-docs__source text-xs">
                {HOW.sourceNote} <code>{tab === 'physics' ? data.source.physics : data.source.economics}</code>
              </p>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{tab === 'physics' ? data.physics : data.economics}</ReactMarkdown>
            </article>
          )}
        </div>
        <div className="qsd-pblock">
          <XmssVerifyTerminal />
        </div>
      </div>
    </PageShell>
  );
}
