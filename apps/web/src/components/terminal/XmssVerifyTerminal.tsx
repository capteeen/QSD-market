'use client';
import { useCallback, useEffect, useState } from 'react';
import { LEN, W } from '@qsd/crypto';
import { Cmd, Comment, Cursor, Kv, Out, Rule, Status, Terminal, hex, prefersReducedMotion } from './Terminal';
import { runXmssDemo, type XmssDemoRun } from './xmssDemo';

const SHOWN_CHAINS = 5;
const TICK_MS = 70;
/** Seconds a finished run stays on screen before a new key is generated. */
const HOLD_MS = 9000;

/**
 * A live XMSS / WOTS+ verification, recomputed in the browser with
 * @qsd/crypto on every run: a fresh key, a fresh message, a real signature,
 * a real verify. The chain rows show where the signer stopped (amber) and the
 * hashes the verifier ran to reach the public key (accent).
 */
export function XmssVerifyTerminal({ height = 3, className }: { height?: number; className?: string | undefined }) {
  const [run, setRun] = useState<XmssDemoRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [runs, setRuns] = useState(0);

  const next = useCallback(() => {
    try {
      setRun(runXmssDemo(height));
      setError(null);
    } catch (e) {
      setRun(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setRuns((n) => n + 1);
  }, [height]);

  useEffect(() => {
    next();
  }, [next]);

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
    <Terminal path="~/verify" meta={`xmss-sha256 · w=${W} · h=${height}`} live={!!run && !done} className={className} testId="term-xmss">
      <Cmd>xmss verify --live</Cmd>
      {error ? (
        <Status tone="fail">verifier error: {error}</Status>
      ) : !run ? (
        <Out dim>
          generating a fresh key in this browser
          <Cursor />
        </Out>
      ) : (
        <>
          <Comment>{'# sign      σ[i] = H^d[i](sk[i])'}</Comment>
          <Comment active={phase === 1}>{`# verify    pk[i] =? H^(${W - 1}-d[i])(σ[i])`}</Comment>
          <Comment active={phase === 3 && climbed === 0}>{`# compress  ℓ = L-tree(pk[0] … pk[${LEN - 1}])`}</Comment>
          <Comment active={phase === 3 || phase === 4}>{`# climb     root =? H(…H(ℓ ‖ a[0])… ‖ a[${height - 1}])`}</Comment>
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
            <Out dim>
              … {LEN - SHOWN_CHAINS} more chains · {run.verifyChainSteps} verifier hashes in all
            </Out>
          </div>
          <Rule />
          <Kv k="msg">0x{hex(run.message, 24)}…</Kv>
          <Kv k={`leaf ${run.index}`}>{chainsDone ? `0x${hex(run.leaf, 24)}…` : '…'}</Kv>
          <Kv k={`root ${climbed}/${height}`} tone={climbed === height ? (run.valid ? 'ok' : 'fail') : 'plain'}>
            {climbed > 0 ? `0x${hex(run.climb[climbed - 1]!, 24)}…` : '…'}
          </Kv>
          <div className="mt-2">
            {done ? (
              run.valid ? (
                <Status tone="ok">
                  signature verified · {run.signatureBytes.toLocaleString('en-US')} B · sha-256 only · {run.ms.toFixed(0)} ms in your browser
                </Status>
              ) : (
                <Status tone="fail">signature rejected · recomputed root ≠ public root</Status>
              )
            ) : (
              <Out dim>
                verifying
                <Cursor />
              </Out>
            )}
          </div>
          {done ? (
            <Out dim>
              run {runs} · new key in {Math.round(HOLD_MS / 1000)} s ·{' '}
              <button type="button" className="qsd-term__action underline" onClick={next}>
                run again
              </button>
            </Out>
          ) : null}
        </>
      )}
    </Terminal>
  );
}
