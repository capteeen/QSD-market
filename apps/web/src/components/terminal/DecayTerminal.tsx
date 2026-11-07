'use client';
import { useMemo } from 'react';
import { HALF_LIFE_PRESETS, PROTOCOL_PARAMS, decayProgressFor } from '@qsd/protocol';
import { TERM } from '@/copy';
import { Cmd, Comment, Kv, Out, Rule, Terminal, Waiting, useInView, useReveal } from './Terminal';

const TEST_ID = 'term-decay';

const QUIET_HOURS = [0, 1, 3, 6, 12, 24, 48] as const;
const HL = PROTOCOL_PARAMS.HALF_LIFE_MIN_SEC * 6; // the 6-hour preset: every number below is protocol math at that half-life
const pct = (x: number): string => `${(x * 100).toFixed(1).padStart(5)} %`;

/** The decay curve from @qsd/protocol, evaluated here. Constants, not a coin. */
export function DecayTerminal({ className }: { className?: string | undefined }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const T = TERM.decay;
  const rows = useMemo(
    () =>
      QUIET_HOURS.map((h) => {
        const quiet = h * 3600;
        const p = decayProgressFor(quiet, HL);
        const due = quiet >= PROTOCOL_PARAMS.AUTO_MEASURE_HALF_LIVES * HL;
        return { h, p, due };
      }),
    [],
  );
  const lines = useMemo(
    () => [
      <Comment key="e">{T.explain}</Comment>,
      <Kv key="hl" k="half-life">{`${HL / 3600} h (${HALF_LIFE_PRESETS.find((x) => x.halfLifeSec === HL)?.label ?? ''})`}</Kv>,
      <Out key="h" dim>
        {T.header}
      </Out>,
      ...rows.map((r) => (
        <Out key={r.h}>
          <span className="qsd-term__dim">{`${String(r.h).padStart(2)} h  `}</span>
          <span className="qsd-term__bar" aria-hidden="true" style={{ ['--p' as string]: r.p }} />
          {` ${pct(r.p)}  `}
          <span className={r.due ? 'qsd-term__state qsd-term__warn' : 'qsd-term__state qsd-term__dim'}>{r.due ? T.stateDue : T.stateQuiet}</span>
        </Out>
      )),
      <Rule key="r" />,
      <Out key="a" dim>
        {T.autoAt(String(PROTOCOL_PARAMS.AUTO_MEASURE_HALF_LIVES)).replace('<R>', `${PROTOCOL_PARAMS.SURVIVE_RESET_BPS / 100} %`)}
      </Out>,
      <Out key="z" dim>
        {T.zeno(String(PROTOCOL_PARAMS.ZENO_K), `${PROTOCOL_PARAMS.ZENO_RESET_CAP_BPS / 100} %`)}
      </Out>,
      <Out key="p" dim>
        {T.presets} {HALF_LIFE_PRESETS.map((x) => x.label).join(' · ')}
      </Out>,
    ],
    [rows, T],
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
