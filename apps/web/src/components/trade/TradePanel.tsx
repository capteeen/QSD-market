'use client';
import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { encodeFunctionData, getAddress, zeroAddress, type Address } from 'viem';
import { elysiumMainnet } from '@qsd/elysium/chain';
import {
  UNISWAP_V3_FACTORY_MAINNET,
  UNISWAP_V3_ROUTER_MAINNET,
  V3_ADDRESS_THIS,
  V3_FEE,
  WHYPE_MAINNET,
  erc20Abi,
  minOut,
  quoteV3ExactIn,
  v3FactoryAbi,
  v3PoolAbi,
  v3RouterAbi,
} from '@qsd/elysium/uniswap';
import { DataRow, Panel } from '@qsd/ui-tokens';
import { COIN } from '@/copy';
import { publicCluster } from '@/lib/env';
import { formatHype, formatUnits } from '@/lib/format';
import { parseAmountWei } from '@/lib/hype';

const DEADLINE_SEC = 20 * 60;

interface ReadyPool {
  pool: Address;
  tokenIs0: boolean;
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
        const pool = await client.readContract({
          address: UNISWAP_V3_FACTORY_MAINNET,
          abi: v3FactoryAbi,
          functionName: 'getPool',
          args: [token, WHYPE_MAINNET, V3_FEE],
        });
        if (pool.toLowerCase() === zeroAddress) {
          if (!gone) {
            setPool(null);
            setChecked(true);
          }
          return;
        }
        const [token0, hypeIn, tokenIn] = await Promise.all([
          client.readContract({ address: pool, abi: v3PoolAbi, functionName: 'token0' }),
          client.readContract({ address: WHYPE_MAINNET, abi: erc20Abi, functionName: 'balanceOf', args: [pool] }),
          client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [pool] }),
        ]);
        if (!gone) {
          setPool({ pool, tokenIs0: token0.toLowerCase() === token.toLowerCase(), reserveHype: hypeIn, reserveToken: tokenIn });
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
  const ready = pool;

  const onWrongChain = chainId !== undefined && chainId !== elysiumMainnet.id;

  async function ensureChain(): Promise<void> {
    if (chainId !== undefined && chainId !== elysiumMainnet.id) await switchChainAsync({ chainId: elysiumMainnet.id });
  }

  async function quotePool(amountIn: bigint, sellingToken: boolean): Promise<bigint> {
    if (!client) return 0n;
    const [slot0, liquidity] = await Promise.all([
      client.readContract({ address: ready.pool, abi: v3PoolAbi, functionName: 'slot0' }),
      client.readContract({ address: ready.pool, abi: v3PoolAbi, functionName: 'liquidity' }),
    ]);
    return quoteV3ExactIn({
      sqrtPriceX96: slot0[0],
      liquidity,
      amountIn,
      zeroForOne: sellingToken ? ready.tokenIs0 : !ready.tokenIs0,
    });
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
      const token = getAddress(ca);
      const out = await quotePool(value, false);
      if (out === 0n) throw new Error('the pool returned no tokens');
      await writeContractAsync({
        address: UNISWAP_V3_ROUTER_MAINNET,
        abi: v3RouterAbi,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: WHYPE_MAINNET,
          tokenOut: token,
          fee: V3_FEE,
          recipient: address,
          amountIn: value,
          amountOutMinimum: minOut(out),
          sqrtPriceLimitX96: 0n,
        }],
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
        args: [address, UNISWAP_V3_ROUTER_MAINNET],
      });
      if (allowance < amount) {
        setStatus(COIN.tradeSell);
        await writeContractAsync({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [UNISWAP_V3_ROUTER_MAINNET, amount],
          chainId: elysiumMainnet.id,
        });
      }
      const out = await quotePool(amount, true);
      if (out === 0n) throw new Error('the pool returned no HYPE');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SEC);
      const swapData = encodeFunctionData({
        abi: v3RouterAbi,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: token,
          tokenOut: WHYPE_MAINNET,
          fee: V3_FEE,
          recipient: V3_ADDRESS_THIS,
          amountIn: amount,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        }],
      });
      const unwrapData = encodeFunctionData({
        abi: v3RouterAbi,
        functionName: 'unwrapWETH9',
        args: [minOut(out), address],
      });
      await writeContractAsync({
        address: UNISWAP_V3_ROUTER_MAINNET,
        abi: v3RouterAbi,
        functionName: 'multicall',
        args: [deadline, [swapData, unwrapData]],
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
      <DataRow label={COIN.tradeHype} value={formatHype(ready.reserveHype)} />
      <DataRow label={ticker} value={formatUnits(ready.reserveToken, decimals)} />
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
