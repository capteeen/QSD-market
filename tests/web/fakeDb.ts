/**
 * Agent H — an in-memory stand-in for the generated Prisma client, so the
 * app's REAL server modules (db.ts, coins.ts, auth.ts, trades.ts, launch.ts,
 * stats.ts …) run unmodified against it. Installed with
 *   vi.mock('@prisma/client', () => ({ PrismaClient: FakePrismaClient }))
 * It implements only the call shapes the app uses (findUnique / findFirst /
 * findMany / create / update / upsert / count / aggregate / groupBy /
 * $transaction) with top-level `where` equality, `in`, `gt`, `gte`, `lt`,
 * `lte`, compound uniques (`a_b_c: {…}`), `orderBy`, `take`, `distinct`,
 * nested `channels: { create: [...] }` and the `include` shapes of coins.ts.
 * Nothing here fabricates data: every table starts empty.
 */

export class DbDown extends Error {
  override readonly name = 'PrismaClientInitializationError';
  constructor(msg = "Can't reach database server at `localhost:5432` (test)") {
    super(msg);
  }
}

type Row = Record<string, unknown>;

let idCounter = 0;
const cuid = (): string => `c${(++idCounter).toString(36).padStart(8, '0')}`;

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && typeof cond !== 'bigint') {
    const c = cond as Record<string, unknown>;
    if ('in' in c) return (c['in'] as unknown[]).some((v) => eq(actual, v));
    if ('gt' in c) return cmp(actual, c['gt']) > 0;
    if ('gte' in c) return cmp(actual, c['gte']) >= 0;
    if ('lt' in c) return cmp(actual, c['lt']) < 0;
    if ('lte' in c) return cmp(actual, c['lte']) <= 0;
    if ('not' in c) return !eq(actual, c['not']);
    // compound unique: { a: x, b: y }
    return Object.entries(c).every(([k, v]) => eq((actual as Row | undefined)?.[k], v));
  }
  return eq(actual, cond);
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | bigint);
  const y = b instanceof Date ? b.getTime() : (b as number | bigint);
  return x < y ? -1 : x > y ? 1 : 0;
}

function matches(row: Row, where: Row | undefined, relations: Record<string, (row: Row) => Row | Row[] | undefined>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k in relations) {
      const rel = relations[k]!(row);
      if (Array.isArray(rel)) return rel.some((r) => matches(r, cond as Row, {}));
      return rel ? matches(rel, cond as Row, {}) : false;
    }
    if (!(k in row) && cond && typeof cond === 'object' && !Array.isArray(cond)) {
      // compound unique name like signature_mint_buyer
      const parts = k.split('_');
      if (parts.every((p) => p in row)) return parts.every((p) => eq(row[p], (cond as Row)[p]));
    }
    return matchValue(row[k], cond);
  });
}

function orderRows(rows: Row[], orderBy: Row | Row[] | undefined): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const c = cmp(a[k], b[k]);
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

export class FakeTable {
  rows: Row[] = [];
  constructor(
    readonly name: string,
    private readonly db: FakePrismaClient,
    private readonly idField: string,
    private readonly defaults: () => Row = () => ({}),
    private readonly nested: Record<string, { table: string; fk: string }> = {},
  ) {}

  private relations(): Record<string, (row: Row) => Row | Row[] | undefined> {
    if (this.name === 'identity') return { coin: (r) => this.db.coin.rows.find((c) => c['ca'] === r['coinCa']) };
    if (this.name === 'allocationEntry') return { table: (r) => this.db.allocationTable.rows.find((t) => t['id'] === r['tableId']) };
    return {};
  }

  private withInclude(row: Row, args: Row | undefined): Row {
    const out: Row = { ...row };
    const include = (args?.['include'] ?? undefined) as Row | undefined;
    if (!include) return out;
    if (this.name === 'coin') {
      if (include['channels']) out['channels'] = orderRows(this.db.channel.rows.filter((c) => c['coinCa'] === row['ca']), { position: 'asc' });
      if (include['measurements']) out['measurements'] = orderRows(this.db.measurement.rows.filter((m) => m['coinCa'] === row['ca']), { index: 'asc' });
      if (include['_count']) out['_count'] = { measurements: this.db.measurement.rows.filter((m) => m['coinCa'] === row['ca']).length };
      if (include['allocation']) out['allocation'] = null;
    }
    if (this.name === 'allocationEntry' && include['table']) {
      const t = this.db.allocationTable.rows.find((x) => x['id'] === row['tableId']) ?? null;
      out['table'] = t ? { ...t, airdrops: this.db.airdropEntry.rows.filter((a) => a['tableId'] === t['id'] && (!include['table'] || a['wallet'] === row['wallet'])) } : null;
    }
    return out;
  }

