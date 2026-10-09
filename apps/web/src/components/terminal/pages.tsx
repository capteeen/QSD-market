'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PROTOCOL_PARAMS, collapseRewards, isMeasurable, measurementResolver } from '@qsd/protocol';
import { describeEvent, type CryptoEvent } from '@qsd/crypto';
import { bundleHash, verify } from '@qsd/quantum';
import { BURNS, HOME, MEASURE, SHARED } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { liveDecay } from '@/lib/coin';
import { publicCluster, publicWitnessKeys } from '@/lib/env';
import { formatBps, formatDuration, formatHalfLife, formatIso, formatLamports, formatPercent, formatUnits, formatUnix, shortAddress } from '@/lib/format';
import { explorerTx, routes } from '@/lib/links';
import type { BurnsResponse, CoinDto, CoinSummaryDto, LaunchQuoteResponse, LineageResponse, LogResponse, MeResponse, StatsResponse } from '@/lib/types';
import type { ApiResult } from '@/lib/api';
import { useNow } from '@/hooks/useNow';
import { Cmd, Cursor, Kv, Out, Reveal, Rule, Status, Terminal, hex } from './Terminal';

/* ── shared bits ─────────────────────────────────────────────────────── */

function Tx({ sig, label }: { sig: string; label?: string }) {
  return (
    <a href={explorerTx(sig, publicCluster())} target="_blank" rel="noreferrer" title={sig}>
      {label ?? shortAddress(sig, 6, 6)}
    </a>
  );
}

function CoinRef({ ca, label }: { ca: string; label?: string }) {
  return (
    <Link href={routes.coin(ca)} title={ca}>
      {label ?? shortAddress(ca, 6, 6)}
    </Link>
  );
}

const stateTone = (s: CoinSummaryDto['state']) => (s === 'collapsed' ? 'fail' : s === 'tunnelled' ? 'warn' : 'ok');

