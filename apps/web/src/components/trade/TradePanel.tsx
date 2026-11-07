'use client';
import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { getAddress, zeroAddress } from 'viem';
import { elysiumMainnet } from '@qsd/elysium/chain';
import {
  UNISWAP_V2_FACTORY_MAINNET,
  UNISWAP_V2_ROUTER_MAINNET,
  WHYPE_MAINNET,
  erc20Abi,
  minOut,
  v2FactoryAbi,
  v2PairAbi,
  v2RouterAbi,
} from '@qsd/elysium/uniswap';
import { DataRow, Panel } from '@qsd/ui-tokens';
import { COIN } from '@/copy';
import { publicCluster } from '@/lib/env';
import { formatHype, formatUnits } from '@/lib/format';
import { parseAmountWei } from '@/lib/hype';

const DEADLINE_SEC = 20 * 60;

interface ReadyPool {
  reserveHype: bigint;
  reserveToken: bigint;
}

export function TradePanel({ ca, ticker, decimals }: { ca: string; ticker: string; decimals: number }) {
  const client = usePublicClient();
  const { address, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const [pool, setPool] = useState<ReadyPool | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [buy, setBuy] = useState('');
  const [sell, setSell] = useState('');
  const [busy, setBusy] = useState<'buy' | 'sell' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (publicCluster() !== 'mainnet' || !client) return;
    let gone = false;
    const token = getAddress(ca);
    (async () => {
      try {
        const pair = await client.readContract({
          address: UNISWAP_V2_FACTORY_MAINNET,
          abi: v2FactoryAbi,
          functionName: 'getPair',
          args: [token, WHYPE_MAINNET],
        });
        if (pair.toLowerCase() === zeroAddress) {
          if (!gone) {
            setPool(null);
            setChecked(true);
          }
          return;
        }
        const [token0, reserves] = await Promise.all([
          client.readContract({ address: pair, abi: v2PairAbi, functionName: 'token0' }),
          client.readContract({ address: pair, abi: v2PairAbi, functionName: 'getReserves' }),
        ]);
        const tokenIs0 = token0.toLowerCase() === token.toLowerCase();
        const reserveToken = tokenIs0 ? reserves[0] : reserves[1];
        const reserveHype = tokenIs0 ? reserves[1] : reserves[0];
        if (!gone) {
          setPool({ reserveHype, reserveToken });
          setPoolError(null);
          setChecked(true);
        }
      } catch (e) {
        if (!gone) {
          setPoolError(e instanceof Error ? e.message : String(e));
          setChecked(true);
        }
      }
    })();
    return () => {
      gone = true;
    };
  }, [ca, client]);

  if (publicCluster() !== 'mainnet') return <p className="qsd-note mb-6">{COIN.tradeDevnet}</p>;
  if (!client) return <p className="qsd-note mb-6">{COIN.tradeNoClient}</p>;
  if (!checked) return <p className="qsd-note mb-6">{COIN.tradeChecking}</p>;
  if (poolError) return <p className="qsd-note mb-6">{poolError}</p>;
  if (!pool) return <p className="qsd-note mb-6">{COIN.tradeNone}</p>;

  const onWrongChain = chainId !== undefined && chainId !== elysiumMainnet.id;

  async function ensureChain(): Promise<void> {
    if (chainId !== undefined && chainId !== elysiumMainnet.id) await switchChainAsync({ chainId: elysiumMainnet.id });
  }

  async function onBuy(): Promise<void> {
    if (!address || !client) return;
    setError(null);
    setBusy('buy');
    try {
      const value = parseAmountWei(buy);
      if (value === null || value === 0n) throw new Error('enter a HYPE amount');
      await ensureChain();
      setStatus(COIN.tradeBuy);
      const quoted = await client.readContract({
        address: UNISWAP_V2_ROUTER_MAINNET,
        abi: v2RouterAbi,
        functionName: 'getAmountsOut',
        args: [value, [WHYPE_MAINNET, getAddress(ca)]],
      });
      const out = quoted[1];
      if (out === undefined || out === 0n) throw new Error('the pool returned no tokens');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SEC);
      await writeContractAsync({
        address: UNISWAP_V2_ROUTER_MAINNET,
        abi: v2RouterAbi,
        functionName: 'swapExactETHForTokens',
        args: [minOut(out), [WHYPE_MAINNET, getAddress(ca)], address, deadline],
        value,
        chainId: elysiumMainnet.id,
      });
      setStatus(`${formatUnits(out, decimals)} ${ticker}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(null);
    }
  }

  async function onSell(): Promise<void> {
    if (!address || !client) return;
    setError(null);
    setBusy('sell');
    try {
      const amount = parseAmountWei(sell, decimals);
      if (amount === null || amount === 0n) throw new Error('enter a token amount');
      await ensureChain();
      const token = getAddress(ca);
      const allowance = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, UNISWAP_V2_ROUTER_MAINNET],
      });
      if (allowance < amount) {
        setStatus(COIN.tradeSell);
        await writeContractAsync({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [UNISWAP_V2_ROUTER_MAINNET, amount],
          chainId: elysiumMainnet.id,
        });
      }
      const quoted = await client.readContract({
        address: UNISWAP_V2_ROUTER_MAINNET,
        abi: v2RouterAbi,
        functionName: 'getAmountsOut',
        args: [amount, [token, WHYPE_MAINNET]],
      });
      const out = quoted[1];
      if (out === undefined || out === 0n) throw new Error('the pool returned no HYPE');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SEC);
      await writeContractAsync({
        address: UNISWAP_V2_ROUTER_MAINNET,
        abi: v2RouterAbi,
        functionName: 'swapExactTokensForETH',
        args: [amount, minOut(out), [token, WHYPE_MAINNET], address, deadline],
        chainId: elysiumMainnet.id,
      });
      setStatus(formatHype(out));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6">
    <Panel eyebrow={COIN.trade}>
      <p className="qsd-note mb-3">{COIN.tradeFee}</p>
      <DataRow label={COIN.tradeHype} value={formatHype(pool.reserveHype)} />
      <DataRow label={ticker} value={formatUnits(pool.reserveToken, decimals)} />
      <p className="qsd-note mt-3">{COIN.tradeSlippage}</p>
      <div className="qsd-pgrid qsd-pgrid--2 mt-4">
        <label>
          {COIN.tradeBuy}
          <span className="qsd-form__amount">
            <input className="qsd-input" value={buy} onChange={(e) => setBuy(e.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.00" />
            <span className="qsd-form__unit">HYPE</span>
          </span>
        </label>
        <label>
          {COIN.tradeSell}
          <span className="qsd-form__amount">
            <input className="qsd-input" value={sell} onChange={(e) => setSell(e.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.00" />
            <span className="qsd-form__unit">{ticker}</span>
          </span>
        </label>
      </div>
      <div className="qsd-form__actions mt-4">
        {!address ? (
          <span className="qsd-note">{COIN.tradeConnect}</span>
        ) : onWrongChain ? (
          <button type="button" className="qsd-btn" data-primary="true" onClick={() => void switchChainAsync({ chainId: elysiumMainnet.id })}>
            {COIN.tradeSwitch}
          </button>
        ) : (
          <>
            <button type="button" className="qsd-btn" data-primary="true" disabled={busy !== null} onClick={() => void onBuy()}>
              {busy === 'buy' ? COIN.tradeChecking : COIN.tradeBuy}
            </button>
            <button type="button" className="qsd-btn" disabled={busy !== null} onClick={() => void onSell()}>
              {busy === 'sell' ? COIN.tradeChecking : COIN.tradeSell}
            </button>
          </>
        )}
      </div>
      {status ? <p className="qsd-note mt-3">{status}</p> : null}
      {error ? <p className="qsd-form__error mt-2">{error}</p> : null}
    </Panel>
    </div>
  );
}
