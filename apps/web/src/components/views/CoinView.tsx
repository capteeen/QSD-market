'use client';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { DataRow, HashDisplay, LineageBreadcrumb, MeasureButton, Panel, ProofBadge, type AttestationKind, type ProofStatus } from '@qsd/ui-tokens';
import {
  PROTOCOL_PARAMS,
  collapseRewards,
  computeAllocation,
  decayProgressPpbFromInputs,
  isMeasurable,
  measurementResolver,
  type MeasurementInputs,
} from '@qsd/protocol';
import { bundleHash, verify, type QuantumEvent, type Attestation } from '@qsd/quantum';
import type { Observable } from '@qsd/scene/model';
import { COIN, MEASURE_TEXT, SHARED } from '@/copy';
import { apiPost, isUnavailable } from '@/lib/api';
import { liveDecay, superpositionInput, uncertainty } from '@/lib/coin';
import { publicCluster, publicWitnessKeys } from '@/lib/env';
import { formatBps, formatHalfLife, formatPercent, formatPpm, formatUnits, formatUnix, shortAddress } from '@/lib/format';
import { pumpFunCoin, routes } from '@/lib/links';
import type { CoinDto, HoldersResponse, MeasureChallengeResponse, MeasureResponse, MeasurementDto } from '@/lib/types';
import { useCoin, useHolders, useStats } from '@/hooks/useApi';
import { useNow } from '@/hooks/useNow';
import { MeasurementScene } from '@/components/scenes';
import { CoinLink, Empty, LoadingPanel, Page, PageHeader, StateLabel, TxLink, UnavailablePanel } from '@/components/common';
import { useQueryClient } from '@tanstack/react-query';

export function CoinView({ ca }: { ca: string }) {
  const q = useCoin(ca);
  const data = q.data;
  if (q.isPending) {
    return (
      <Page>
        <LoadingPanel eyebrow={SHARED.coin} />
      </Page>
    );
  }
  if (!data || isUnavailable(data)) {
    const reason = data?.unavailable.reason ?? 'no response';
    return (
      <Page>
        {/no such coin/i.test(reason) ? <Empty eyebrow={COIN.notFoundEyebrow} sentence={COIN.notFoundSentence} /> : <UnavailablePanel eyebrow={COIN.unavailableEyebrow} reason={reason} />}
      </Page>
    );
  }
  return <CoinLoaded coin={data} />;
}

