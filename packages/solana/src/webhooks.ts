/**
 * Helius enhanced-transaction webhooks → BuyEvent[] for the Zeno reset.
 *
 * Confirmed 2026-10-09:
 *   - Webhook auth: the `authHeader` value set when creating the webhook is
 *     echoed by Helius "in the `Authorization` header when sending data to
 *     your webhook endpoint" (https://www.helius.dev/docs/faqs/webhooks.md).
 *   - Payload: a JSON array of enhanced transactions with `signature`, `slot`,
 *     `timestamp`, `type` (e.g. SWAP), `source`, `fee`, `feePayer`,
 *     `nativeTransfers[{amount, fromUserAccount, toUserAccount}]`,
 *     `tokenTransfers[{fromTokenAccount, fromUserAccount, mint, toTokenAccount,
 *     toUserAccount, tokenAmount, tokenStandard}]`, `accountData[...]`, `events`
 *     (https://www.helius.dev/docs/webhooks). `SWAP` is a listed transaction
 *     type (https://www.helius.dev/docs/webhooks/transaction-types.md).
 *   - `events.swap` (nativeInput/nativeOutput/tokenInputs/tokenOutputs) is the
 *     shape of Helius's SDK `SwapEvent`; the public docs fetched today show
 *     only the NFT event, so it is used as an optional refinement and the
 *     documented transfer arrays are the primary signal.
 *   - Webhook types `enhanced` (mainnet) and `enhancedDevnet` exist
 *     (https://www.helius.dev/docs/api-reference/webhooks/create-webhook.md).
 */
import { timingSafeEqual } from 'node:crypto';
import { WebhookAuthError, ChainError } from './errors.js';

export interface HeliusNativeTransfer {
  amount: number;
  fromUserAccount: string;
  toUserAccount: string;
}
export interface HeliusTokenTransfer {
  fromTokenAccount?: string;
  fromUserAccount?: string;
  toTokenAccount?: string;
  toUserAccount?: string;
  mint: string;
  /** UI amount (decimal), as Helius sends it. */
  tokenAmount: number;
  tokenStandard?: string;
}
export interface HeliusRawTokenAmount {
  tokenAmount: string;
  decimals: number;
}
export interface HeliusSwapTokenIO {
  userAccount: string;
  tokenAccount: string;
  mint: string;
  rawTokenAmount: HeliusRawTokenAmount;
}
export interface HeliusSwapEvent {
  nativeInput?: { account: string; amount: string | number } | null;
  nativeOutput?: { account: string; amount: string | number } | null;
  tokenInputs?: HeliusSwapTokenIO[];
  tokenOutputs?: HeliusSwapTokenIO[];
  [k: string]: unknown;
}
export interface HeliusEnhancedTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  source?: string;
  fee?: number;
  feePayer: string;
  description?: string;
  nativeTransfers?: HeliusNativeTransfer[];
  tokenTransfers?: HeliusTokenTransfer[];
  accountData?: unknown[];
  events?: { swap?: HeliusSwapEvent; [k: string]: unknown };
  transactionError?: unknown;
}

export interface BuyEvent {
  mint: string;
  buyer: string;
  /** SOL paid by the buyer, lamports. */
  lamports: bigint;
  slot: number;
  signature: string;
  /** Unix seconds from the transaction. */
  timestamp: number;
  /** Token units received when `events.swap` reports them; UI amount otherwise. */
  tokenUnits?: bigint;
  tokenUiAmount: number;
  type: string;
  source?: string;
}

export function verifyWebhookAuth(authHeader: string | undefined, secret: string | undefined): void {
  if (!secret) throw new WebhookAuthError('QSD_WEBHOOK_SECRET is unset; refusing to accept webhooks without authentication');
  if (!authHeader) throw new WebhookAuthError('missing Authorization header');
  const a = Buffer.from(authHeader);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookAuthError('Authorization header does not match the webhook secret');
}

function isTx(x: unknown): x is HeliusEnhancedTransaction {
  return typeof x === 'object' && x !== null && typeof (x as HeliusEnhancedTransaction).signature === 'string' && typeof (x as HeliusEnhancedTransaction).feePayer === 'string';
}

