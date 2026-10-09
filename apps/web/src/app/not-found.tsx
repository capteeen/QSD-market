import Link from 'next/link';
import { ERRORS } from '@/copy';
import { Page } from '@/components/common';
import { routes } from '@/lib/links';

export const dynamic = 'force-dynamic';

/** Unknown route. Rendered inside the root layout, so the header and the footer disclaimer are present. */
export default function NotFound() {
  return (
    <Page>
      <div className="qsd-glass p-6" data-testid="not-found">
        <span className="qsd-eyebrow">{ERRORS.notFoundEyebrow}</span>
        <p className="mt-2 text-sm">{ERRORS.notFoundSentence}</p>
        <Link className="qsd-link mt-4 inline-block text-xs" href={routes.field}>
          {ERRORS.notFoundLink}
        </Link>
      </div>
    </Page>
  );
}
