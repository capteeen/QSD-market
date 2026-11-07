import { FOOTER_DISCLAIMER, SITE_NAME, SITE_TAGLINE } from '@/copy';

export function Footer() {
  return (
    <footer data-testid="footer" className="qsd-footer">
      <div className="qsd-footer__inner">
        <span className="qsd-footer__brand">
          {SITE_NAME} <span className="qsd-footer__sep">·</span> {SITE_TAGLINE}
        </span>
        <p className="qsd-footer__disclaimer">{FOOTER_DISCLAIMER}</p>
      </div>
    </footer>
  );
}
