import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  ELYSIUM_MAINNET_ID,
  ELYSIUM_MAINNET_PUBLIC_RPC,
  ELYSIUM_TESTNET_EXPLORER,
  ELYSIUM_TESTNET_ID,
  ELYSIUM_TESTNET_RPC,
  MULTICALL3_TESTNET,
  UNISWAP_V2_FACTORY_MAINNET,
  UNISWAP_V2_ROUTER_MAINNET,
  UNISWAP_V3_FACTORY_MAINNET,
  UNISWAP_V3_POSITION_MANAGER_MAINNET,
  UNISWAP_V3_ROUTER_MAINNET,
  USDC_TESTNET,
  WHYPE_MAINNET,
  WHYPE_TESTNET,
  anchorCalldata,
  elysiumMainnet,
  elysiumTestnet,
  predictedTokenAddress,
} from '../src/index';

describe('Elysium testnet, from the Kinetiq docs', () => {
  it('is chain 99801 with native HYPE and the published public RPC, not a guessed mainnet', () => {
    expect(elysiumTestnet.id).toBe(ELYSIUM_TESTNET_ID);
    expect(elysiumTestnet.id).toBe(99801);
    expect(elysiumTestnet.nativeCurrency).toEqual({ name: 'HYPE', symbol: 'HYPE', decimals: 18 });
    expect(elysiumTestnet.rpcUrls.default.http[0]).toBe(ELYSIUM_TESTNET_RPC);
    expect(elysiumTestnet.rpcUrls.default.http[0]).toBe('https://testnet-rpc.elysium.kinetiq.xyz');
    expect(elysiumTestnet.blockExplorers?.default.url).toBe(ELYSIUM_TESTNET_EXPLORER);
  });

  it('mainnet is chain 99901, the chain the other launchpads use', () => {
    expect(elysiumMainnet.id).toBe(ELYSIUM_MAINNET_ID);
    expect(elysiumMainnet.id).toBe(99901);
    expect(elysiumMainnet.nativeCurrency).toEqual({ name: 'HYPE', symbol: 'HYPE', decimals: 18 });
    expect(elysiumMainnet.rpcUrls.default.http[0]).toBe(ELYSIUM_MAINNET_PUBLIC_RPC);
    expect(elysiumMainnet.blockExplorers).toBeUndefined();
    expect(getAddress(WHYPE_MAINNET)).toBe('0xbA876237B0F021A6c6D852d6c26E107997cC5E81');
    expect(getAddress(UNISWAP_V2_FACTORY_MAINNET)).toBe('0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2');
    expect(getAddress(UNISWAP_V2_ROUTER_MAINNET)).toBe('0xE783DE89a7F0408687f051e3E6D0BEb62719EbAd');
    expect(getAddress(UNISWAP_V3_FACTORY_MAINNET)).toBe('0x1707327F626496A7b5b3872e7E4d2879Df7d7a9f');
    expect(getAddress(UNISWAP_V3_POSITION_MANAGER_MAINNET)).toBe('0xF025e0Fe9E331A0eF05c2ad3C4E9C64b625cda6f');
    expect(getAddress(UNISWAP_V3_ROUTER_MAINNET)).toBe('0x2d01411773c8C24805306E89A41F7855C3c4Fe65');
  });

  it('uses the canonical testnet WHYPE, USDC and Multicall3 addresses from the contract-addresses page', () => {
    expect(getAddress(WHYPE_TESTNET)).toBe('0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234');
    expect(getAddress(USDC_TESTNET)).toBe('0x7D29d8047B905000459c0E80c34a26CeedcB47b2');
    expect(getAddress(MULTICALL3_TESTNET)).toBe('0xcA11bde05977b3631167028862bE2a173976CA11');
  });

  it('anchor calldata is the protocol memo, and a predicted CREATE address is 20 bytes', () => {
    expect(anchorCalldata('precommit', 'ab'.repeat(32))).toBe(`0x${Buffer.from(`qsd:v1:precommit:${'ab'.repeat(32)}`).toString('hex')}`);
    const ca = predictedTokenAddress('0x0000000000000000000000000000000000000001', 2n);
    expect(ca).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
