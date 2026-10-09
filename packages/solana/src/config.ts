import { ChainConfigError } from './errors.js';

export type Cluster = 'devnet' | 'mainnet-beta';

export const ENV = {
  CLUSTER: 'SOLANA_CLUSTER',
  RPC_URL: 'SOLANA_RPC_URL',
  MAINNET_ENABLED: 'QSD_MAINNET_ENABLED',
  HELIUS_API_KEY: 'HELIUS_API_KEY',
  PUMPPORTAL_API_URL: 'PUMPPORTAL_API_URL',
  PINATA_JWT: 'PINATA_JWT',
  JUPITER_API_URL: 'JUPITER_API_URL',
  JUPITER_API_KEY: 'JUPITER_API_KEY',
  KEY_ENCRYPTION_KEY: 'QSD_KEY_ENCRYPTION_KEY',
  PROTOCOL_CREATOR_SECRET: 'QSD_PROTOCOL_CREATOR_SECRET',
  TOKEN_MINT: 'QSD_TOKEN_MINT',
  FEE_WALLET: 'QSD_FEE_WALLET',
  WEBHOOK_SECRET: 'QSD_WEBHOOK_SECRET',
  KEYSTORE_PATH: 'QSD_KEYSTORE_PATH',
  JOURNAL_DIR: 'QSD_JOURNAL_DIR',
} as const;

export const DEFAULT_PUMPPORTAL_API_URL = 'https://pumpportal.fun/api';
export const DEFAULT_JUPITER_API_URL = 'https://api.jup.ag';
export const DEFAULT_RPC_URL: Record<Cluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

export type EnvLike = Record<string, string | undefined>;

export interface ChainConfig {
  cluster: Cluster;
  isMainnet: boolean;
  rpcUrl: string;
  /** Helius API key. Optional on devnet (snapshot falls back to getProgramAccounts). */
  heliusApiKey?: string;
  pumpPortalApiUrl: string;
  /** Pinata JWT for pump.fun IPFS uploads (PumpPortal's documented path, see README). */
  pinataJwt?: string;
  jupiterApiUrl: string;
  jupiterApiKey?: string;
  /** 32-byte key-encryption key for every keypair at rest. */
  keyEncryptionKey: Uint8Array;
  /** Encrypted creator keypair blob (JSON) or a path to a file holding it. */
  protocolCreatorSecret?: string;
  qsdTokenMint?: string;
  feeWallet?: string;
  webhookSecret?: string;
  keystorePath?: string;
  journalDir?: string;
}

