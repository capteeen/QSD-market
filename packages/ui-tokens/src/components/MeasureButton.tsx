import type { ButtonHTMLAttributes, ReactElement } from 'react';

export interface MeasureButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'children'> {
  /** Measurer reward as already-formatted text, e.g. "0.5% of supply". Omit if unknown — nothing is shown. */
  reward?: string | undefined;
  /** Measurer risk as already-formatted text. Omit if unknown — nothing is shown. */
  risk?: string | undefined;
  /**
   * When set the button is disabled and renders
   * "Measurement unavailable: <reason>". Use it when the QRNG provider is
   * unreachable, the coin is not superposed, or the wallet is disconnected.
   */
  disabledReason?: string | undefined;
  /** True while a QRNG draw is in flight. Shows the computation glow. */
  measuring?: boolean;
  /** Button text. Default "Measure". */
  label?: string;
}

/**
 * The one button in the chamber. It never shows a reward or risk it was not
 * given, and when measurement is impossible it says why.
 */
export function MeasureButton({
  reward,
  risk,
  disabledReason,
  measuring = false,
  label = 'Measure',
  className,
  ...rest
}: MeasureButtonProps): ReactElement {
  const disabled = Boolean(disabledReason) || measuring;

  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      className={['qsd-measure', className].filter(Boolean).join(' ')}
      disabled={disabled}
      data-measuring={measuring ? 'true' : 'false'}
      aria-busy={measuring || undefined}
      aria-disabled={disabled || undefined}
    >
      {disabledReason ? (
        <>
          <span className="qsd-measure__label">Measurement unavailable</span>
          <span className="qsd-measure__reason">{disabledReason}</span>
        </>
      ) : (
        <>
          <span className="qsd-measure__label">{measuring ? 'Measuring' : label}</span>
          {reward || risk ? (
            <span className="qsd-measure__meta">
              {reward ? <span>reward {reward}</span> : null}
              {risk ? <span>risk {risk}</span> : null}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
}
