import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  ELYSIUM_TESTNET_ID,
  ELYSIUM_TESTNET_RPC,
  ELYSIUM_TESTNET_EXPLORER,
  WHYPE_TESTNET,
  USDC_TESTNET,
  MULTICALL3_TESTNET,
  elysiumTestnet,
  elysiumMainnet,
  anchorCalldata,
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
    expect(() => elysiumMainnet()).toThrow(/not published/);
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