  async findUnique(args: Row): Promise<Row | null> {
    this.db.touch();
    const r = this.rows.find((row) => matches(row, args['where'] as Row, this.relations()));
    return r ? this.withInclude(r, args) : null;
  }
  async findUniqueOrThrow(args: Row): Promise<Row> {
    const r = await this.findUnique(args);
    if (!r) throw new Error(`${this.name}: not found`);
    return r;
  }
  async findFirst(args: Row = {}): Promise<Row | null> {
    const rows = await this.findMany(args);
    return rows[0] ?? null;
  }
  async findMany(args: Row = {}): Promise<Row[]> {
    this.db.touch();
    let rows = this.rows.filter((row) => matches(row, args['where'] as Row | undefined, this.relations()));
    rows = orderRows(rows, args['orderBy'] as Row | Row[] | undefined);
    if (args['distinct']) {
      const fields = args['distinct'] as string[];
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        const key = JSON.stringify(fields.map((f) => r[f]));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (typeof args['take'] === 'number') rows = rows.slice(0, args['take']);
    return rows.map((r) => this.withInclude(r, args));
  }
  async create(args: Row): Promise<Row> {
    this.db.touch();
    const data = { ...(args['data'] as Row) };
    const row: Row = { ...this.defaults(), ...data };
    if (!(this.idField in row) || row[this.idField] === undefined) row[this.idField] = cuid();
    for (const [field, spec] of Object.entries(this.nested)) {
      const n = data[field] as { create?: Row[] } | undefined;
      if (n && Array.isArray(n.create)) {
        delete row[field];
        for (const child of n.create) await (this.db as unknown as Record<string, FakeTable>)[spec.table]!.create({ data: { ...child, [spec.fk]: row[this.idField] } });
      }
    }
    const dup = this.rows.find((r) => eq(r[this.idField], row[this.idField]));
    if (dup) {
      const e = new Error(`Unique constraint failed on the fields: (\`${this.idField}\`)`) as Error & { code: string };
      e.code = 'P2002';
      throw e;
    }
    this.rows.push(row);
    return row;
  }
  async update(args: Row): Promise<Row> {
    this.db.touch();
    const r = this.rows.find((row) => matches(row, args['where'] as Row, this.relations()));
    if (!r) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
    Object.assign(r, args['data'] as Row);
    return r;
  }
  async updateMany(args: Row): Promise<{ count: number }> {
    this.db.touch();
    const rs = this.rows.filter((row) => matches(row, args['where'] as Row, this.relations()));
    for (const r of rs) Object.assign(r, args['data'] as Row);
    return { count: rs.length };
  }
  async upsert(args: Row): Promise<Row> {
    const r = this.rows.find((row) => matches(row, args['where'] as Row, this.relations()));
    if (r) {
      Object.assign(r, args['update'] as Row);
      return r;
    }
    return this.create({ data: args['create'] });
  }
  async count(args: Row = {}): Promise<number> {
    return (await this.findMany(args)).length;
  }
  async aggregate(args: Row = {}): Promise<Row> {
    const rows = await this.findMany({ where: args['where'] });
    const out: Row = {};
    const agg = (spec: Row | undefined, f: (vals: unknown[]) => unknown): Row | undefined => {
      if (!spec) return undefined;
      const o: Row = {};
      for (const k of Object.keys(spec)) {
        const vals = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
        o[k] = vals.length === 0 ? null : f(vals);
      }
      return o;
    };
    const sum = agg(args['_sum'] as Row | undefined, (vals) => (typeof vals[0] === 'bigint' ? (vals as bigint[]).reduce((a, b) => a + b, 0n) : (vals as number[]).reduce((a, b) => a + b, 0)));
    if (sum) out['_sum'] = sum;
    const min = agg(args['_min'] as Row | undefined, (vals) => vals.reduce((a, b) => (cmp(a, b) <= 0 ? a : b)));
    if (min) out['_min'] = min;
    const max = agg(args['_max'] as Row | undefined, (vals) => vals.reduce((a, b) => (cmp(a, b) >= 0 ? a : b)));
    if (max) out['_max'] = max;
    if (args['_count']) out['_count'] = { _all: rows.length };
    return out;
  }
  async groupBy(args: Row): Promise<Row[]> {
    const rows = await this.findMany({ where: args['where'] });
    const by = args['by'] as string[];
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = JSON.stringify(by.map((b) => r[b]));
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const out: Row[] = [];
    for (const g of groups.values()) {
      const row: Row = {};
      for (const b of by) row[b] = g[0]![b];
      const t = new FakeTable(this.name, this.db, this.idField);
      t.rows = g;
      Object.assign(row, await t.aggregate({ _sum: args['_sum'], _min: args['_min'], _max: args['_max'] }));
      out.push(row);
    }
    return out;
  }
}

export class FakePrismaClient {
  /** When set, every table call throws it (simulates an unreachable database). */
  down: Error | null = null;
  /** Number of table calls (to prove ordering, e.g. "payment verified before any write"). */
  calls = 0;
  writes: string[] = [];

