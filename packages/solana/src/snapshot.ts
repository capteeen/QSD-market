/**
 * Holder snapshot at the collapse block.
 *
 * Sources (real data only, never invented):
 *   1. Helius DAS `getTokenAccounts` by mint, cursor-paginated (limit 1000).
 *      Confirmed 2026-10-09 at https://www.helius.dev/docs/api-reference/das/gettokenaccounts
 *      params { mint, page?, limit, cursor?, options: { showZeroBalance } }
 *      result { total, limit, cursor?, token_accounts: [{ address, mint, owner, amount, delegated_amount, frozen }] }
 *   2. Fallback: `getProgramAccounts` on the Token program with
 *      { dataSize: 165 } + { memcmp: { offset: 0, bytes: mint } } (any RPC).
 *
 * Neither source serves historical state: both return the ledger as of the
 * slot they were served at (`observedSlot`). The collapse worker calls this
 * at the collapse moment; a snapshot observed before the requested slot is
 * refused rather than silently used.
 *
 * `balance` comes from the chain; `firstAcquiredAt`, the measurements held
 * through and the quiet-period flag come from a `HoldingHistory` the app
 * supplies (its trade-history DB). Without one this throws NotImplementedError
 * instead of defaulting any of them.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { AccountLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { HolderSnapshot, Measurement, UnixSeconds } from '@qsd/protocol';
import { ChainUnavailableError, NotImplementedError, errorMessage } from './errors.js';

export interface TokenAccountRow {
  address: string;
  owner: string;
  amount: bigint;
  frozen: boolean;
}

export interface TokenAccountPage {
  rows: TokenAccountRow[];
  /** Slot the source reports the data as of. */
  observedSlot: number;
  source: 'helius-das' | 'getProgramAccounts';
}

export interface TokenAccountSource {
  readonly name: TokenAccountPage['source'];
  listByMint(mint: string): Promise<TokenAccountPage>;
}

type FetchLike = typeof fetch;

interface DasTokenAccount {
  address: string;
  mint: string;
  owner: string;
  amount: number | string;
  delegated_amount?: number | string;
  frozen: boolean;
}
interface DasResponse {
  result?: { total: number; limit: number; cursor?: string; token_accounts: DasTokenAccount[]; last_indexed_slot?: number };
  error?: { code: number; message: string };
}

export const DAS_PAGE_LIMIT = 1000;

