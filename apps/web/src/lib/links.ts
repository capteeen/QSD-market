import type { Cluster } from './env';
import { ELYSIUM_TESTNET_EXPLORER } from '@qsd/elysium/chain';

/**
 * Testnet explorer published by Kinetiq. Mainnet's explorer is not published;
 * those links go to the page that says so, not to an invented host.
 */
const MAINNET_UNPUBLISHED = 'https://elysium.kinetiq.xyz/docs/connecting-to-elysium';

function explorerBase(cluster: Cluster): string {
  return cluster === 'mainnet' ? MAINNET_UNPUBLISHED : ELYSIUM_TESTNET_EXPLORER;
}

export function explorerTx(sig: string, cluster: Cluster): string {
  if (cluster === 'mainnet') return MAINNET_UNPUBLISHED;
  return `${explorerBase(cluster)}/tx/${sig}`;
}

export function explorerAddress(addr: string, cluster: Cluster): string {
  if (cluster === 'mainnet') return MAINNET_UNPUBLISHED;
  return `${explorerBase(cluster)}/address/${addr}`;
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
