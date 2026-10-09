import { FOOTER_DISCLAIMER } from '@/copy';

export function Footer() {
  return (
    <footer data-testid="footer" className="border-t border-border px-4 py-6 text-xs text-muted sm:px-8">
      <p className="mx-auto max-w-6xl font-mono">{FOOTER_DISCLAIMER}</p>
    </footer>
  );
}
