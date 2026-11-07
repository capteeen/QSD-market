/** Public (NEXT_PUBLIC_*) configuration. Read at call time; never defaulted to a made-up value. */
export type Cluster = 'testnet' | 'mainnet';

/** Elysium testnet unless a build explicitly asks for mainnet, which is not published. */
export function publicCluster(): Cluster {
  return process.env.NEXT_PUBLIC_ELYSIUM_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

export function publicWitnessKeys(): string[] {
  const raw = process.env.NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{64}$/.test(s));
}

/** Browser RPC. A public URL only; a keyed Alchemy URL stays on the server. */
export function publicRpcUrl(): string {
  const v = process.env.NEXT_PUBLIC_ELYSIUM_RPC_URL;
  return v && v.trim() ? v.trim() : 'https://testnet-rpc.elysium.kinetiq.xyz';
}