export class HeliusDasSource implements TokenAccountSource {
  readonly name = 'helius-das' as const;
  constructor(
    private readonly heliusRpcUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly pageLimit: number = DAS_PAGE_LIMIT,
  ) {}

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.heliusRpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'qsd', method, params }),
      });
    } catch (e) {
      throw new ChainUnavailableError(`Helius ${method}: ${errorMessage(e)}`, { cause: e });
    }
    if (!res.ok) throw new ChainUnavailableError(`Helius ${method} returned HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new ChainUnavailableError(`Helius ${method}: ${json.error.message}`);
    if (json.result === undefined) throw new ChainUnavailableError(`Helius ${method}: empty result`);
    return json.result;
  }

  async listByMint(mint: string): Promise<TokenAccountPage> {
    const slotBefore = await this.rpc<number>('getSlot', [{ commitment: 'confirmed' }]);
    const rows: TokenAccountRow[] = [];
    let cursor: string | undefined;
    let lastIndexed: number | undefined;
    for (let page = 0; ; page++) {
      const params: Record<string, unknown> = { mint, limit: this.pageLimit, options: { showZeroBalance: false } };
      if (cursor) params['cursor'] = cursor;
      const r = await this.rpc<NonNullable<DasResponse['result']>>('getTokenAccounts', params);
      if (!r || !Array.isArray(r.token_accounts)) throw new ChainUnavailableError('Helius getTokenAccounts: malformed result');
      for (const a of r.token_accounts) {
        if (a.mint !== mint) continue;
        rows.push({ address: a.address, owner: a.owner, amount: BigInt(a.amount), frozen: Boolean(a.frozen) });
      }
      if (typeof r.last_indexed_slot === 'number') lastIndexed = r.last_indexed_slot;
      if (!r.cursor || r.token_accounts.length === 0) break;
      cursor = r.cursor;
      if (page > 10_000) throw new ChainUnavailableError('Helius getTokenAccounts: pagination did not terminate');
    }
    return { rows, observedSlot: lastIndexed ?? slotBefore, source: this.name };
  }
}

export class ProgramAccountsSource implements TokenAccountSource {
  readonly name = 'getProgramAccounts' as const;
  constructor(private readonly connection: Connection) {}
  async listByMint(mint: string): Promise<TokenAccountPage> {
    const mintKey = new PublicKey(mint);
    try {
      const res = await this.connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
        commitment: 'confirmed',
        withContext: true,
        filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mintKey.toBase58() } }],
      });
      const rows: TokenAccountRow[] = res.value.map((a) => {
        const d = AccountLayout.decode(a.account.data);
        return { address: a.pubkey.toBase58(), owner: new PublicKey(d.owner).toBase58(), amount: BigInt(d.amount), frozen: d.state === 2 };
      });
      return { rows, observedSlot: res.context.slot, source: this.name };
    } catch (e) {
      throw new ChainUnavailableError(`getProgramAccounts(token, mint=${mint}): ${errorMessage(e)}`, { cause: e });
    }
  }
}

/** Sum every token account per owner; drop zero balances; sorted by wallet. */
export function mergeByOwner(rows: readonly TokenAccountRow[]): { wallet: string; balance: bigint }[] {
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(r.owner, (m.get(r.owner) ?? 0n) + r.amount);
  return [...m.entries()]
    .filter(([, b]) => b > 0n)
    .map(([wallet, balance]) => ({ wallet, balance }))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
}

export interface HoldingContext {
  mint: string;
  bornAt: UnixSeconds;
  collapseAt: UnixSeconds;
  collapseSlot: number;
  quietPeriodStart: UnixSeconds;
  measurements: readonly Pick<Measurement, 'id' | 'at' | 'outcome'>[];
}

export interface HoldingFacts {
  firstAcquiredAt: UnixSeconds;
  heldThroughMeasurementIds: string[];
  heldThroughQuietPeriod: boolean;
}

/**
 * Supplied by the app from its trade-history database (fed by the Helius
 * webhooks). The chain package cannot derive holding durations from a
 * point-in-time balance and refuses to guess them.
 */
export interface HoldingHistory {
  factsFor(wallet: string, balance: bigint, ctx: HoldingContext): Promise<HoldingFacts>;
}

export interface SnapshotRequest extends HoldingContext {
  /** Optional: wallets never included (e.g. the bonding curve / pool vault, the protocol treasury). */
  excludeOwners?: readonly string[];
}

export interface SnapshotResult {
  holders: HolderSnapshot[];
  requestedSlot: number;
  observedSlot: number;
  source: TokenAccountPage['source'];
  tokenAccounts: number;
}

export interface SnapshotDeps {
  sources: TokenAccountSource[];
  history?: HoldingHistory;
}

/**
 * Take the holder snapshot for a collapse. Tries each source in order
 * (DAS first when configured, then getProgramAccounts); if every source
 * fails the last error is thrown — no source ever returns invented rows.
 */
export async function holderSnapshotAtSlot(req: SnapshotRequest, deps: SnapshotDeps): Promise<SnapshotResult> {
  if (!deps.history) {
    throw new NotImplementedError(
      'holder snapshot',
      'a HoldingHistory (firstAcquiredAt, measurements held through, quiet-period flag per wallet) must be supplied by the app; the chain package will not default these to zero',
    );
  }
  if (deps.sources.length === 0) throw new ChainUnavailableError('no token-account source configured');
  let page: TokenAccountPage | undefined;
  const errors: string[] = [];
  for (const s of deps.sources) {
    try {
      page = await s.listByMint(req.mint);
      break;
    } catch (e) {
      errors.push(`${s.name}: ${errorMessage(e)}`);
    }
  }
  if (!page) throw new ChainUnavailableError(`every holder source failed — ${errors.join('; ')}`);
  if (page.observedSlot < req.collapseSlot) {
    throw new ChainUnavailableError(
      `holder data observed at slot ${page.observedSlot}, before the collapse slot ${req.collapseSlot}; retry once the source has caught up`,
    );
  }
  const excluded = new Set(req.excludeOwners ?? []);
  const merged = mergeByOwner(page.rows).filter((h) => !excluded.has(h.wallet));
  const holders: HolderSnapshot[] = [];
  for (const h of merged) {
    const f = await deps.history.factsFor(h.wallet, h.balance, req);
    if (!Number.isFinite(f.firstAcquiredAt) || f.firstAcquiredAt > req.collapseAt) {
      throw new ChainUnavailableError(`holding history returned an invalid firstAcquiredAt for ${h.wallet}`);
    }
    holders.push({
      wallet: h.wallet,
      balance: h.balance,
      firstAcquiredAt: f.firstAcquiredAt,
      heldThroughMeasurementIds: [...f.heldThroughMeasurementIds],
      heldThroughQuietPeriod: f.heldThroughQuietPeriod && f.firstAcquiredAt <= req.quietPeriodStart,
    });
  }
  return { holders, requestedSlot: req.collapseSlot, observedSlot: page.observedSlot, source: page.source, tokenAccounts: page.rows.length };
}
