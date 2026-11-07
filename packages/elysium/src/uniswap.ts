import { type Address, parseAbi } from 'viem';
import { UNISWAP_V2_FACTORY_MAINNET, UNISWAP_V2_ROUTER_MAINNET, UNISWAP_V3_FACTORY_MAINNET, UNISWAP_V3_POSITION_MANAGER_MAINNET, UNISWAP_V3_ROUTER_MAINNET, WHYPE_MAINNET } from './addresses.js';

export { UNISWAP_V2_FACTORY_MAINNET, UNISWAP_V2_ROUTER_MAINNET, UNISWAP_V3_FACTORY_MAINNET, UNISWAP_V3_POSITION_MANAGER_MAINNET, UNISWAP_V3_ROUTER_MAINNET, WHYPE_MAINNET };

/** 1% pool. Official factory tick spacing for this fee is 200. */
export const V3_FEE = 10_000;
/** SwapRouter02 sends the swap output to itself when the recipient is this address. */
export const V3_ADDRESS_THIS: Address = '0x0000000000000000000000000000000000000002';

/** Uniswap v2 fee is 0.30%. Five percent of a quoted fill is the worst price a wallet swap will accept. */
export const V2_FEE_BPS = 30n;
export const SWAP_SLIPPAGE_BPS = 500n;

export function minOut(quoted: bigint): bigint {
  if (quoted <= 0n) return 0n;
  return (quoted * (10_000n - SWAP_SLIPPAGE_BPS)) / 10_000n;
}

const Q96 = 2n ** 96n;

/**
 * Tokens out for an exact input that stays inside the current liquidity, using the Uniswap v3
 * sqrt-price formulas. Returns 0 when the pool has no liquidity.
 */
export function quoteV3ExactIn(params: {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  amountIn: bigint;
  /** True when the input token is token0. */
  zeroForOne: boolean;
  fee?: number;
}): bigint {
  const fee = BigInt(params.fee ?? V3_FEE);
  const amount = (params.amountIn * (1_000_000n - fee)) / 1_000_000n;
  if (amount === 0n || params.liquidity === 0n || params.sqrtPriceX96 === 0n) return 0n;
  if (params.zeroForOne) {
    const denominator = params.liquidity + (amount * params.sqrtPriceX96) / Q96;
    if (denominator === 0n) return 0n;
    const sqrtNext = (params.liquidity * params.sqrtPriceX96) / denominator;
    if (sqrtNext >= params.sqrtPriceX96) return 0n;
    return (params.liquidity * (params.sqrtPriceX96 - sqrtNext)) / Q96;
  }
  const sqrtNext = params.sqrtPriceX96 + (amount * Q96) / params.liquidity;
  return (params.liquidity * Q96 * (sqrtNext - params.sqrtPriceX96)) / (sqrtNext * params.sqrtPriceX96);
}

export const v2RouterAbi = parseAbi([
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
]);

export const v2FactoryAbi = parseAbi(['function getPair(address tokenA, address tokenB) view returns (address)']);

export const v2PairAbi = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]);

export const v3FactoryAbi = parseAbi(['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)']);

export const v3PoolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
  'function fee() view returns (uint24)',
]);

export const v3RouterAbi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
]);

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
