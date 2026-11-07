'use client';
import { ERRORS } from '@/copy';
import { Page } from '@/components/common';

/**
 * A render error inside a route. Next keeps the root layout (header + footer
 * disclaimer) around this boundary. The error's message is shown as-is: it is
 * the page's own failure, never a number standing in for data.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Page>
      <div className="qsd-glass p-6" data-testid="route-error">
        <span className="qsd-eyebrow">{ERRORS.errorEyebrow}</span>
        <p className="mt-2 text-sm">{ERRORS.errorSentence}</p>
        <p className="mt-2 font-mono text-xs text-muted">{error.message}</p>
        <button type="button" className="qsd-btn mt-4" onClick={() => reset()}>
          {ERRORS.retry}
        </button>
      </div>
    </Page>
  );
}
