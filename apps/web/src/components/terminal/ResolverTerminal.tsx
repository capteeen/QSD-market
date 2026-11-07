'use client';
import { useMemo } from 'react';
import { MEASUREMENT_RESOLVER_ID, PROTOCOL_PARAMS, RESOLVER_DRAW_BYTES } from '@qsd/protocol';
import { TERM } from '@/copy';
import { Cmd, Comment, Kv, Out, Rule, Terminal, Waiting, useInView, useReveal } from './Terminal';

const TEST_ID = 'term-resolver';

/** The public measurement resolver, described from its own constants. Prints the rule, draws nothing. */
export function ResolverTerminal({ className }: { className?: string | undefined }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const T = TERM.resolver;
  const pctPpm = (ppm: number): string => `${(ppm / 10_000).toFixed(1)} %`;
  const pctBps = (bps: number): string => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)} %`;
  const lines = useMemo(
    () => [
      <Kv key="id" k={T.id}>
        {MEASUREMENT_RESOLVER_ID}
      </Kv>,
      <Kv key="d" k={T.draw}>{`${RESOLVER_DRAW_BYTES} ${T.drawUnit}`}</Kv>,
      <Rule key="r1" />,
      <Out key="u0">{T.rule1}</Out>,
      <Out key="u1">{T.rule2(pctPpm(PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM))}</Out>,
      <Out key="u2">{T.rule3}</Out>,
      <Rule key="r2" />,
      <Kv key="t" k={T.tunnelLabel}>
        {pctPpm(PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM)}
      </Kv>,
      <Kv key="b" k={T.burnLabel}>
        {pctBps(PROTOCOL_PARAMS.COLLAPSE_BURN_BPS)}
      </Kv>,
      <Kv key="m" k={T.measurerLabel}>
        {pctBps(PROTOCOL_PARAMS.MEASURER_SHARE_OF_BURN_BPS)}
      </Kv>,
      <Kv key="s" k={T.survLabel}>
        {pctBps(PROTOCOL_PARAMS.SURVIVE_RESET_BPS)}
      </Kv>,
      <Comment key="n">{T.note}</Comment>,
      <Comment key="nc">{T.noCoin}</Comment>,
    ],
    [T],
  );
  const shown = useReveal(seen ? lines.length : 0, seen, 60);
  return (
    <div ref={ref}>
      <Terminal path={T.path} meta={T.meta} live={seen && shown < lines.length} className={className} testId={TEST_ID}>
        {!seen ? (
          <Waiting cmd={T.cmd} />
        ) : (
          <>
            <Cmd>{T.cmd}</Cmd>
            {lines.slice(0, shown)}
          </>
        )}
      </Terminal>
    </div>
  );
}
