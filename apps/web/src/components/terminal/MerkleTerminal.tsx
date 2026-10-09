'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authPath, buildHashTree, equalBytes, rootFromAuthPath } from '@qsd/crypto';
import { TERM } from '@/copy';
import { Cmd, Comment, Kv, Out, Rule, Status, Terminal, Waiting, hex, useInView, useReveal } from './Terminal';

const TEST_ID = 'term-merkle';

const LEAVES = 16;

interface MerkleRun {
  levels: number[];
  root: Uint8Array;
  index: number;
  path: Uint8Array[];
  recomputed: Uint8Array;
  ok: boolean;
  ms: number;
}

function rand(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function runMerkle(): MerkleRun {
  const t0 = performance.now();
  const leaves = Array.from({ length: LEAVES }, () => rand(32));
  const seed = rand(32);
  const tree = buildHashTree(leaves, seed);
  const index = rand(1)[0]! % LEAVES;
  const path = authPath(tree, index);
  const recomputed = rootFromAuthPath(leaves[index]!, index, path, seed);
  return { levels: tree.levels.slice(1).map((l) => l.length), root: tree.root, index, path, recomputed, ok: equalBytes(recomputed, tree.root), ms: performance.now() - t0 };
}

/** A real sha-256 hash tree over browser randomness: the shape of the allocation commitment, with no holder in it. */
export function MerkleTerminal({ className }: { className?: string | undefined }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [run, setRun] = useState<MerkleRun | null>(null);
  const T = TERM.merkle;
  const next = useCallback(() => setRun(runMerkle()), []);
  useEffect(() => {
    if (seen) next();
  }, [seen, next]);
  const lines = useMemo(
    () =>
      run
        ? [
            <Comment key="e">{T.explain}</Comment>,
            <Out key="l" dim>
              {T.leaves(String(LEAVES))}
            </Out>,
            ...run.levels.map((n, i) => (
              <Out key={`lv${i}`}>
                <span className="qsd-term__dim">{T.fused(String(i), String(n))}</span>
                <span className="qsd-term__cells qsd-term__cells--inline" aria-hidden="true">
                  {Array.from({ length: n }, (_, k) => (
                    <span key={k} className="qsd-term__cell" data-k="verify" />
                  ))}
                </span>
              </Out>
            )),
            <Kv key="r" k={T.root}>{`0x${hex(run.root, 32)}…`}</Kv>,
            <Rule key="rl" />,
            <Out key="p" dim>
              {T.pathFor(String(run.index), String(run.path.length))}
            </Out>,
            ...run.path.map((h, i) => <Kv key={`p${i}`} k={`a[${i}]`}>{`0x${hex(h, 32)}…`}</Kv>),
            <Kv key="rc" k={T.recomputed} tone={run.ok ? 'ok' : 'fail'}>{`0x${hex(run.recomputed, 32)}…`}</Kv>,
            <Status key="s" tone={run.ok ? 'ok' : 'fail'}>
              {run.ok ? T.ok : T.bad} · {T.ms(run.ms.toFixed(1))}
            </Status>,
            <Out key="again" dim>
              <button type="button" className="qsd-term__action underline" onClick={next}>
                {TERM.runAgain}
              </button>
            </Out>,
          ]
        : [],
    [run, T, next],
  );
  const shown = useReveal(lines.length, run, 55);
  return (
    <div ref={ref}>
      <Terminal path={T.path} meta={T.meta} live={!!run && shown < lines.length} className={className} testId={TEST_ID}>
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
