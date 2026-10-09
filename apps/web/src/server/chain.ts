import 'server-only';
import { createChain, loadChainConfig, type Chain } from '@qsd/solana';

/**
 * The chain layer from env, created once per process. `chainStatus()` never
 * throws: it reports why the chain is not configured so pages can say so.
 */
const g = globalThis as unknown as { __qsdChain?: { chain?: Chain; error?: string } };

function init(): { chain?: Chain; error?: string } {
  if (!g.__qsdChain) {
    try {
      g.__qsdChain = { chain: createChain(loadChainConfig(process.env)) };
    } catch (e) {
      g.__qsdChain = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return g.__qsdChain;
}

export function getChain(): Chain {
  const s = init();
  if (!s.chain) throw new Error(`the chain is not configured: ${s.error ?? 'unknown'}`);
  return s.chain;
}

export function chainStatus(): { configured: boolean; cluster: 'devnet' | 'mainnet-beta' | null; reason: string | null } {
  const s = init();
  if (s.chain) return { configured: true, cluster: s.chain.config.cluster, reason: null };
  return { configured: false, cluster: null, reason: s.error ?? null };
}

export function serverCluster(): 'devnet' | 'mainnet-beta' {
  const s = init();
  if (s.chain) return s.chain.config.cluster;
  return process.env.SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
}