/** Extract buys of `mint` (buyer received the token and paid SOL) from one transaction. */
export function buyEventsFromTransaction(tx: HeliusEnhancedTransaction, mints?: ReadonlySet<string>): BuyEvent[] {
  if (tx.transactionError) return [];
  const buyer = tx.feePayer;
  const out: BuyEvent[] = [];
  const received = new Map<string, { ui: number; units?: bigint }>();
  for (const t of tx.tokenTransfers ?? []) {
    if (t.toUserAccount !== buyer || t.fromUserAccount === buyer) continue;
    if (mints && !mints.has(t.mint)) continue;
    const cur = received.get(t.mint) ?? { ui: 0 };
    cur.ui += Number(t.tokenAmount) || 0;
    received.set(t.mint, cur);
  }
  const swap = tx.events?.swap;
  if (swap?.tokenOutputs) {
    for (const o of swap.tokenOutputs) {
      if (o.userAccount !== buyer) continue;
      if (mints && !mints.has(o.mint)) continue;
      const cur = received.get(o.mint) ?? { ui: 0 };
      try {
        cur.units = (cur.units ?? 0n) + BigInt(o.rawTokenAmount.tokenAmount);
      } catch {
        /* non-integer raw amount: leave units undefined */
      }
      received.set(o.mint, cur);
    }
  }
  if (received.size === 0) return out;

  let lamports = 0n;
  if (swap?.nativeInput && swap.nativeInput.account === buyer) {
    lamports = BigInt(Math.round(Number(swap.nativeInput.amount)));
  } else {
    for (const n of tx.nativeTransfers ?? []) {
      if (n.fromUserAccount === buyer && n.toUserAccount !== buyer) lamports += BigInt(Math.round(n.amount));
    }
  }
  if (lamports <= 0n) return out; // token in but no SOL out: a transfer/airdrop, not a buy
  for (const [mint, r] of received) {
    const ev: BuyEvent = { mint, buyer, lamports, slot: tx.slot, signature: tx.signature, timestamp: tx.timestamp, tokenUiAmount: r.ui, type: tx.type };
    if (r.units !== undefined) ev.tokenUnits = r.units;
    if (tx.source !== undefined) ev.source = tx.source;
    out.push(ev);
  }
  return out;
}

export interface ParseWebhookOptions {
  secret: string | undefined;
  /** Only these mints are reported; all when omitted. */
  mints?: Iterable<string>;
}

/**
 * Authenticate and parse one webhook delivery. Throws WebhookAuthError on a
 * bad or missing Authorization header, ChainError on a malformed body.
 */
export function parseHeliusWebhook(body: unknown, authHeader: string | undefined, opts: ParseWebhookOptions): BuyEvent[] {
  verifyWebhookAuth(authHeader, opts.secret);
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ChainError('webhook body is not valid JSON');
    }
  }
  if (!Array.isArray(parsed)) throw new ChainError('webhook body must be a JSON array of enhanced transactions');
  const mints = opts.mints ? new Set(opts.mints) : undefined;
  const out: BuyEvent[] = [];
  for (const tx of parsed) {
    if (!isTx(tx)) continue;
    out.push(...buyEventsFromTransaction(tx, mints));
  }
  return out;
}

/** The documented create-webhook request (https://www.helius.dev/docs/api-reference/webhooks/create-webhook.md). */
export function buildHeliusWebhookRegistration(args: { webhookUrl: string; mints: string[]; cluster: 'devnet' | 'mainnet-beta'; secret: string }): {
  url: (apiKey: string) => string;
  body: { webhookURL: string; transactionTypes: string[]; accountAddresses: string[]; webhookType: 'enhanced' | 'enhancedDevnet'; authHeader: string; txnStatus: 'success' };
} {
  return {
    url: (apiKey) => `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`,
    body: {
      webhookURL: args.webhookUrl,
      transactionTypes: ['SWAP'],
      accountAddresses: args.mints,
      webhookType: args.cluster === 'devnet' ? 'enhancedDevnet' : 'enhanced',
      authHeader: args.secret,
      txnStatus: 'success',
    },
  };
}