function CoinLoaded({ coin }: { coin: CoinDto }) {
  const now = useNow();
  const decay = liveDecay(coin, now);
  const cluster = publicCluster();
  const measurable = isMeasurable(coin.state);
  const supplyDecimals = coin.supply.decimals;
  const nodes = useMemo(() => {
    const out = [];
    if (coin.motherCa) out.push({ label: shortAddress(coin.motherCa), href: routes.coin(coin.motherCa), generation: coin.generation - 1, state: 'collapsed' as const });
    out.push({ label: coin.ticker, generation: coin.generation, state: coin.state });
    if (coin.daughterCa) out.push({ label: shortAddress(coin.daughterCa), href: routes.coin(coin.daughterCa), generation: coin.generation + 1, state: 'superposed' as const });
    return out;
  }, [coin]);

  return (
    <Page wide>
      <PageHeader eyebrow={`${SHARED.coin} · generation ${coin.generation}`} title={`${coin.name} · ${coin.ticker}`}>
        <div className="flex items-center gap-4">
          <StateLabel state={coin.state} />
          {cluster === 'mainnet-beta' && coin.launchPath === 'pump.fun' ? (
            <a className="qsd-btn" data-primary="true" href={pumpFunCoin(coin.ca)} target="_blank" rel="noreferrer">
              {COIN.trade}
            </a>
          ) : (
            <span className="text-xs text-muted">{COIN.tradeDevnet}</span>
          )}
        </div>
      </PageHeader>
      <div className="mb-6">
        <LineageBreadcrumb nodes={nodes} renderLink={(n, children) => <Link href={n.href!}>{children}</Link>} />{' '}
        <Link className="qsd-link ml-3 text-xs" href={routes.lineage(coin.lineageId)}>
          {COIN.rows.lineage}
        </Link>
      </div>
      {coin.state === 'tunnelled' ? <p className="mb-6 text-sm text-tunnel">{COIN.tunnelledNote}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="IDENTITY">
          <DataRow label={COIN.rows.name} value={coin.name} />
          <DataRow label={COIN.rows.ticker} value={coin.ticker} />
          <Row label={COIN.rows.ca}>
            <HashDisplay hash={coin.ca} full />
          </Row>
          <DataRow label={COIN.rows.generation} value={coin.generation} />
          <Row label={COIN.rows.mother}>{coin.motherCa ? <CoinLink ca={coin.motherCa} /> : <span className="text-muted">— generation one</span>}</Row>
          <Row label={COIN.rows.daughter}>{coin.daughterCa ? <CoinLink ca={coin.daughterCa} /> : <span className="text-muted">— none born</span>}</Row>
          <Row label={COIN.rows.identityRoot}>
            <HashDisplay hash={coin.identityRoot} />
          </Row>
          <DataRow label={COIN.rows.bornAt} value={formatUnix(coin.bornAt)} />
          {coin.collapsedAt !== null ? <DataRow label={COIN.rows.collapsedAt} value={formatUnix(coin.collapsedAt)} /> : null}
          <Row label={COIN.rows.launchTx}>
            <TxLink sig={coin.launchTx} />
          </Row>
          <DataRow label={COIN.rows.launchPath} value={coin.launchPath} />
          <DataRow label={COIN.rows.totalSupply} value={formatUnits(BigInt(coin.supply.totalUnits), supplyDecimals)} unit={coin.ticker} />
          <DataRow label={COIN.rows.remainingSupply} value={formatUnits(BigInt(coin.supply.remainingUnits), supplyDecimals)} unit={coin.ticker} />
          {coin.holderCount === null ? (
            <DataRow label={COIN.rows.holders} unavailable={{ reason: 'no trade has been seen by the protocol for this coin' }} />
          ) : (
            <DataRow label={COIN.rows.holders} value={coin.holderCount} />
          )}
        </Panel>

        <Panel eyebrow={COIN.decayEyebrow}>
          <DataRow label={COIN.rows.halfLife} value={formatHalfLife(coin.halfLifeSec)} />
          <DataRow label={COIN.rows.decayProgress} value={formatPercent(decay, 2)} />
          <DataRow label={COIN.rows.quietSince} value={formatUnix(coin.lastActivityAt)} />
          {coin.nextAutoMeasureAt !== null ? (
            <DataRow label={COIN.rows.nextAutoMeasure} value={formatUnix(coin.nextAutoMeasureAt)} />
          ) : (
            <DataRow label={COIN.rows.nextAutoMeasure} unavailable={{ reason: 'the coin has collapsed' }} />
          )}
          <div className="mt-3 h-2 w-full border border-border" role="progressbar" aria-valuenow={Math.round(decay * 1000) / 10} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-decay transition-all duration-slow ease-viscous" style={{ width: `${decay * 100}%` }} />
          </div>
          <p className="mt-3 text-xs text-muted">{COIN.decayCaption}</p>
        </Panel>

        <Panel eyebrow={COIN.bandEyebrow} title={COIN.bandTitle}>
          <DataRow label={COIN.rows.supplyMin} value={formatUnits(BigInt(coin.superposition.supplyMin), supplyDecimals)} />
          <DataRow label={COIN.rows.supplyMax} value={formatUnits(BigInt(coin.superposition.supplyMax), supplyDecimals)} />
          <DataRow label="band width" value={formatPercent(uncertainty(coin.superposition))} />
          <BandBar coin={coin} />
          <p className="mt-3 text-xs text-muted">{COIN.bandCaption}</p>
        </Panel>

        <Panel eyebrow={COIN.channelsEyebrow} title={COIN.channelsTitle}>
          <table className="qsd-table">
            <thead>
              <tr>
                <th>channel</th>
                <th>{COIN.channelProbability}</th>
                <th>{COIN.channelHalfLife}</th>
                <th>{COIN.channelPool}</th>
              </tr>
            </thead>
            <tbody>
              {coin.decayChannels.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>{formatPpm(c.probabilityPpm)}</td>
                  <td>
                    {formatHalfLife(c.halfLifeSec.min)} – {formatHalfLife(c.halfLifeSec.max)}
                  </td>
                  <td>
                    {formatUnits(BigInt(c.poolUnits.min), supplyDecimals)} – {formatUnits(BigInt(c.poolUnits.max), supplyDecimals)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <MeasurePanel coin={coin} decay={decay} measurable={measurable} />
        <DaughterGhost coin={coin} now={now} />
      </div>

      <div className="mt-6">
        <Panel eyebrow={COIN.measurementsEyebrow} title={COIN.measurementsTitle}>
          {coin.measurements.length === 0 ? (
            <Empty eyebrow={COIN.measurementsEmptyEyebrow} sentence={COIN.measurementsEmptySentence} />
          ) : (
            <div className="space-y-4">
              {[...coin.measurements].reverse().map((m) => (
                <MeasurementCard key={m.id} m={m} coin={coin} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <HoldersPanel coin={coin} />
      </div>
    </Page>
  );
}

function channelLabel(coin: CoinDto, channelId: string): string {
  return coin.decayChannels.find((c) => c.id === channelId)?.label ?? channelId;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="qsd-datarow" role="row">
      <span className="qsd-datarow__label" role="rowheader">
        {label}
      </span>
      <span className="qsd-datarow__value qsd-mono" role="cell">
        {children}
      </span>
    </div>
  );
}

function BandBar({ coin }: { coin: CoinDto }) {
  const min = BigInt(coin.superposition.supplyMin);
  const max = BigInt(coin.superposition.supplyMax);
  const total = BigInt(coin.supply.totalUnits);
  if (total <= 0n) return null;
  const pct = (x: bigint) => Number((x * 10_000n) / total) / 100;
  return (
    <div className="relative mt-3 h-3 w-full border border-border" title="daughter pool band as a share of this coin's total supply">
      <div className="absolute h-full bg-probability/40" style={{ left: `${pct(min)}%`, width: `${Math.max(0.5, pct(max) - pct(min))}%` }} />
    </div>
  );
}

// ───────────────────────────── measurement history ─────────────────────────────

function MeasurementCard({ m, coin }: { m: MeasurementDto; coin: CoinDto }) {
  const [status, setStatus] = useState<{ status: ProofStatus; reason?: string }>({ status: 'unverified', reason: COIN.verifyPending });
  const [busy, setBusy] = useState(false);
  const keys = publicWitnessKeys();
  const bundle = m.proofBundle;
  const attestation = bundle.draw.attestation as Attestation;
  const kind = attestation.kind as AttestationKind;
  const inputs = bundle.inputs.value as MeasurementInputs;
  const recomputedPpb = (() => {
    try {
      return decayProgressPpbFromInputs(inputs);
    } catch {
      return null;
    }
  })();

  const run = useCallback(() => {
    setBusy(true);
    // verify() is synchronous and pure; defer one tick so the badge shows pending.
    setTimeout(() => {
      // The verifier's options never come from the bundle under verification: a dev bundle renders "invalid" in production, correctly.
      const r = verify(bundle, measurementResolver, { trustedWitnessKeys: keys, requireInputBinding: true });
      if (r.ok && !('trust' in r)) setStatus({ status: 'verified' });
      else if (r.ok) setStatus({ status: 'unverified', reason: 'self-consistent only' });
      else setStatus({ status: 'invalid', reason: r.reason });
      setBusy(false);
    }, 0);
  }, [bundle, keys]);

  const download = () => {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qsd-proof-${m.id.slice(0, 16)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section id={`m-${m.id}`} className="border-card border-border p-4" data-measurement={m.id}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="qsd-eyebrow">
          #{m.index} · {SHARED.outcomeLabels[m.outcome.kind]}
          {m.outcome.kind === 'collapse' ? ` · ${channelLabel(coin, m.outcome.channelId)}` : ''}
        </span>
        <ProofBadge status={busy ? 'pending' : status.status} attestationKind={kind} {...(status.reason && !busy ? { reason: status.reason } : {})} {...(busy ? { reason: COIN.verifying } : {})} />
        <span className="ml-auto flex gap-2">
          {keys.length === 0 && kind !== 'unsafe-dev' ? (
            <span className="text-xs text-muted">{COIN.verifyNoKeys}</span>
          ) : (
            <button type="button" className="qsd-btn" onClick={run} disabled={busy}>
              {COIN.verifyButton}
            </button>
          )}
          <button type="button" className="qsd-btn" onClick={download}>
            {COIN.downloadBundle}
          </button>
        </span>
      </div>
      <div className="mt-3 grid gap-x-8 lg:grid-cols-2">
        <DataRow label={COIN.measurementRows.at} value={formatUnix(m.at)} />
        <DataRow label={COIN.measurementRows.by} value={m.by === PROTOCOL_PARAMS.AUTO_MEASURER_ID ? 'the protocol (auto-measurement)' : m.by} />
        <DataRow label={COIN.measurementRows.decayBefore} value={formatPercent(m.decayBefore, 3)} />
        <DataRow label={COIN.measurementRows.decayAfter} value={formatPercent(m.decayAfter, 3)} />
        <DataRow label={COIN.measurementRows.provider} value={bundle.draw.providerId} />
        <DataRow label={COIN.measurementRows.attestation} value={kind} />
        <DataRow label="resolver" value={bundle.resolverId} />
        <DataRow label="inputs · at" value={formatUnix(inputs.at)} />
        <DataRow label="inputs · lastActivityAt" value={formatUnix(inputs.lastActivityAt)} />
        <DataRow label="inputs · halfLifeSec" value={inputs.halfLifeSec} unit="s" />
        <DataRow label="inputs · decayProgressPpb" value={inputs.decayProgressPpb} />
        {recomputedPpb === null ? (
          <DataRow label="decay recomputed from inputs" unavailable={{ reason: 'the inputs are not in the current format' }} />
        ) : (
          <DataRow label="decay recomputed from inputs" value={`${recomputedPpb} ppb (${recomputedPpb === inputs.decayProgressPpb ? 'matches' : 'does not match'})`} />
        )}
        <DataRow label="inputs · measurementIndex" value={inputs.measurementIndex} />
        <Row label={COIN.measurementRows.commitment}>
          <HashDisplay hash={bundle.draw.commitment} />
        </Row>
        <Row label={COIN.measurementRows.inputsHash}>
          <HashDisplay hash={bundle.inputs.hash} />
        </Row>
        <Row label={COIN.measurementRows.bundleHash}>
          <HashDisplay hash={bundleHash(bundle)} />
        </Row>
        <Row label={COIN.measurementRows.precommitTx}>{m.precommitTx ? <TxLink sig={m.precommitTx} /> : <span className="text-muted">— not anchored</span>}</Row>
        <Row label={COIN.measurementRows.proofTx}>{m.proofTx ? <TxLink sig={m.proofTx} /> : <span className="text-muted">— not anchored</span>}</Row>
      </div>
      {status.status === 'verified' ? <p className="mt-3 text-xs text-muted">{COIN.verifiedCaption}</p> : null}
    </section>
  );
}

// ───────────────────────────── measure ─────────────────────────────

/** Replays the four draw events recorded in a returned proof bundle so the scene shows the real values of the draw that just happened on the server. */
function bundleEvents(m: MeasurementDto): Observable<QuantumEvent> {
  const d = m.proofBundle.draw;
  const bytes = Uint8Array.from(d.bytesHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const events: QuantumEvent[] = [
    { type: 'entropyRequested', seq: 0, at: d.requestedAt, providerId: d.providerId, nBytes: bytes.length, requestedAt: d.requestedAt },
    { type: 'entropyArrived', seq: 1, at: d.receivedAt, bytes, attestation: d.attestation },
    { type: 'commitmentComputed', seq: 2, at: d.receivedAt, hash: d.commitment },
    { type: 'outcomeResolved', seq: 3, at: m.proofBundle.resolvedAt, value: m.proofBundle.outcome.value, outcomeLabel: m.proofBundle.outcome.label },
  ];
  return {
    subscribe(listener) {
      for (const e of events) listener(e);
      return () => undefined;
    },
  };
}

function MeasurePanel({ coin, decay, measurable }: { coin: CoinDto; decay: number; measurable: boolean }) {
  const { publicKey, signMessage } = useWallet();
  const stats = useStats();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<'idle' | 'signing' | 'running' | 'done' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [last, setLast] = useState<MeasurementDto | null>(null);
  const [daughterNote, setDaughterNote] = useState<string | null>(null);

  const rewards = collapseRewards(BigInt(coin.supply.remainingUnits));
  const rewardPct = formatBps((PROTOCOL_PARAMS.COLLAPSE_BURN_BPS * PROTOCOL_PARAMS.MEASURER_SHARE_OF_BURN_BPS) / 10_000, 2);
  const reward = MEASURE_TEXT.reward(formatUnits(rewards.measurerUnits, coin.supply.decimals), coin.ticker, rewardPct, formatBps(PROTOCOL_PARAMS.SURVIVE_RESET_BPS, 0));
  const risk = MEASURE_TEXT.risk(formatPercent(decay, 1));

  let disabledReason: string | undefined;
  if (!measurable) disabledReason = COIN.measureNotMeasurable;
  else if (!publicKey || !signMessage) disabledReason = COIN.measureNoWallet;
  else if (stats.isPending) disabledReason = SHARED.loading;
  else if (!stats.data || isUnavailable(stats.data)) disabledReason = COIN.measureStatsUnavailable;
  else if (!stats.data.health.qrng.configured) disabledReason = `${COIN.measureQrngUnavailable}${stats.data.health.qrng.reason ? ` (${stats.data.health.qrng.reason})` : ''}`;
  else if (!stats.data.health.chain.configured) disabledReason = `${COIN.measureChainUnavailable}${stats.data.health.chain.reason ? ` (${stats.data.health.chain.reason})` : ''}`;

  const measure = async () => {
    if (!publicKey || !signMessage) return;
    setPhase('signing');
    setMessage(COIN.measureSigning);
    const wallet = publicKey.toBase58();
    const ch = await apiPost<MeasureChallengeResponse>('/api/measure/challenge', { wallet, ca: coin.ca });
    if (isUnavailable(ch)) {
      setPhase('failed');
      setMessage(`${COIN.measureFailed}: ${ch.unavailable.reason}`);
      return;
    }
    let sig: Uint8Array;
    try {
      sig = await signMessage(new TextEncoder().encode(ch.message));
    } catch (e) {
      setPhase('failed');
      setMessage(`${COIN.measureFailed}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setPhase('running');
    setMessage(COIN.measureRunning);
    const hex = Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
    const r = await apiPost<MeasureResponse>('/api/measure', { ca: coin.ca, wallet, nonce: ch.nonce, signature: hex });
    if (isUnavailable(r)) {
      setPhase('failed');
      setMessage(`${COIN.measureFailed}: ${r.unavailable.reason}`);
      return;
    }
    setLast(r.measurement);
    setPhase('done');
    setMessage(`${COIN.measureDone}: ${r.measurement.outcome.kind}`);
    setDaughterNote(r.daughterLaunch ? (r.daughterLaunch.status === 'scheduled' ? COIN.daughterScheduled : `${COIN.daughterNotScheduled} (${r.daughterLaunch.reason})`) : null);
    void qc.invalidateQueries({ queryKey: ['coin', coin.ca] });
  };

  return (
    <Panel eyebrow={COIN.measureEyebrow} title={COIN.measureTitle} computing={phase === 'running'}>
      <p className="mb-4 text-xs text-muted">{COIN.measureCaption}</p>
      <MeasureButton reward={reward} risk={risk} measuring={phase === 'signing' || phase === 'running'} {...(disabledReason ? { disabledReason } : {})} onClick={() => void measure()} />
      {message ? <p className="mt-3 text-xs" data-phase={phase}>{message}</p> : null}
      {daughterNote ? <p className="mt-1 text-xs text-muted" data-daughter-launch>{daughterNote}</p> : null}
      {last ? (
        <div className="mt-4 h-72 w-full border border-border">
          <MeasurementScene sources={{ quantum: bundleEvents(last), superposition: superpositionInput(coin) }} />
        </div>
      ) : null}
    </Panel>
  );
}

// ───────────────────────────── daughter ghost ─────────────────────────────

function DaughterGhost({ coin, now }: { coin: CoinDto; now: number }) {
  const { publicKey } = useWallet();
  const holders = useHolders(coin.ca, true);
  const wallet = publicKey?.toBase58() ?? null;
  const projection = useMemo(() => projectAllocation(coin, holders.data, wallet, now), [coin, holders.data, wallet, now]);
  return (
    <Panel eyebrow={COIN.daughterEyebrow} title={COIN.daughterTitle}>
      <p className="mb-3 text-xs text-muted">{COIN.daughterCaption}</p>
      {'reason' in projection ? (
        <>
          <DataRow label={COIN.projectedShare} unavailable={{ reason: projection.reason }} />
          <DataRow label={COIN.projectedUnits} unavailable={{ reason: projection.reason }} />
          <DataRow label={COIN.projectedWeight} unavailable={{ reason: projection.reason }} />
        </>
      ) : (
        <>
          <DataRow label={COIN.projectedShare} value={formatPercent(projection.sharePpb / 1e9, 3)} />
          <DataRow label={COIN.projectedUnits} value={`${formatUnits(projection.unitsAtMin, coin.supply.decimals)} (at the band minimum)`} />
          <DataRow label={COIN.projectedWeight} value={`${formatBps(projection.weightBps - 10_000, 2)} above base (${(projection.weightBps / 10_000).toFixed(4)}×)`} />
        </>
      )}
    </Panel>
  );
}

function projectAllocation(coin: CoinDto, data: HoldersResponse | { unavailable: { reason: string } } | undefined, wallet: string | null, now: number): { reason: string } | { sharePpb: number; unitsAtMin: bigint; weightBps: number } {
  if (!wallet) return { reason: COIN.daughterNoWallet };
  if (coin.state === 'collapsed') return { reason: COIN.daughterCollapsed };
  if (!data) return { reason: SHARED.loading };
  if (isUnavailable(data)) return { reason: data.unavailable.reason };
  if (!data.holders || data.holders.length === 0) return { reason: COIN.daughterNoSnapshot };
  if (!data.holders.some((h) => h.wallet === wallet)) return { reason: COIN.daughterNotHolder };
  try {
    const collapseAt = Math.max(now, coin.bornAt + 1);
    const table = computeAllocation({
      snapshot: data.holders.map((h) => ({ ...h, balance: BigInt(h.balance), firstAcquiredAt: Math.min(h.firstAcquiredAt, collapseAt) })),
      measurements: data.measurements,
      bornAt: coin.bornAt,
      collapseAt,
      quietPeriodStart: Math.min(coin.lastActivityAt, collapseAt),
      totalDaughterUnits: BigInt(coin.superposition.supplyMin),
    });
    const e = table.entries.find((x) => x.wallet === wallet);
    if (!e) return { reason: COIN.daughterNotHolder };
    return { sharePpb: e.sharePpb, unitsAtMin: e.units, weightBps: e.weightBps };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : String(err) };
  }
}

// ───────────────────────────── holders ─────────────────────────────

function HoldersPanel({ coin }: { coin: CoinDto }) {
  const q = useHolders(coin.ca, true);
  const data = q.data;
  if (q.isPending) return <LoadingPanel eyebrow={COIN.holdersEyebrow} />;
  if (!data || isUnavailable(data)) return <UnavailablePanel eyebrow={COIN.holdersEyebrow} reason={data?.unavailable.reason ?? 'no response'} />;
  return (
    <Panel eyebrow={COIN.holdersEyebrow} title={COIN.holdersTitle}>
      {!data.holders || data.holders.length === 0 ? (
        <Empty eyebrow={COIN.holdersEmptyEyebrow} sentence={COIN.holdersEmptySentence} />
      ) : (
        <table className="qsd-table">
          <thead>
            <tr>
              <th>{COIN.holdersCols.wallet}</th>
              <th>{COIN.holdersCols.balance}</th>
              <th>{COIN.holdersCols.since}</th>
            </tr>
          </thead>
          <tbody>
            {data.holders.map((h) => (
              <tr key={h.wallet}>
                <td title={h.wallet}>{shortAddress(h.wallet, 6, 6)}</td>
                <td>{formatUnits(BigInt(h.balance), coin.supply.decimals)}</td>
                <td>{formatUnix(h.firstAcquiredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-muted">source: the protocol’s trade log ({data.source}); the chain snapshot at the collapse block is authoritative at collapse.</p>
    </Panel>
  );
}
