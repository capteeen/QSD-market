'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, type Connection } from '@solana/web3.js';
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

/** Server refusals that mean the remembered payment can never buy a launch (server/launch.ts verifyPayment). */
const BAD_PAYMENT = /this payment was already used|^payment |payment transaction|the wallet did not sign the payment/;

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

/** Poll the signature (no websocket: the /api/rpc relay is HTTP only) until it is confirmed, fails, or ~90 s pass. */
async function waitForConfirmation(connection: Connection, signature: string): Promise<void> {
  for (let i = 0; i < 45; i++) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const st = value[0];
    if (st?.err) throw new Error(`payment transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`payment ${signature} was not confirmed in time; check it in your wallet before trying again`);
}

/**
 * A confirmed payment the server has not used yet. A launch that fails before
 * the coin exists leaves its payment unused, and the server accepts it once
 * more, so a retry does not pay twice. Kept per wallet in this browser; cleared
 * once the coin is created.
 */
interface PendingPayment {
  signature: string;
  lamports: string;
}
const pendingKey = (wallet: string) => `qsd:launch-payment:${wallet}`;
function readPendingPayment(wallet: string): PendingPayment | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(pendingKey(wallet)) ?? 'null') as PendingPayment | null;
    return v && typeof v.signature === 'string' && typeof v.lamports === 'string' ? v : null;
  } catch {
    return null;
  }
}
function writePendingPayment(wallet: string, p: PendingPayment | null): void {
  try {
    if (p) window.localStorage.setItem(pendingKey(wallet), JSON.stringify(p));
    else window.localStorage.removeItem(pendingKey(wallet));
  } catch {
    // storage unavailable: a retry pays again
  }
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
  const [presetChoice, setPreset] = useState<string>(HALF_LIFE_PRESETS[2]!.id);
  const [image, setImage] = useState<File | null>(null);

  const q = quote.data && !isUnavailable(quote.data) ? quote.data : null;
  const presets = q?.presets?.length ? q.presets : HALF_LIFE_PRESETS;
  const preset = presets.some((p) => p.id === presetChoice) ? presetChoice : presets[0]!.id;
  const devBuyLamports = q && q.devBuyLamports !== null ? BigInt(q.devBuyLamports) : null;
  const total = q && q.launchCostLamports !== null && q.identityReserveLamports !== null && devBuyLamports !== null ? BigInt(q.launchCostLamports) + BigInt(q.identityReserveLamports) + devBuyLamports : null;
  const canLaunch = !!q && !!q.payTo && total !== null && !!publicKey && !!image && name.trim().length > 0 && /^[A-Za-z0-9]{1,10}$/.test(ticker) && (phase === 'form' || phase === 'failed');
  const [pending, setPending] = useState<PendingPayment | null>(null);
  useEffect(() => {
    if (!publicKey) {
      setPending(null);
      return;
    }
    // /launch?payment=<signature> recovers a payment made before this page remembered payments.
    // The server still checks it: signed by this wallet, enough lamports, never used.
    const fromUrl = new URLSearchParams(window.location.search).get('payment');
    if (fromUrl && /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(fromUrl) && total !== null && !readPendingPayment(publicKey.toBase58())) {
      writePendingPayment(publicKey.toBase58(), { signature: fromUrl, lamports: total.toString() });
    }
    setPending(readPendingPayment(publicKey.toBase58()));
  }, [publicKey, phase, total]);
  const reusable = pending && total !== null && pending.lamports === total.toString() ? pending : null;

  const launch = async () => {
    if (!q || !q.payTo || total === null || !publicKey || !image) return;
    const wallet = publicKey.toBase58();
    setError(null);
    setLines([]);
    setSources({});
    // a retry starts the sequence from an empty scene
    const scene = createSceneStore();
    storeRef.current = scene;
    let paymentSignature: string;
    const earlier = readPendingPayment(wallet);
    if (earlier && earlier.lamports === total.toString()) {
      paymentSignature = earlier.signature;
    } else {
      setPhase('paying');
      setStatus(LAUNCH.form.paying);
      try {
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(q.payTo), lamports: total }));
        paymentSignature = await sendTransaction(tx, connection);
        await waitForConfirmation(connection, paymentSignature);
      } catch (e) {
        setPhase('failed');
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      writePendingPayment(wallet, { signature: paymentSignature, lamports: total.toString() });
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
      if (BAD_PAYMENT.test(text)) writePendingPayment(wallet, null);
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
            scene.dispatchMany(events);
            print(...cryptoStreamLines(events));
            break;
          }
          case 'superposition': {
            const s = JSON.parse(f.data) as { supplyMin: string; supplyMax: string; halfLifeSec: number; decayChannels: SuperpositionInput['decayChannels'] };
            const input: SuperpositionInput = { supplyMin: BigInt(s.supplyMin), supplyMax: BigInt(s.supplyMax), halfLifeSec: s.halfLifeSec, decayChannels: s.decayChannels };
            setSources((x) => ({ ...x, superposition: input }));
            scene.dispatch({ type: 'superposition', input });
            print({ channel: 'state', text: `superposition supply ${s.supplyMin}…${s.supplyMax} · half-life ${s.halfLifeSec}s · ${s.decayChannels.length} decay channels` });
            break;
          }
          case 'quantum': {
            const e = JSON.parse(f.data) as QuantumEvent | (Omit<Extract<QuantumEvent, { type: 'entropyArrived' }>, 'bytes'> & { bytes: string });
            const ev: QuantumEvent = e.type === 'entropyArrived' ? { ...e, bytes: hexToBytes(e.bytes as string) } : (e as QuantumEvent);
            scene.dispatch(ev);
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
            scene.dispatch(ev);
            print({ channel: 'chain', text: ev.type === 'anchored' ? `anchored ${ev.txSignature}${ev.slot !== undefined ? ` slot ${ev.slot}` : ''}` : `anchorSubmitted ${ev.txSignature ?? ''}`, ...(ev.type === 'anchored' ? { tone: 'ok' as const } : {}) });
            break;
          }
          case 'launch':
            // the coin exists on-chain: this payment is spent, never offer it for a retry
            writePendingPayment(wallet, null);
            setCa((JSON.parse(f.data) as { ca: string }).ca);
            print({ channel: 'launch', text: `coin address ${(JSON.parse(f.data) as { ca: string }).ca}`, tone: 'ok' });
            break;
          case 'lineage': {
            const input = JSON.parse(f.data) as LineageInput;
            setSources((x) => ({ ...x, lineage: input }));
            scene.dispatch({ type: 'lineage', input });
            break;
          }
          case 'done':
            setPhase('done');
            setStatus(LAUNCH.done);
            print({ channel: 'done', text: LAUNCH.done, tone: 'ok' });
            break;
          case 'error':
            if (BAD_PAYMENT.test((JSON.parse(f.data) as { message: string }).message)) writePendingPayment(wallet, null);
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
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} (auto-measurement after {p.maxWindowSec >= 3600 ? `${p.maxWindowSec / 3600} h` : p.maxWindowSec >= 120 ? `${p.maxWindowSec / 60} min` : `${p.maxWindowSec} s`})
                    </option>
                  ))}
                </select>
              </label>
              {!publicKey ? <Empty eyebrow={LAUNCH.noWalletEyebrow} sentence={LAUNCH.noWalletSentence} /> : null}
              <div className="qsd-form__actions">
                <button type="submit" className="qsd-btn" data-primary="true" disabled={!canLaunch}>
                  {phase === 'paying' ? LAUNCH.form.paying : reusable ? LAUNCH.form.retry : LAUNCH.form.submit}
                </button>
                {reusable ? <p className="qsd-note">{LAUNCH.form.reusePayment}</p> : null}
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
