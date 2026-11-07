'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAccount, useConfig, useSendTransaction, useSignMessage } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { elysiumChain } from '@qsd/elysium/chain';
import { publicCluster } from '@/lib/env';
import { DataRow, Panel } from '@qsd/ui-tokens';
import { createSceneStore, decodeCryptoEvents, type ChainEvent, type LineageInput, type SceneStore, type SuperpositionInput } from '@qsd/scene/model';
import type { QuantumEvent } from '@qsd/quantum';
import { LAUNCH, PAGES } from '@/copy';
import { parseHypeToWei } from '@/lib/hype';
import { normalizeSocial, type SocialKind } from '@/lib/socials';
import { apiPost, isUnavailable } from '@/lib/api';
import type { LaunchChallengeResponse } from '@/lib/types';
import { formatHype, shortAddress } from '@/lib/format';
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
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { signMessageAsync } = useSignMessage();
  const wagmiConfig = useConfig();
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
  const [website, setWebsite] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [devBuy, setDevBuy] = useState('');
  const [image, setImage] = useState<File | null>(null);

  const q = quote.data && !isUnavailable(quote.data) ? quote.data : null;
  const devBuyParsed = (() => {
    try {
      return { wei: parseHypeToWei(devBuy), error: null as string | null };
    } catch (e) {
      return { wei: null as bigint | null, error: e instanceof Error ? e.message : String(e) };
    }
  })();
  const firstBuyWei = devBuyParsed.error ? null : (devBuyParsed.wei ?? 0n);
  const social = (kind: SocialKind, value: string): string | null => {
    try {
      normalizeSocial(kind, value);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  const websiteError = social('website', website);
  const twitterError = social('x', twitter);
  const telegramError = social('telegram', telegram);
  const socialsOk = !websiteError && !twitterError && !telegramError;
  const tickerOk = /^[A-Za-z0-9]{1,10}$/.test(ticker);
  const [tickerFree, setTickerFree] = useState(true);
  useEffect(() => {
    if (!tickerOk) {
      setTickerFree(true);
      return;
    }
    let alive = true;
    setTickerFree(false);
    void fetch(`/api/launch/preflight?ticker=${encodeURIComponent(ticker)}`, { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ problems?: string[] }>)
      .then((body) => {
        if (!alive) return;
        const taken = (body.problems ?? []).some((p) => p.includes(LAUNCH.form.tickerTaken));
        setTickerFree(!taken);
      })
      .catch(() => {
        if (alive) setTickerFree(true);
      });
    return () => {
      alive = false;
    };
  }, [ticker, tickerOk]);
  const canLaunch = !!q && !!q.payTo && firstBuyWei !== null && !!address && !!image && name.trim().length > 0 && tickerOk && tickerFree && socialsOk && (phase === 'form' || phase === 'failed');

  const launch = async () => {
    if (!q || !q.payTo || firstBuyWei === null || !address || !image) return;
    setError(null);
    setPhase('paying');
    setStatus(LAUNCH.form.checking);
    // Never ask for payment while a service the launch needs is down.
    try {
      const pre = (await (await fetch(`/api/launch/preflight?ticker=${encodeURIComponent(ticker)}`, { cache: 'no-store' })).json()) as { ok?: boolean; problems?: string[]; error?: string };
      if (!pre.ok) {
        setPhase('failed');
        setError(`${LAUNCH.notCharged} ${pre.problems?.join('; ') ?? pre.error ?? 'preflight failed'}`);
        return;
      }
    } catch (e) {
      setPhase('failed');
      setError(`${LAUNCH.notCharged} ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!signMessageAsync) {
      setPhase('failed');
      setError(`${LAUNCH.notCharged} ${LAUNCH.form.signing}`);
      return;
    }
    setStatus(LAUNCH.form.signing);
    const challenge = await apiPost<LaunchChallengeResponse>('/api/launch/challenge', { wallet: address, ticker: ticker.toUpperCase() });
    if (isUnavailable(challenge)) {
      setPhase('failed');
      setError(`${LAUNCH.notCharged} ${challenge.unavailable.reason}`);
      return;
    }
    let walletSignature = '';
    try {
      walletSignature = await signMessageAsync({ message: challenge.message });
    } catch (e) {
      setPhase('failed');
      setError(`${LAUNCH.notCharged} ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    let paymentSignature = '';
    if (firstBuyWei > 0n) {
      setStatus(LAUNCH.form.paying);
      try {
        paymentSignature = await sendTransactionAsync({ to: q.payTo as `0x${string}`, value: firstBuyWei, chainId: elysiumChain(publicCluster()).id });
        await waitForTransactionReceipt(wagmiConfig, { hash: paymentSignature as `0x${string}` });
      } catch (e) {
        setPhase('failed');
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setPhase('launching');
    setStatus(LAUNCH.form.launching);
    const fd = new FormData();
    fd.set('name', name.trim());
    fd.set('ticker', ticker.toUpperCase());
    fd.set('description', description);
    fd.set('website', website.trim());
    fd.set('twitter', twitter.trim());
    fd.set('telegram', telegram.trim());
    fd.set('devBuyWei', firstBuyWei.toString());
    fd.set('image', image);
    fd.set('wallet', address);
    fd.set('walletNonce', challenge.nonce);
    fd.set('walletSignature', walletSignature);
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
          case 'launch': {
            const launched = JSON.parse(f.data) as { ca: string; pair?: string };
            setCa(launched.ca);
            print({ channel: 'launch', text: launched.pair ? `coin ${launched.ca} · pool ${launched.pair}` : `coin address ${launched.ca}`, tone: 'ok' });
            break;
          }
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

  return (
    <PageShell>
      <PageHero accent={ACCENT.probability} eyebrow={LAUNCH.eyebrow} title={LAUNCH.title} body={PAGES.launch.body} arrows={PAGES.launch.arrows} figure={<RangesFigure />} />
      {quote.isPending ? (
        <LoadingPanel eyebrow={LAUNCH.previewEyebrow} />
      ) : !quote.data || isUnavailable(quote.data) ? (
        <UnavailablePanel eyebrow={LAUNCH.quoteUnavailableEyebrow} reason={quote.data?.unavailable.reason ?? 'no response'} />
      ) : (
        <div className="qsd-pgrid qsd-pgrid--32">
          <Panel eyebrow={LAUNCH.eyebrow}>
            <p className="qsd-note mb-4">{q?.cluster === 'mainnet' ? LAUNCH.mainnetNotice : LAUNCH.devnetNotice}</p>
            <form className="qsd-form" onSubmit={(e) => { e.preventDefault(); void launch(); }}>
              <label>
                {LAUNCH.form.image}
                <input className="qsd-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} required />
                <span className="qsd-note">{LAUNCH.form.imageHint}</span>
              </label>
              <label>
                {LAUNCH.form.name}
                <input className="qsd-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required />
              </label>
              <label>
                {LAUNCH.form.ticker}
                <input className="qsd-input uppercase" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} maxLength={10} pattern="[A-Za-z0-9]{1,10}" required />
                <span className="qsd-note">{LAUNCH.form.noVamp}</span>
              </label>
              <label>
                {LAUNCH.form.description}
                <span className="qsd-note"> {LAUNCH.form.optional}</span>
                <textarea className="qsd-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} placeholder={LAUNCH.form.descriptionPlaceholder} />
              </label>
              <label>
                {LAUNCH.form.website}
                <span className="qsd-note"> {LAUNCH.form.optional}</span>
                <input className="qsd-input" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200} inputMode="url" placeholder="yourcoin.xyz" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </label>
              {websiteError ? <p className="qsd-form__error">{websiteError}</p> : null}
              <label>
                {LAUNCH.form.twitter}
                <span className="qsd-note"> {LAUNCH.form.optional}</span>
                <input className="qsd-input" value={twitter} onChange={(e) => setTwitter(e.target.value)} maxLength={200} placeholder="@handle" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </label>
              {twitterError ? <p className="qsd-form__error">{twitterError}</p> : null}
              <label>
                {LAUNCH.form.telegram}
                <span className="qsd-note"> {LAUNCH.form.optional}</span>
                <input className="qsd-input" value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={200} placeholder="@handle" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </label>
              {telegramError ? <p className="qsd-form__error">{telegramError}</p> : null}
              <label>
                {LAUNCH.form.firstBuy}
                <span className="qsd-note"> {LAUNCH.form.optional}</span>
                <span className="qsd-form__amount">
                  <input className="qsd-input" value={devBuy} onChange={(e) => setDevBuy(e.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.00" />
                  <span className="qsd-form__unit">HYPE</span>
                </span>
              </label>
              {devBuyParsed.error ? <p className="qsd-form__error">{devBuyParsed.error}</p> : <span className="qsd-note">{LAUNCH.form.firstBuyNote}</span>}
              {!address ? <Empty eyebrow={LAUNCH.noWalletEyebrow} sentence={LAUNCH.noWalletSentence} /> : null}
              <div className="qsd-form__actions">
                <button type="submit" className="qsd-btn" data-primary="true" disabled={!canLaunch}>
                  {phase === 'paying' ? status ?? LAUNCH.form.paying : !address ? LAUNCH.form.connect : firstBuyWei !== null && firstBuyWei > 0n ? LAUNCH.form.submit : LAUNCH.form.launch}
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
            <Panel eyebrow={LAUNCH.previewEyebrow}>
              <p className="qsd-launch-preview__name">{name.trim() || LAUNCH.preview.untitled}</p>
              <p className="qsd-launch-preview__pair">{ticker ? `$${ticker} / HYPE` : LAUNCH.preview.pair}</p>
              <DataRow label={LAUNCH.cost.launch} value={LAUNCH.cost.launchFree} />
              {q!.poolSeedWei ? <DataRow label={LAUNCH.cost.opensAt} value={formatHype(BigInt(q!.poolSeedWei))} /> : null}
              {firstBuyWei !== null && firstBuyWei > 0n ? <DataRow label={LAUNCH.cost.firstBuy} value={formatHype(firstBuyWei)} /> : <DataRow label={LAUNCH.cost.firstBuy} value={devBuyParsed.error ? devBuyParsed.error : LAUNCH.cost.none} />}
              {firstBuyWei !== null && firstBuyWei > 0n ? <DataRow label={LAUNCH.cost.total} value={formatHype(firstBuyWei)} /> : <DataRow label={LAUNCH.cost.total} value={LAUNCH.cost.launchFree} />}
              <DataRow label={LAUNCH.preview.wallet} value={address ? shortAddress(address) : LAUNCH.preview.disconnected} />
              {q!.payTo ? null : <DataRow label={LAUNCH.cost.chain} unavailable={{ reason: q!.reasons.payTo ?? LAUNCH.cost.chainUnset }} />}
            </Panel>
            <div className="qsd-pblock">
              <LaunchPreflightTerminal quote={q!} wallet={address ?? null} name={name} ticker={ticker} tickerTaken={!tickerFree && tickerOk} image={image} devBuyLamports={firstBuyWei} total={firstBuyWei} />
            </div>
            <p className="qsd-note mt-4">{LAUNCH.identityNote}</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
