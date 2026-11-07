import { parseAbi } from 'viem';
import { UNISWAP_V2_FACTORY_MAINNET, UNISWAP_V2_ROUTER_MAINNET, WHYPE_MAINNET } from './addresses.js';

export { UNISWAP_V2_FACTORY_MAINNET, UNISWAP_V2_ROUTER_MAINNET, WHYPE_MAINNET };

/** Uniswap v2 fee is 0.30%. Five percent of a quoted fill is the worst price a wallet swap will accept. */
export const V2_FEE_BPS = 30n;
export const SWAP_SLIPPAGE_BPS = 500n;

export function minOut(quoted: bigint): bigint {
  if (quoted <= 0n) return 0n;
  return (quoted * (10_000n - SWAP_SLIPPAGE_BPS)) / 10_000n;
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

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