  readonly coin = new FakeTable('coin', this, 'ca', () => ({ createdAt: new Date(), updatedAt: new Date(), motherCa: null, daughterCa: null, collapsedAt: null, launchBundle: null, createdBy: null }), { channels: { table: 'channel', fk: 'coinCa' } });
  readonly channel = new FakeTable('channel', this, 'id');
  readonly measurement = new FakeTable('measurement', this, 'id', () => ({ createdAt: new Date(), precommitTx: null, proofTx: null }));
  readonly lineage = new FakeTable('lineage', this, 'id', () => ({ createdAt: new Date() }));
  readonly allocationTable = new FakeTable('allocationTable', this, 'id', () => ({ createdAt: new Date(), rootAnchorTx: null }), { entries: { table: 'allocationEntry', fk: 'tableId' } });
  readonly allocationEntry = new FakeTable('allocationEntry', this, 'id');
  readonly airdropEntry = new FakeTable('airdropEntry', this, 'id', () => ({ updatedAt: new Date(), txSignature: null }));
  readonly burn = new FakeTable('burn', this, 'id', () => ({ createdAt: new Date(), swapTx: null }));
  readonly trade = new FakeTable('trade', this, 'id', () => ({ createdAt: new Date(), tokenUnits: null, source: null }));
  readonly balanceChange = new FakeTable('balanceChange', this, 'id', () => ({ createdAt: new Date(), deltaUnits: null }));
  readonly identity = new FakeTable('identity', this, 'coinCa', () => ({ updatedAt: new Date() }));
  readonly eventLog = new FakeTable('eventLog', this, 'id', () => ({ createdAt: new Date(), coinCa: null, refId: null, tx: null, data: null }));
  readonly authChallenge = new FakeTable('authChallenge', this, 'nonce', () => ({ createdAt: new Date(), usedAt: null }));
  readonly coinImage = new FakeTable('coinImage', this, 'coinCa');

  constructor(_opts?: unknown) {}

  touch(): void {
    this.calls++;
    if (this.down) throw this.down;
  }

  async $transaction<T>(arg: ((tx: this) => Promise<T>) | Promise<unknown>[]): Promise<T | unknown[]> {
    if (typeof arg === 'function') return arg(this);
    return Promise.all(arg);
  }
  async $disconnect(): Promise<void> {}

  reset(): void {
    for (const t of Object.values(this)) if (t instanceof FakeTable) t.rows = [];
    this.down = null;
    this.calls = 0;
    this.writes = [];
  }
}

/** The single fake instance the mocked PrismaClient constructor hands out (the app caches one client on globalThis). */
export const fakeDb = new FakePrismaClient();
export class SharedFakePrismaClient {
  constructor(_opts?: unknown) {
    return fakeDb as unknown as SharedFakePrismaClient;
  }
}
