'use client';
import './globals.css';
import { ERRORS } from '@/copy';
import { Footer } from '@/components/Footer';

/**
 * A render error in the root layout itself. This boundary REPLACES the root
 * layout, so it must carry its own <html>/<body> and the footer disclaimer
 * (SPEC §8: every page). No providers: the shell is what failed.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" data-qsd>
      <body data-qsd>
        <div className="flex min-h-screen flex-col">
          <main className="flex-1">
            <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
              <div className="qsd-glass p-6" data-testid="global-error">
                <span className="qsd-eyebrow">{ERRORS.globalEyebrow}</span>
                <p className="mt-2 text-sm">{ERRORS.globalSentence}</p>
                <p className="mt-2 font-mono text-xs text-muted">{error.message}</p>
                <button type="button" className="qsd-btn mt-4" onClick={() => reset()}>
                  {ERRORS.retry}
                </button>
              </div>
            </div>
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