function readHex32(env: EnvLike, name: string): Uint8Array {
  const v = env[name];
  if (!v) throw new ChainConfigError(`${name} is required (64 hex chars = 32 bytes)`);
  if (!/^[0-9a-fA-F]{64}$/.test(v.trim())) {
    // never echo the value
    throw new ChainConfigError(`${name} must be exactly 64 hex characters (32 bytes); got ${v.trim().length} characters`);
  }
  const s = v.trim();
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function opt(env: EnvLike, name: string): string | undefined {
  const v = env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Read the chain configuration from an env-like object. Pure and total: it
 * throws `ChainConfigError` (naming the variable, never its value) when a
 * required value is missing or malformed, and it throws when
 * `SOLANA_CLUSTER=mainnet-beta` without `QSD_MAINNET_ENABLED=true`.
 */
export function loadChainConfig(env: EnvLike = process.env): ChainConfig {
  const clusterRaw = opt(env, ENV.CLUSTER) ?? 'devnet';
  if (clusterRaw !== 'devnet' && clusterRaw !== 'mainnet-beta') {
    throw new ChainConfigError(`${ENV.CLUSTER} must be 'devnet' or 'mainnet-beta'`);
  }
  const cluster: Cluster = clusterRaw;
  const isMainnet = cluster === 'mainnet-beta';
  if (isMainnet && opt(env, ENV.MAINNET_ENABLED) !== 'true') {
    throw new ChainConfigError(
      `${ENV.CLUSTER}=mainnet-beta requires the explicit integrator flag ${ENV.MAINNET_ENABLED}=true`,
    );
  }
  const keyEncryptionKey = readHex32(env, ENV.KEY_ENCRYPTION_KEY);
  const heliusApiKey = opt(env, ENV.HELIUS_API_KEY);
  const rpcUrl = opt(env, ENV.RPC_URL) ?? DEFAULT_RPC_URL[cluster];
  if (!/^https?:\/\//.test(rpcUrl)) throw new ChainConfigError(`${ENV.RPC_URL} must be an http(s) URL`);

  const cfg: ChainConfig = {
    cluster,
    isMainnet,
    rpcUrl,
    pumpPortalApiUrl: opt(env, ENV.PUMPPORTAL_API_URL) ?? DEFAULT_PUMPPORTAL_API_URL,
    jupiterApiUrl: opt(env, ENV.JUPITER_API_URL) ?? DEFAULT_JUPITER_API_URL,
    keyEncryptionKey,
  };
  if (heliusApiKey) cfg.heliusApiKey = heliusApiKey;
  const pinata = opt(env, ENV.PINATA_JWT);
  if (pinata) cfg.pinataJwt = pinata;
  const jk = opt(env, ENV.JUPITER_API_KEY);
  if (jk) cfg.jupiterApiKey = jk;
  const cs = opt(env, ENV.PROTOCOL_CREATOR_SECRET);
  if (cs) cfg.protocolCreatorSecret = cs;
  const mint = opt(env, ENV.TOKEN_MINT);
  if (mint) cfg.qsdTokenMint = mint;
  const fw = opt(env, ENV.FEE_WALLET);
  if (fw) cfg.feeWallet = fw;
  const ws = opt(env, ENV.WEBHOOK_SECRET);
  if (ws) cfg.webhookSecret = ws;
  const kp = opt(env, ENV.KEYSTORE_PATH);
  if (kp) cfg.keystorePath = kp;
  const jd = opt(env, ENV.JOURNAL_DIR);
  if (jd) cfg.journalDir = jd;
  return cfg;
}

/** Helius RPC URL for the cluster, or undefined when no key is configured. */
export function heliusRpcUrl(cfg: Pick<ChainConfig, 'cluster' | 'heliusApiKey'>): string | undefined {
  if (!cfg.heliusApiKey) return undefined;
  const host = cfg.cluster === 'devnet' ? 'devnet.helius-rpc.com' : 'mainnet.helius-rpc.com';
  return `https://${host}/?api-key=${cfg.heliusApiKey}`;
}

/** A copy of the config with every secret replaced, safe to log. */
export function describeConfig(cfg: ChainConfig): Record<string, unknown> {
  return {
    cluster: cfg.cluster,
    isMainnet: cfg.isMainnet,
    rpcUrl: cfg.rpcUrl.replace(/api-key=[^&]+/i, 'api-key=[redacted]'),
    heliusApiKey: cfg.heliusApiKey ? '[set]' : '[unset]',
    pumpPortalApiUrl: cfg.pumpPortalApiUrl,
    pinataJwt: cfg.pinataJwt ? '[set]' : '[unset]',
    jupiterApiUrl: cfg.jupiterApiUrl,
    jupiterApiKey: cfg.jupiterApiKey ? '[set]' : '[unset]',
    keyEncryptionKey: '[set]',
    protocolCreatorSecret: cfg.protocolCreatorSecret ? '[set]' : '[unset]',
    qsdTokenMint: cfg.qsdTokenMint ?? '[unset]',
    feeWallet: cfg.feeWallet ?? '[unset]',
    webhookSecret: cfg.webhookSecret ? '[set]' : '[unset]',
    keystorePath: cfg.keystorePath ?? '[unset]',
    journalDir: cfg.journalDir ?? '[unset]',
  };
}