/** Loading / unavailable lines every data terminal shares. Returns null when data is present. */
function apiState<T>(q: { isPending: boolean; data: ApiResult<T> | undefined }, what: string): ReactNode | null {
  if (q.isPending) {
    return (
      <Out dim>
        reading {what}
        <Cursor />
      </Out>
    );
  }
  if (!q.data || isUnavailable(q.data)) {
    return (
      <>
        <Status tone="fail">{what} not available</Status>
        <Out dim>  reason: {q.data && isUnavailable(q.data) ? q.data.unavailable.reason : 'no response'}</Out>
      </>
    );
  }
  return null;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/* ── qsd status (/field) ─────────────────────────────────────────────── */

export function StatusTerminal({ q }: { q: { isPending: boolean; data: ApiResult<StatsResponse> | undefined } }) {
  const head = apiState(q, 'protocol status');
  const s = q.data && !isUnavailable(q.data) ? q.data : null;
  const lines: ReactNode[] = s
    ? [
        <Status key="db" tone={s.health.db ? 'ok' : 'fail'}>database</Status>,
        <Status key="redis" tone={s.health.redis ? 'ok' : 'warn'}>queue (redis){s.health.redis ? '' : ' · not configured'}</Status>,
        <Status key="qrng" tone={s.health.qrng.configured ? 'ok' : 'warn'}>
          qrng · {s.health.qrng.providerId ?? s.health.qrng.reason ?? 'not configured'}
        </Status>,
        <Status key="chain" tone={s.health.chain.configured ? 'ok' : 'warn'}>
          chain · {s.health.chain.cluster ?? s.health.chain.reason ?? 'not configured'}
        </Status>,
        <Rule key="r" />,
        <Kv key="sp" k="superposed">{s.counters.superposed}</Kv>,
        <Kv key="mt" k="measured today">{s.counters.measurementsToday}</Kv>,
        <Kv key="co" k="collapses">{s.counters.collapses}</Kv>,
        <Kv key="da" k="daughters">{s.counters.daughters}</Kv>,
        <Kv key="tu" k="tunnels">{s.counters.tunnels}</Kv>,
        <Kv key="bu" k="$QSD burned">{formatUnits(BigInt(s.counters.qsdBurned), 6)}</Kv>,
        <Kv key="nb" k="next burn" tone={s.nextBurnAt ? 'plain' : 'dim'}>{s.nextBurnAt ? formatIso(s.nextBurnAt) : 'no burn worker registered'}</Kv>,
      ]
    : [];
  return (
    <Terminal path="~/status" meta={publicCluster()} live={q.isPending} testId="term-status">
      <Cmd>qsd status</Cmd>
      {head ?? <Reveal lines={lines} revealKey={s?.now} />}
    </Terminal>
  );
}

/* ── tail events (home, /field) ──────────────────────────────────────── */

export function LogTerminal({ q, limit }: { q: { isPending: boolean; data: ApiResult<LogResponse> | undefined }; limit: number }) {
  const head = apiState(q, 'event log');
  const entries = q.data && !isUnavailable(q.data) ? q.data.entries : [];
  return (
    <Terminal path="~/log" meta={`newest first · ${limit} max`} live testId="term-log">
      <Cmd>tail -n {limit} /var/log/qsd/events</Cmd>
      {head ??
        (entries.length === 0 ? (
          <>
            <Status tone="dim">
              <span>{HOME.logEmptyEyebrow}</span>
            </Status>
            <Out dim>{HOME.logEmptySentence}</Out>
            <Out>
              <Cursor />
            </Out>
          </>
        ) : (
          <ol data-testid="log">
            {entries.map((e) => (
              <li key={e.id} className="qsd-term__line">
                <time dateTime={e.at} className="qsd-term__dim">
                  {formatIso(e.at)}
                </time>{' '}
                <span className={e.type.includes('collapse') ? 'qsd-term__fail' : e.type.includes('burn') ? 'qsd-term__warn' : 'qsd-term__ok'}>{pad(e.type, 12)}</span> {e.summary}{' '}
                <span className="qsd-term__dim">
                  {e.coinCa ? <CoinRef ca={e.coinCa} label={SHARED.coin} /> : null}
                  {e.coinCa && e.refId ? (
                    <>
                      {' '}
                      <Link href={routes.proof(e.coinCa, e.refId)}>{SHARED.proof}</Link>
                    </>
                  ) : null}
                  {e.tx ? (
                    <>
                      {' '}
                      <Tx sig={e.tx} label={SHARED.explorerTx} />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ))}
    </Terminal>
  );
}

/* ── qsd measure --queue (/measure) ──────────────────────────────────── */

export function MeasureQueueTerminal({ q, list }: { q: { isPending: boolean; data: ApiResult<{ coins: CoinSummaryDto[] }> | undefined }; list: CoinSummaryDto[] }) {
  const now = useNow();
  const head = apiState(q, 'measurement queue');
  return (
    <Terminal path="~/measure" meta={`auto-measure on decay · survive resets ${formatBps(PROTOCOL_PARAMS.SURVIVE_RESET_BPS, 0)}`} live testId="term-measure">
      <Cmd>qsd measure --queue --sort=due</Cmd>
      {head ??
        (list.length === 0 ? (
          <>
            <Status tone="dim">
              <span>{MEASURE.emptyEyebrow}</span>
            </Status>
            <Out dim>{MEASURE.emptySentence}</Out>
          </>
        ) : (
          <>
            <Out dim>{`${pad('coin', 10)} ${pad('due in', 12)} ${pad('decay', 8)} reward if it collapses`}</Out>
            {list.map((c) => {
              const due = Math.max(0, c.nextAutoMeasureAt! - now);
              const r = collapseRewards(BigInt(c.supply.remainingUnits));
              return (
                <div key={c.ca} className="qsd-term__line">
                  <Link href={routes.coin(c.ca)}>{pad(c.ticker, 10)}</Link> <span className={due < 3600 ? 'qsd-term__warn' : ''}>{pad(due === 0 ? 'now' : formatDuration(due), 12)}</span> {pad(formatPercent(liveDecay(c, now)), 8)}{' '}
                  {formatUnits(r.measurerUnits, c.supply.decimals)} {c.ticker}{' '}
                  <Link className="qsd-term__dim" href={routes.coin(c.ca)}>
                    measure →
                  </Link>
                </div>
              );
            })}
            <Out dim>
              {list.length} coin{list.length === 1 ? '' : 's'} measurable
            </Out>
          </>
        ))}
    </Terminal>
  );
}

/* ── qsd burns (/burns) ──────────────────────────────────────────────── */

export function BurnsTerminal({ q }: { q: { isPending: boolean; data: ApiResult<BurnsResponse> | undefined } }) {
  const head = apiState(q, 'burn ledger');
  const d = q.data && !isUnavailable(q.data) ? q.data : null;
  return (
    <Terminal path="~/burns" meta="hourly buy-and-burn" live testId="term-burns">
      <Cmd>qsd burns --all</Cmd>
      {head ??
        (d ? (
          <>
            <Kv k="$QSD mint" tone={d.qsdMint ? 'plain' : 'dim'}>
              {d.qsdMint ?? BURNS.qsdCaUnavailable}
            </Kv>
            <Kv k="total burned" tone="ok">
              {formatUnits(BigInt(d.totalBurned), 6)} $QSD
            </Kv>
            <Rule />
            {d.burns.length === 0 ? (
              <>
                <Status tone="dim">
                  <span>{BURNS.emptyEyebrow}</span>
                </Status>
                <Out dim>{BURNS.emptySentence}</Out>
              </>
            ) : (
              <>
                <Out dim>{`${pad('at', 20)} ${pad('sol in', 14)} ${pad('$QSD burned', 16)} tx`}</Out>
                {d.burns.map((b) => (
                  <div key={b.id} className="qsd-term__line">
                    <span className="qsd-term__dim">{pad(formatIso(b.at), 20)}</span> {pad(formatLamports(BigInt(b.lamportsIn)), 14)}{' '}
                    <span className="qsd-term__warn">{pad(formatUnits(BigInt(b.qsdBurned), 6), 16)}</span> <Tx sig={b.tx} />
                  </div>
                ))}
              </>
            )}
          </>
        ) : null)}
    </Terminal>
  );
}

/* ── qsd lineage trace (/lineage/[id]) ───────────────────────────────── */

export function LineageTerminal({ data }: { data: LineageResponse }) {
  const lines: ReactNode[] = data.coins.map((c, i) => {
    const collapse = data.collapses.find((x) => x.motherCa === c.ca);
    return (
      <div key={c.ca} className="qsd-term__line">
        <span className="qsd-term__dim">{i === 0 ? '' : `${'   '.repeat(i - 1)}└─ `}</span>
        <span className="qsd-term__dim">g{c.generation}</span> <CoinRef ca={c.ca} label={c.ticker} />{' '}
        <span className={`qsd-term__${stateTone(c.state)}`}>{SHARED.stateLabels[c.state]}</span>
        {collapse ? (
          <span className="qsd-term__dim">
            {' '}
            · survived {collapse.measurementsSurvived}
            {collapse.channelLabel ? ` · channel ${collapse.channelLabel}` : ''}
            {collapse.allocation ? ` · ${collapse.allocation.wallets} wallets → root ${collapse.allocation.merkleRoot.slice(0, 10)}…` : ''}
          </span>
        ) : null}
      </div>
    );
  });
  return (
    <Terminal path="~/lineage" meta={`${data.coins.length} generation${data.coins.length === 1 ? '' : 's'}`} testId="term-lineage">
      <Cmd>qsd lineage trace {shortAddress(data.id, 8, 8)}</Cmd>
      <Reveal lines={lines} revealKey={data.id} stepMs={90} />
    </Terminal>
  );
}

/* ── qsd inspect + proof verify (/coin/[ca]) ─────────────────────────── */

type VerifyLine = { tone: 'ok' | 'warn' | 'fail' | 'dim'; text: string };

export function CoinTerminal({ coin }: { coin: CoinDto }) {
  const now = useNow();
  const latest = coin.measurements.length > 0 ? coin.measurements.reduce((a, b) => (b.index > a.index ? b : a)) : null;
  const keys = useMemo(() => publicWitnessKeys(), []);
  const [verdict, setVerdict] = useState<VerifyLine | null>(null);

  useEffect(() => {
    if (!latest) return;
    setVerdict(null);
    // verify() is pure and synchronous; defer so the "verifying" line paints first.
    const id = setTimeout(() => {
      if (keys.length === 0) {
        setVerdict({ tone: 'warn', text: 'no trusted witness key in this build (NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS) · not checked' });
        return;
      }
      try {
        const r = verify(latest.proofBundle, measurementResolver, { trustedWitnessKeys: keys, requireInputBinding: true });
        if (r.ok && !('trust' in r)) setVerdict({ tone: 'ok', text: 'quantum draw verified · witness signature, commitment and outcome recomputed in your browser' });
        else if (r.ok) setVerdict({ tone: 'warn', text: 'self-consistent only · witness key is not a published one' });
        else setVerdict({ tone: 'fail', text: `proof rejected · ${r.reason}` });
      } catch (e) {
        setVerdict({ tone: 'fail', text: `verifier error · ${e instanceof Error ? e.message : String(e)}` });
      }
    }, 300);
    return () => clearTimeout(id);
  }, [latest, keys]);

  const decay = liveDecay(coin, now);
  return (
    <Terminal path={`~/coin/${coin.ticker.toLowerCase()}`} meta={`generation ${coin.generation}`} live={isMeasurable(coin.state)} testId="term-coin">
      <Cmd>qsd inspect {shortAddress(coin.ca, 6, 6)}</Cmd>
      <Kv k="state" tone={stateTone(coin.state)}>
        {SHARED.stateLabels[coin.state]}
      </Kv>
      <Kv k="decay" tone={decay > 0.75 ? 'warn' : 'plain'}>
        {formatPercent(decay, 2)} · half-life {formatHalfLife(coin.halfLifeSec)}
      </Kv>
      <Kv k="next measure" tone={coin.nextAutoMeasureAt === null ? 'dim' : 'plain'}>
        {coin.nextAutoMeasureAt === null ? 'none · collapsed' : `${formatUnix(coin.nextAutoMeasureAt)} (in ${formatDuration(Math.max(0, coin.nextAutoMeasureAt - now))})`}
      </Kv>
      <Kv k="supply">
        {formatUnits(BigInt(coin.supply.remainingUnits), coin.supply.decimals)} / {formatUnits(BigInt(coin.supply.totalUnits), coin.supply.decimals)} {coin.ticker}
      </Kv>
      <Kv k="identity root">0x{coin.identityRoot.slice(0, 24)}…</Kv>
      <Kv k="launch tx">
        <Tx sig={coin.launchTx} />
      </Kv>
      <Cmd>qsd proof verify --latest</Cmd>
      {!latest ? (
        <Out dim>no measurement yet · nothing to verify</Out>
      ) : (
        <>
          <Kv k={`measurement #${latest.index}`}>
            {SHARED.outcomeLabels[latest.outcome.kind]} · {formatUnix(latest.at)}
          </Kv>
          <Kv k="bundle">0x{bundleHash(latest.proofBundle).slice(0, 24)}…</Kv>
          <Kv k="attestation">{latest.attestationKind}</Kv>
          {verdict ? (
            <Status tone={verdict.tone}>{verdict.text}</Status>
          ) : (
            <Out dim>
              verifying
              <Cursor />
            </Out>
          )}
        </>
      )}
    </Terminal>
  );
}

/* ── whoami (/me) ────────────────────────────────────────────────────── */

export function MeTerminal({ wallet, q }: { wallet: string | null; q: { isPending: boolean; data: ApiResult<MeResponse> | undefined } }) {
  return (
    <Terminal path="~/me" meta={publicCluster()} testId="term-me">
      <Cmd>whoami</Cmd>
      {!wallet ? (
        <>
          <Status tone="dim">no wallet connected</Status>
          <Out dim>connect a wallet to read your coins, holdings and daughter shares</Out>
        </>
      ) : (
        <>
          <Kv k="wallet">{wallet}</Kv>
          {apiState(q, 'wallet record') ??
            (q.data && !isUnavailable(q.data) ? (
              <>
                <Kv k="created">{q.data.created.length} coin{q.data.created.length === 1 ? '' : 's'}</Kv>
                <Kv k="held">{q.data.held.length} coin{q.data.held.length === 1 ? '' : 's'}</Kv>
                <Kv k="received" tone={q.data.received.length > 0 ? 'ok' : 'plain'}>
                  {q.data.received.length} daughter share{q.data.received.length === 1 ? '' : 's'}
                </Kv>
                {q.data.identities.length > 0 ? (
                  <>
                    <Cmd>qsd identity ls</Cmd>
                    {q.data.identities.map((id) => (
                      <div key={id.coinCa} className="qsd-term__line">
                        <CoinRef ca={id.coinCa} /> <span className="qsd-term__dim">root</span> 0x{id.root.slice(0, 16)}… <span className="qsd-term__dim">next leaf</span> {id.nextIndex}{' '}
                        <span className={id.remaining < 16 ? 'qsd-term__warn' : 'qsd-term__ok'}>{id.remaining} one-time keys left</span>
                      </div>
                    ))}
                  </>
                ) : null}
              </>
            ) : null)}
        </>
      )}
    </Terminal>
  );
}

/* ── qsd launch --dry-run (/launch) ──────────────────────────────────── */

export function LaunchPreflightTerminal({
  quote,
  wallet,
  name,
  ticker,
  image,
  devBuyLamports,
  total,
}: {
  quote: LaunchQuoteResponse;
  wallet: string | null;
  name: string;
  ticker: string;
  image: File | null;
  devBuyLamports: bigint | null;
  total: bigint | null;
}) {
  const [imageHash, setImageHash] = useState<string | null>(null);
  useEffect(() => {
    setImageHash(null);
    if (!image) return;
    let alive = true;
    void image
      .arrayBuffer()
      .then((b) => crypto.subtle.digest('SHA-256', b))
      .then((d) => {
        if (alive) setImageHash(hex(new Uint8Array(d)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [image]);

  const lam = (v: string | null, reason?: string): ReactNode => (v !== null ? formatLamports(BigInt(v)) : <span className="qsd-term__dim">{reason ?? 'not available'}</span>);
  const tickerOk = /^[A-Za-z0-9]{1,10}$/.test(ticker);
  return (
    <Terminal path="~/launch" meta={quote.cluster} testId="term-launch">
      <Cmd>qsd launch --dry-run</Cmd>
      <Status tone={wallet ? 'ok' : 'fail'}>wallet {wallet ? shortAddress(wallet, 6, 6) : 'not connected'}</Status>
      <Status tone={name.trim() ? 'ok' : 'dim'}>name {name.trim() ? `"${name.trim()}"` : 'empty'}</Status>
      <Status tone={tickerOk ? 'ok' : ticker ? 'fail' : 'dim'}>ticker {ticker ? `$${ticker}${tickerOk ? '' : ' · 1-10 letters or digits'}` : 'empty'}</Status>
      <Status tone={image ? (imageHash ? 'ok' : 'dim') : 'dim'}>
        image {image ? `${image.name} · ${(image.size / 1024).toFixed(1)} KB · sha256 ${imageHash ? `${imageHash.slice(0, 16)}…` : 'hashing…'}` : 'none chosen'}
      </Status>
      <Rule />
      <Kv k="launch">{lam(quote.launchCostLamports, quote.reasons.launchCost)}</Kv>
      <Kv k="identity rent">{lam(quote.identityReserveLamports, quote.reasons.identityReserve)}</Kv>
      <Kv k="dev buy">{devBuyLamports !== null ? formatLamports(devBuyLamports) : <span className="qsd-term__dim">enter a number of SOL</span>}</Kv>
      <Kv k="total" tone={total !== null ? 'ok' : 'dim'}>
        {total !== null ? formatLamports(total) : 'not available'}
      </Kv>
      <Kv k="pay to" tone={quote.payTo ? 'plain' : 'dim'}>
        {quote.payTo ?? quote.reasons.payTo ?? 'not available'}
      </Kv>
      <Out dim>on submit: XMSS identity (256 one-time keys) → superposition → quantum draw → sign → anchor</Out>
    </Terminal>
  );
}

/* ── launch stream (/launch, while launching) ────────────────────────── */

export interface StreamLine {
  id: number;
  channel: string;
  text: string;
  tone?: 'ok' | 'warn' | 'fail';
}

export function LaunchStreamTerminal({ lines, running, className }: { lines: StreamLine[]; running: boolean; className?: string | undefined }) {
  return (
    <Terminal path="~/launch" meta="live stream from /api/launch" live={running} className={className} testId="term-launch-stream">
      <Cmd>qsd launch --stream</Cmd>
      {lines.map((l) => (
        <div key={l.id} className="qsd-term__line">
          <span className="qsd-term__dim">{pad(l.channel, 8)}</span> <span className={l.tone ? `qsd-term__${l.tone}` : ''}>{l.text}</span>
        </div>
      ))}
      {running ? <Cursor /> : null}
    </Terminal>
  );
}

const NOTABLE_CRYPTO = new Set(['keygenStart', 'rootReady', 'signStart', 'signatureReady', 'verifyStart', 'verifyLeafFormed', 'verifyResult']);

/**
 * Turns one decoded batch of crypto events from the launch stream into
 * terminal lines: every notable event verbatim (describeEvent), and the
 * high-volume ones (chain steps, leaves, tree fusions) as counts.
 */
export function cryptoStreamLines(events: readonly CryptoEvent[]): Omit<StreamLine, 'id'>[] {
  const out: Omit<StreamLine, 'id'>[] = [];
  const counts = new Map<string, number>();
  const flush = () => {
    if (counts.size === 0) return;
    out.push({ channel: 'crypto', text: [...counts].map(([t, n]) => `${t} ×${n}`).join(' · ') });
    counts.clear();
  };
  for (const e of events) {
    if (NOTABLE_CRYPTO.has(e.type)) {
      flush();
      const tone = e.type === 'verifyResult' ? (e.valid ? 'ok' : 'fail') : e.type === 'rootReady' || e.type === 'signatureReady' ? 'ok' : undefined;
      out.push({ channel: 'crypto', text: describeEvent(e), ...(tone ? { tone } : {}) });
    } else {
      counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    }
  }
  flush();
  return out;
}
