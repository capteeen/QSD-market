'use client';
import { useCallback, useEffect, useState } from 'react';
import { LEN, W } from '@qsd/crypto';
import { TERM } from '@/copy';
import { Cmd, Comment, Cursor, Kv, Out, Rule, Status, Terminal, Waiting, hex, prefersReducedMotion, useInView } from './Terminal';
import { runXmss, type XmssRun } from './xmssRun';

const TEST_ID = 'term-xmss';

const SHOWN_CHAINS = 5;
const TICK_MS = 70;
const HOLD_MS = 9000;

/**
 * A live XMSS / WOTS+ verification recomputed in the browser with @qsd/crypto
 * on every run: a fresh key, a fresh message, a real signature, a real verify.
 * Starts when the panel scrolls into view.
 */
export function XmssVerifyTerminal({ height = 3, className }: { height?: number; className?: string | undefined }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [run, setRun] = useState<XmssRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [runs, setRuns] = useState(0);
  const T = TERM.xmss;

  const next = useCallback(() => {
    try {
      setRun(runXmss(height));
      setError(null);
    } catch (e) {
      setRun(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setRuns((n) => n + 1);
  }, [height]);

  useEffect(() => {
    if (seen) next();
  }, [seen, next]);

  const end = W - 1 + height + 3;
  useEffect(() => {
    if (!run) return;
    if (prefersReducedMotion()) {
      setT(end);
      return;
    }
    setT(0);
    let n = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      n += 1;
      setT(n);
      if (n >= end) {
        clearInterval(id);
        hold = setTimeout(next, HOLD_MS);
      }
    }, TICK_MS);
    return () => {
      clearInterval(id);
      if (hold) clearTimeout(hold);
    };
  }, [run, end, next]);

  const chainsDone = t >= W - 1;
  const climbed = Math.max(0, Math.min(height, t - (W - 1)));
  const done = t >= end;
  const phase = !chainsDone ? 1 : climbed < height ? 3 : 4;

  return (
    <div ref={ref}>
      <Terminal path={T.path} meta={T.meta} live={!!run && !done} className={className} testId={TEST_ID}>
        {!seen ? (
          <Waiting cmd={T.cmd} />
        ) : (
          <>
            <Cmd>{T.cmd}</Cmd>
            {error ? (
              <Status tone="fail">
                {T.error} {error}
              </Status>
            ) : !run ? (
              <Out dim>
                {T.generating}
                <Cursor />
              </Out>
            ) : (
              <>
                <Comment>{T.cSign}</Comment>
                <Comment active={phase === 1}>{T.cVerify(String(W - 1))}</Comment>
                <Comment active={phase === 3 && climbed === 0}>{T.cCompress(String(LEN - 1))}</Comment>
                <Comment active={phase === 3 || phase === 4}>{T.cClimb(String(height - 1))}</Comment>
                <div className="mt-3">
                  {run.startDepths.slice(0, SHOWN_CHAINS).map((d, i) => {
                    const reached = Math.min(W - 1, d + t);
                    const ok = reached >= W - 1;
                    return (
                      <div key={i} className="qsd-term__line qsd-term__chain" data-chain={i}>
                        <span className="qsd-term__dim">
                          c{String(i).padStart(2, '0')} d={d.toString(16)}
                        </span>
                        <span className="qsd-term__cells" aria-hidden="true">
                          {Array.from({ length: W }, (_, k) => (
                            <span key={k} className="qsd-term__cell" data-k={k < d ? 'signer' : k === d ? 'sig' : k <= reached ? 'verify' : 'todo'} />
                          ))}
                        </span>
                        <span className={ok ? 'qsd-term__ok' : 'qsd-term__dim'}>{ok ? `${hex(run.tips[i]!, 8)} ok` : '········ '}</span>
                      </div>
                    );
                  })}
                  <Out dim>{T.moreChains(String(LEN - SHOWN_CHAINS), String(run.verifyChainSteps))}</Out>
                </div>
                <Rule />
                <Kv k={T.msg}>0x{hex(run.message, 24)}…</Kv>
                <Kv k={T.leaf(String(run.index))}>{chainsDone ? `0x${hex(run.leaf, 24)}…` : '…'}</Kv>
                <Kv k={T.root(String(climbed), String(height))} tone={climbed === height ? (run.valid ? 'ok' : 'fail') : 'plain'}>
                  {climbed > 0 ? `0x${hex(run.climb[climbed - 1]!, 24)}…` : '…'}
                </Kv>
                <div className="mt-2">
                  {done ? (
                    run.valid ? (
                      <Status tone="ok">{T.verified(run.signatureBytes.toLocaleString('en-US'), run.ms.toFixed(0))}</Status>
                    ) : (
                      <Status tone="fail">{T.rejected}</Status>
                    )
                  ) : (
                    <Out dim>
                      {T.verifying}
                      <Cursor />
                    </Out>
                  )}
                </div>
                {done ? (
                  <Out dim>
                    {T.runs(String(runs), String(Math.round(HOLD_MS / 1000)))}{' '}
                    <button type="button" className="qsd-term__action underline" onClick={next}>
                      {TERM.runAgain}
                    </button>
                  </Out>
                ) : null}
              </>
            )}
          </>
        )}
      </Terminal>
    </div>
  );
}
