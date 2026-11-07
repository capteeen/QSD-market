import type { Address } from 'viem';

/**
 * Canonical testnet addresses from https://elysium.kinetiq.xyz/docs/contract-addresses
 * (last updated 20 Oct 2026). Look-alike tokens exist; do not substitute another WHYPE.
 */
export const WHYPE_TESTNET: Address = '0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234';

/**
 * Mainnet (chain 99901) contracts checked against a live node on 7 Nov 2026.
 * The Uniswap v2 router reports this factory and this WHYPE. WHYPE's symbol is WHYPE.
 */
export const WHYPE_MAINNET: Address = '0xbA876237B0F021A6c6D852d6c26E107997cC5E81';
export const UNISWAP_V2_FACTORY_MAINNET: Address = '0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2';
export const UNISWAP_V2_ROUTER_MAINNET: Address = '0xE783DE89a7F0408687f051e3E6D0BEb62719EbAd';

export const USDC_TESTNET: Address = '0x7D29d8047B905000459c0E80c34a26CeedcB47b2';

export const MULTICALL3_TESTNET: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';
