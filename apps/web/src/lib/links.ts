import type { Cluster } from './env';

export function explorerTx(sig: string, cluster: Cluster): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${cluster === 'mainnet-beta' ? 'mainnet' : 'devnet'}`;
}

export function explorerAddress(addr: string, cluster: Cluster): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${cluster === 'mainnet-beta' ? 'mainnet' : 'devnet'}`;
}

export function pumpFunCoin(ca: string): string {
  return `https://pump.fun/coin/${ca}`;
}

export const routes = {
  home: '/',
  field: '/field',
  coin: (ca: string) => `/coin/${ca}`,
  proof: (ca: string, measurementId: string) => `/coin/${ca}#m-${measurementId}`,
  lineage: (id: string) => `/lineage/${id}`,
  launch: '/launch',
  measure: '/measure',
  burns: '/burns',
  how: '/how',
  me: '/me',
} as const;
