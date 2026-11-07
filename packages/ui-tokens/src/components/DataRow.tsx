import type { ReactElement } from 'react';
import { Unavailable } from './Unavailable.js';

export interface DataRowProps {
  /** Left-hand label. Mono, muted. */
  label: string;
  /**
   * The computed value. Passing `undefined` renders the unavailable state.
   * There is no default; the component will never invent a number.
   */
  value?: string | number | undefined;
  /** Optional unit rendered after the value, e.g. "SOL", "s", "%". */
  unit?: string;
  /**
   * Why the value is missing. Required by convention whenever `value` is
   * undefined; if omitted the row still renders "not available" with a
   * generic reason so a digit is never shown.
   */
  unavailable?: { reason: string; label?: string };
  /** Formats a numeric value for display. Default: `Intl.NumberFormat` with no grouping tricks. */
  format?: (n: number) => string;
  className?: string;
}

const defaultFormat = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 12, useGrouping: false }) : String(n);

/**
 * Label + value. The value is JetBrains Mono with tabular-nums.
 * When `value` is undefined the row MUST render the unavailable state and
 * MUST NOT render any digit. Tests enforce this.
 */
export function DataRow({ label, value, unit, unavailable, format = defaultFormat, className }: DataRowProps): ReactElement {
  const missing = value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value));
  const reason = unavailable?.reason ?? 'no value was provided';

  return (
    <div className={['qsd-datarow', className].filter(Boolean).join(' ')} role="row">
      <span className="qsd-datarow__label" role="rowheader">
        {label}
      </span>
      <span className="qsd-datarow__value qsd-mono" role="cell" data-unavailable={missing ? 'true' : 'false'}>
        {missing ? (
          <Unavailable reason={reason} {...(unavailable?.label ? { label: unavailable.label } : {})} />
        ) : (
          <>
            <span>{typeof value === 'number' ? format(value) : value}</span>
            {unit ? <span className="qsd-datarow__unit">{unit}</span> : null}
          </>
        )}
      </span>
    </div>
  );
}
