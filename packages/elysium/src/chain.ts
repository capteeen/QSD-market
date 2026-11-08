import { defineChain, type Chain } from 'viem';

/**
 * Elysium, as published by Kinetiq.
 * https://elysium.kinetiq.xyz/docs/connecting-to-elysium
 *
 * Do not use viem's bundled `elysiumTestnet` export. That is a different chain.
 * Mainnet chain ID 99901 was published 7 Nov 2026. Kinetiq's own public mainnet
 * RPC and block explorer are still listed as coming at launch. Until that RPC
 * is published, `elysiumMainnet` uses a public relay that answers chain 99901
 * (the network the other Elysium launchpads tell wallets to add). Override it
 * with ELYSIUM_RPC_URL.
 */
export const ELYSIUM_TESTNET_ID = 99801;
export const ELYSIUM_MAINNET_ID = 99901;

/** Public testnet RPC. Shared by every user; a provider URL belongs in ELYSIUM_RPC_URL. */
export const ELYSIUM_TESTNET_RPC = 'https://testnet-rpc.elysium.kinetiq.xyz';

/**
 * Public relay for Elysium mainnet (chain 99901). Not Kinetiq's own endpoint.
 * Kinetiq lists that public RPC as coming at launch. This relay serves reads.
 * It refuses `eth_sendRawTransaction` for a contract creation
 * ("contract deployments aren't relayed").
 */
export const ELYSIUM_MAINNET_PUBLIC_RPC = 'https://rpc.thekleos.pro/rpc';

/**
 * Public relay that accepts contract deployments and other transactions on
 * Elysium mainnet. PerpMe documents it as the write endpoint while Kinetiq's
 * own mainnet RPC is partner-only. It does not serve `eth_getLogs`.
 */
export const ELYSIUM_MAINNET_WRITE_RPC = 'https://rpc-elysium.perpme.fun';

/** Kleos is the read relay. Sends, including a launcher deploy, go to the write relay. */
export function mainnetWriteRpc(readUrl: string): string {
  const trimmed = readUrl.trim();
  if (trimmed.replace(/\/$/, '') === ELYSIUM_MAINNET_PUBLIC_RPC.replace(/\/$/, '')) return ELYSIUM_MAINNET_WRITE_RPC;
  return trimmed;
}

/** Alchemy RPCs. The key is not embedded; callers append it. */
export const ELYSIUM_TESTNET_ALCHEMY_RPC = 'https://elysium-testnet.g.alchemy.com/v2/';
export const ELYSIUM_MAINNET_ALCHEMY_RPC = 'https://elysium-mainnet.g.alchemy.com/v2/';

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

export const elysiumMainnet: Chain = defineChain({
  id: ELYSIUM_MAINNET_ID,
  name: 'Elysium',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: [ELYSIUM_MAINNET_PUBLIC_RPC] },
  },
});

export function elysiumChain(cluster: 'mainnet' | 'testnet'): Chain {
  return cluster === 'mainnet' ? elysiumMainnet : elysiumTestnet;
}
