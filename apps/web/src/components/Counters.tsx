'use client';
import { DataRow, Panel } from '@qsd/ui-tokens';
import { HOME, SHARED } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { formatUnits } from '@/lib/format';
import { useStats } from '@/hooks/useApi';

/**
 * Live counters. A real zero renders "0"; a failed query renders the kit's
 * unavailable state in every row with the reason.
 */
export function Counters() {
  const q = useStats();
  const data = q.data;
  const reason = q.isPending ? SHARED.loading : data && isUnavailable(data) ? data.unavailable.reason : null;
  const c = data && !isUnavailable(data) ? data.counters : null;
  const row = (label: string, value: number | string | undefined) =>
    c ? <DataRow label={label} value={value} /> : <DataRow label={label} unavailable={{ reason: reason ?? SHARED.unavailableDb }} />;
  return (
    <Panel eyebrow={HOME.countersEyebrow}>
      <div className="grid gap-x-8 sm:grid-cols-2">
        {row(HOME.counters.superposed, c?.superposed)}
        {row(HOME.counters.measurementsToday, c?.measurementsToday)}
        {row(HOME.counters.collapses, c?.collapses)}
        {row(HOME.counters.daughters, c?.daughters)}
        {row(HOME.counters.tunnels, c?.tunnels)}
        {row(HOME.counters.burned, c ? formatUnits(BigInt(c.qsdBurned), 6) : undefined)}
      </div>
    </Panel>
  );
}
