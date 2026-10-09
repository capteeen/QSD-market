/** Public (NEXT_PUBLIC_*) configuration. Read at call time; never defaulted to a made-up value. */
export type Cluster = 'devnet' | 'mainnet-beta';

export function publicCluster(): Cluster {
  const v = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  return v === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
}

export function publicWitnessKeys(): string[] {
  const raw = process.env.NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{64}$/.test(s));
}

export function publicRpcUrl(): string | undefined {
  const v = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  return v && v.trim() ? v.trim() : undefined;
}
