'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { DataRow, Panel } from '@qsd/ui-tokens';
import { HALF_LIFE_PRESETS } from '@qsd/protocol';
import { createSceneStore, decodeCryptoEvents, type ChainEvent, type LineageInput, type SceneStore, type SuperpositionInput } from '@qsd/scene/model';
import type { QuantumEvent } from '@qsd/quantum';
import { LAUNCH, PAGES } from '@/copy';
import { isUnavailable } from '@/lib/api';
import { formatLamports } from '@/lib/format';
import { routes } from '@/lib/links';
import { useLaunchQuote } from '@/hooks/useApi';
import { LaunchSequence } from '@/components/scenes';
import { RangesFigure } from '@/components/home/FeatureSection';
import { ACCENT, PageHero, PageShell } from '@/components/page/PageHero';
import { Empty, LoadingPanel, UnavailablePanel } from '@/components/common';
import { LaunchPreflightTerminal, LaunchStreamTerminal, cryptoStreamLines, type StreamLine } from '@/components/terminal/pages';

type Phase = 'form' | 'paying' | 'launching' | 'done' | 'failed';

/** Parses `event:`/`data:` frames from a fetch body. */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      yield { event, data: data.join('\n') };
    }
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (h) => parseInt(h, 16));
}

export function LaunchView() {
  const quote = useLaunchQuote();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [phase, setPhase] = useState<Phase>('form');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ca, setCa] = useState<string | null>(null);
  const storeRef = useRef<SceneStore | null>(null);
  if (!storeRef.current) storeRef.current = createSceneStore();
  const store = storeRef.current;
  const [lines, setLines] = useState<StreamLine[]>([]);
  const lineId = useRef(0);
  const print = (...ls: Omit<StreamLine, 'id'>[]) => setLines((xs) => [...xs, ...ls.map((l) => ({ ...l, id: lineId.current++ }))].slice(-400));
  const [sources, setSources] = useState<{ superposition?: SuperpositionInput; lineage?: LineageInput }>({});

  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [description, setDescription] = useState('');
  const [preset, setPreset] = useState<string>(HALF_LIFE_PRESETS[2]!.id);
  const [image, setImage] = useState<File | null>(null);

  const q = quote.data && !isUnavailable(quote.data) ? quote.data : null;
  const devBuyLamports = q && q.devBuyLamports !== null ? BigInt(q.devBuyLamports) : null;
  const total = q && q.launchCostLamports !== null && q.identityReserveLamports !== null && devBuyLamports !== null ? BigInt(q.launchCostLamports) + BigInt(q.identityReserveLamports) + devBuyLamports : null;
  const canLaunch = !!q && !!q.payTo && total !== null && !!publicKey && !!image && name.trim().length > 0 && /^[A-Za-z0-9]{1,10}$/.test(ticker) && phase === 'form';

  const launch = async () => {
    if (!q || !q.payTo || total === null || !publicKey || !image) return;
    setError(null);
    setPhase('paying');
    setStatus(LAUNCH.form.paying);
    let paymentSignature: string;
    try {
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(q.payTo), lamports: total }));
      paymentSignature = await sendTransaction(tx, connection);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: paymentSignature, ...latest }, 'confirmed');
    } catch (e) {
      setPhase('failed');
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setPhase('launching');
    setStatus(LAUNCH.form.launching);
    const fd = new FormData();
    fd.set('name', name.trim());
    fd.set('ticker', ticker.toUpperCase());
    fd.set('description', description);
    fd.set('halfLifePreset', preset);
    fd.set('devBuySol', String(Number(devBuyLamports ?? 0n) / 1e9));
    fd.set('image', image);
    fd.set('wallet', publicKey.toBase58());
    fd.set('paymentSignature', paymentSignature);
    let res: Response;
    try {
      res = await fetch('/api/launch', { method: 'POST', body: fd });
    } catch (e) {
      setPhase('failed');
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      setPhase('failed');
      setError(text || `HTTP ${res.status}`);
      return;
    }
    try {
      for await (const f of sseFrames(res.body)) {
        switch (f.event) {
          case 'status':
            setStatus((JSON.parse(f.data) as { message: string }).message);
            print({ channel: 'status', text: (JSON.parse(f.data) as { message: string }).message });
            break;
          case 'crypto':
          {
            const events = decodeCryptoEvents(base64ToBytes(f.data));
            store.dispatchMany(events);
            print(...cryptoStreamLines(events));
            break;
          }
          case 'superposition': {
            const s = JSON.parse(f.data) as { supplyMin: string; supplyMax: string; halfLifeSec: number; decayChannels: SuperpositionInput['decayChannels'] };
            const input: SuperpositionInput = { supplyMin: BigInt(s.supplyMin), supplyMax: BigInt(s.supplyMax), halfLifeSec: s.halfLifeSec, decayChannels: s.decayChannels };
            setSources((x) => ({ ...x, superposition: input }));
            store.dispatch({ type: 'superposition', input });
            print({ channel: 'state', text: `superposition supply ${s.supplyMin}…${s.supplyMax} · half-life ${s.halfLifeSec}s · ${s.decayChannels.length} decay channels` });
            break;
          }
          case 'quantum': {
            const e = JSON.parse(f.data) as QuantumEvent | (Omit<Extract<QuantumEvent, { type: 'entropyArrived' }>, 'bytes'> & { bytes: string });
            const ev: QuantumEvent = e.type === 'entropyArrived' ? { ...e, bytes: hexToBytes(e.bytes as string) } : (e as QuantumEvent);
            store.dispatch(ev);
            print({
              channel: 'qrng',
              text:
                ev.type === 'entropyRequested'
                  ? `entropyRequested provider=${ev.providerId} bytes=${ev.nBytes}`
                  : ev.type === 'entropyArrived'
                    ? `entropyArrived ${Array.from(ev.bytes.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')}… attestation=${ev.attestation.kind}`
                    : ev.type === 'commitmentComputed'
                      ? `commitment ${ev.hash}`
                      : `outcome ${ev.outcomeLabel}`,
              ...(ev.type === 'outcomeResolved' ? { tone: 'ok' as const } : {}),
            });
            break;
          }
          case 'chain': {
            const ev = JSON.parse(f.data) as ChainEvent;
            store.dispatch(ev);
            print({ channel: 'chain', text: ev.type === 'anchored' ? `anchored ${ev.txSignature}${ev.slot !== undefined ? ` slot ${ev.slot}` : ''}` : `anchorSubmitted ${ev.txSignature ?? ''}`, ...(ev.type === 'anchored' ? { tone: 'ok' as const } : {}) });
            break;
          }
          case 'launch':
            setCa((JSON.parse(f.data) as { ca: string }).ca);
            print({ channel: 'launch', text: `coin address ${(JSON.parse(f.data) as { ca: string }).ca}`, tone: 'ok' });
            break;
          case 'lineage': {
            const input = JSON.parse(f.data) as LineageInput;
            setSources((x) => ({ ...x, lineage: input }));
            store.dispatch({ type: 'lineage', input });
            break;
          }
          case 'done':
            setPhase('done');
            setStatus(LAUNCH.done);
            print({ channel: 'done', text: LAUNCH.done, tone: 'ok' });
            break;
          case 'error':
            setPhase('failed');
            setError((JSON.parse(f.data) as { message: string }).message);
            print({ channel: 'error', text: (JSON.parse(f.data) as { message: string }).message, tone: 'fail' });
            break;
          default:
            break;
        }
      }
      if (phase === 'launching') setStatus((s) => s);
    } catch (e) {
      setPhase('failed');
      setError(`${LAUNCH.streamLost} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  if (phase === 'launching' || phase === 'done' || (phase === 'failed' && ca)) {
    return (
      <div className="qsd-stagepage">
        <LaunchSequence store={store} sources={sources} className="h-full w-full" />
        <div className="qsd-stagepage__term">
          <LaunchStreamTerminal lines={lines} running={phase === 'launching'} className="max-h-[45vh] overflow-y-auto" />
        </div>
        <div className="qsd-stagepage__status">
          <p>{status}</p>
          {error ? <p className="qsd-form__error mt-1">{error}</p> : null}
          {ca ? (
            <Link className="qsd-btn mt-3 inline-flex" data-primary="true" href={routes.coin(ca)}>
              {LAUNCH.viewCoin}
            </Link>
          ) : null}
          <p className="qsd-note mt-2">{LAUNCH.stageNote}</p>
        </div>
      </div>
    );
  }

  const lam = (v: string | null, reason: string | null | undefined, label: string) => (v !== null ? <DataRow label={label} value={formatLamports(BigInt(v))} /> : <DataRow label={label} unavailable={{ reason: reason ?? LAUNCH.cost.unavailableReason }} />);

  return (
    <PageShell>
      <PageHero accent={ACCENT.collapse} eyebrow={LAUNCH.eyebrow} title={LAUNCH.title} body={PAGES.launch.body} arrows={PAGES.launch.arrows} figure={<RangesFigure />} />
      {quote.isPending ? (
        <LoadingPanel eyebrow={LAUNCH.costEyebrow} />
      ) : !quote.data || isUnavailable(quote.data) ? (
        <UnavailablePanel eyebrow={LAUNCH.quoteUnavailableEyebrow} reason={quote.data?.unavailable.reason ?? 'no response'} />
      ) : (
        <div className="qsd-pgrid qsd-pgrid--32">
          <Panel eyebrow={LAUNCH.eyebrow}>
            <p className="qsd-note mb-4">{q?.cluster === 'devnet' ? LAUNCH.devnetNotice : LAUNCH.mainnetNotice}</p>
            <form className="qsd-form" onSubmit={(e) => { e.preventDefault(); void launch(); }}>
              <label>
                {LAUNCH.form.name}
                <input className="qsd-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required />
              </label>
              <label>
                {LAUNCH.form.ticker}
                <input className="qsd-input uppercase" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} maxLength={10} pattern="[A-Za-z0-9]{1,10}" required />
              </label>
              <label>
                {LAUNCH.form.image}
                <input className="qsd-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} required />
              </label>
              <label>
                {LAUNCH.form.description}
                <textarea className="qsd-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} />
              </label>
              <label>
                {LAUNCH.form.halfLife}
                <select className="qsd-input" value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {HALF_LIFE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} (auto-measurement after {p.maxWindowSec / 3600} h)
                    </option>
                  ))}
                </select>
              </label>
              {!publicKey ? <Empty eyebrow={LAUNCH.noWalletEyebrow} sentence={LAUNCH.noWalletSentence} /> : null}
              <div className="qsd-form__actions">
                <button type="submit" className="qsd-btn" data-primary="true" disabled={!canLaunch}>
                  {phase === 'paying' ? LAUNCH.form.paying : LAUNCH.form.submit}
                </button>
                {error ? (
                  <p className="qsd-form__error">
                    {LAUNCH.errorEyebrow}: {error}
                  </p>
                ) : null}
              </div>
            </form>
          </Panel>
          <div className="qsd-pblock">
            <Panel eyebrow={LAUNCH.costEyebrow}>
              {lam(q!.launchCostLamports, q!.reasons.launchCost, LAUNCH.cost.launch)}
              {lam(q!.identityReserveLamports, q!.reasons.identityReserve, LAUNCH.cost.identity)}
              {lam(q!.devBuyLamports, q!.reasons.devBuy, LAUNCH.cost.devBuy)}
              {total !== null ? <DataRow label={LAUNCH.cost.total} value={formatLamports(total)} /> : <DataRow label={LAUNCH.cost.total} unavailable={{ reason: LAUNCH.cost.unavailableReason }} />}
              {q!.payTo ? <DataRow label={LAUNCH.cost.payTo} value={q!.payTo} /> : <DataRow label={LAUNCH.cost.payTo} unavailable={{ reason: q!.reasons.payTo ?? LAUNCH.cost.unavailableReason }} />}
            </Panel>
            <div className="qsd-pblock">
              <LaunchPreflightTerminal quote={q!} wallet={publicKey?.toBase58() ?? null} name={name} ticker={ticker} image={image} devBuyLamports={devBuyLamports} total={total} />
            </div>
            <p className="qsd-note mt-4">{LAUNCH.identityNote}</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
