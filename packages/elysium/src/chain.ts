import { defineChain, type Chain } from 'viem';

/**
 * Elysium testnet, as published by Kinetiq.
 * https://elysium.kinetiq.xyz/docs/connecting-to-elysium
 *
 * Do not use viem's bundled `elysiumTestnet` export. That is a different chain.
 * Mainnet chain ID, RPC and explorer are not published (announced for 9 Nov 2026).
 * This module does not invent them.
 */
export const ELYSIUM_TESTNET_ID = 99801;

/** Public RPC. Shared by every user; a provider URL belongs in ELYSIUM_RPC_URL. */
export const ELYSIUM_TESTNET_RPC = 'https://testnet-rpc.elysium.kinetiq.xyz';

/** Alchemy testnet RPC. The key is not embedded; callers append it. */
export const ELYSIUM_TESTNET_ALCHEMY_RPC = 'https://elysium-testnet.g.alchemy.com/v2/';

/** Block explorer published for testnet. Mainnet explorer is not published. */
export const ELYSIUM_TESTNET_EXPLORER = 'https://elysium.kinetiq.xyz/testnet-explorer';

export const elysiumTestnet: Chain = defineChain({
  id: ELYSIUM_TESTNET_ID,
  name: 'Elysium Testnet',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: [ELYSIUM_TESTNET_RPC] },
  },
  blockExplorers: {
    default: { name: 'Elysium Testnet Explorer', url: ELYSIUM_TESTNET_EXPLORER },
  },
});

/** Mainnet is unpublished. Calling this is the honest failure, not a guessed chain id. */
export function elysiumMainnet(): never {
  throw new Error(
    'Elysium mainnet chain ID, RPC and block explorer are not published yet. Kinetiq lists them as coming at launch (announced for 9 Nov 2026). This build targets Elysium testnet (chain ID 99801) only.',
  );
}
