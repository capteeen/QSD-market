'use client';
import Link from 'next/link';
import { Panel } from '@qsd/ui-tokens';
import { LAUNCHED } from '@/copy';
import { coinTree } from '@/lib/coin';
import { formatHalfLife, formatUnix } from '@/lib/format';
import { routes } from '@/lib/links';
import { StateLabel } from '@/components/common';
import type { CoinSummaryDto } from '@/lib/types';

/**
 * Every launched coin, newest mother first, each daughter nested under the coin it was born from.
 * Rendered only from real rows: the caller shows the kit's empty or unavailable panel when there are none.
 */
export function LaunchedList({ coins }: { coins: readonly CoinSummaryDto[] }) {
  const rows = coinTree(coins, (a, b) => b.bornAt - a.bornAt);
  return (
    <Panel eyebrow={LAUNCHED.eyebrow}>
      <p className="qsd-launched__hint">{LAUNCHED.hint}</p>
      <ol className="qsd-launched">
        {rows.map(({ coin: c, depth, last }) => (
          <li key={c.ca} className="qsd-launched__row" data-depth={Math.min(depth, 4)} data-last={last ? 'true' : 'false'}>
            {depth > 0 ? <span className="qsd-launched__tree" aria-hidden="true" /> : null}
            <span className="qsd-launched__coin">
              <Link className="qsd-link" href={routes.coin(c.ca)}>
                {c.ticker}
              </Link>
              <span className="qsd-launched__name">{c.name}</span>
            </span>
            <StateLabel state={c.state} />
            <span className="qsd-launched__meta">
              <span>
                {LAUNCHED.generation} {c.generation}
              </span>
              <span>
                {LAUNCHED.halfLife} {formatHalfLife(c.halfLifeSec)}
              </span>
              <span>
                {depth > 0 ? LAUNCHED.bornFromCollapse : LAUNCHED.launched} {formatUnix(c.bornAt)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
