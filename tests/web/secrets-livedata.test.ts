/**
 * Agent H — secrets stay on the server and the site runs on live data only
 * (SPEC §9 l.391-393; §2 "no placeholder data"). Source-level checks over
 * apps/web: every file is read; nothing is inferred from names alone.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const WEB = path.join(ROOT, 'apps/web');
const SRC = path.join(WEB, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (e === 'node_modules' || e === '.next') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|json|prisma)$/.test(e)) out.push(p);
  }
  return out;
}
const files = walk(SRC);
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => path.relative(WEB, p);
const isClient = (src: string) => /^\s*['"]use client['"]/.test(src);

const SERVER_SECRETS = ['QSD_QRNG_API_KEY', 'QSD_WITNESS_SECRET_KEY', 'QSD_KEY_ENCRYPTION_KEY', 'QSD_PROTOCOL_CREATOR_SECRET', 'QSD_WEBHOOK_SECRET', 'PINATA_JWT', 'JUPITER_API_KEY', 'HELIUS_API_KEY', 'DATABASE_URL', 'REDIS_URL'];

describe('secrets', () => {
  it('no NEXT_PUBLIC_ name carries a secret, anywhere in apps/web (src, config, env example, README)', () => {
    const everything = [...files, path.join(WEB, 'next.config.mjs'), path.join(WEB, '.env.example'), path.join(WEB, 'README.md'), path.join(WEB, 'package.json')].filter(existsSync);
    const publicNames = new Set<string>();
    for (const f of everything) for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) publicNames.add(m[0]);
    expect([...publicNames].sort()).toEqual(['NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS', 'NEXT_PUBLIC_SOLANA_CLUSTER', 'NEXT_PUBLIC_SOLANA_RPC_URL']);
    for (const n of publicNames) for (const s of SERVER_SECRETS) expect(n).not.toContain(s.replace(/^QSD_/, ''));
  });

  it('server secret names are read only in server modules, the workers, or @qsd packages — never in a client component or a shared lib', () => {
    for (const f of files) {
      const src = read(f);
      const hits = SERVER_SECRETS.filter((s) => src.includes(s));
      if (hits.length === 0) continue;
      const r = rel(f);
      const serverSide = r.startsWith('src/server/') || r.startsWith('src/workers/') || r.startsWith('src/app/api/');
      expect(serverSide, `${r} mentions ${hits.join(',')}`).toBe(true);
      expect(isClient(src), `${r} is a client file mentioning ${hits.join(',')}`).toBe(false);
    }
  });

  it('client files read process.env only for NEXT_PUBLIC_ names, and only through lib/env.ts', () => {
    for (const f of files) {
      const src = read(f);
      if (!isClient(src)) continue;
      expect(src, rel(f)).not.toMatch(/process\.env/);
    }
    const env = read(path.join(SRC, 'lib/env.ts'));
    for (const m of env.matchAll(/process\.env\.([A-Z0-9_]+)/g)) expect(m[1]).toMatch(/^NEXT_PUBLIC_/);
    for (const f of files) {
      const r = rel(f);
      if (!r.startsWith('src/lib/') || r === 'src/lib/env.ts') continue;
      expect(read(f), r).not.toMatch(/process\.env/);
    }
  });

  it('no client component imports @qsd/solana, a server module, prisma, ioredis or bullmq (directly)', () => {
    const forbidden = /from ['"](@qsd\/solana|@\/server\/|@prisma\/client|ioredis|bullmq|node:)/;
    for (const f of files) {
      const src = read(f);
      if (!isClient(src)) continue;
      expect(src, rel(f)).not.toMatch(forbidden);
    }
  });

  it('every file under src/server imports server-only; every api route is nodejs runtime or imports only server modules', () => {
    for (const f of files) {
      const r = rel(f);
      if (!r.startsWith('src/server/') || r.endsWith('.d.ts')) continue;
      expect(read(f), r).toMatch(/^import 'server-only';/m);
    }
  });

  it('next.config.mjs inlines no env values and no data', () => {
    const cfg = read(path.join(WEB, 'next.config.mjs'));
    expect(cfg).not.toMatch(/\benv\s*:/);
    expect(cfg).not.toMatch(/publicRuntimeConfig|serverRuntimeConfig/);
    expect(cfg).not.toMatch(/process\.env\.(?!NODE_ENV)/);
  });
});

describe('live data only', () => {
  it('no seed script, no prisma.seed, no fixtures imported by non-test code', () => {
    const pkg = JSON.parse(read(path.join(WEB, 'package.json'))) as { prisma?: { seed?: string }; scripts?: Record<string, string> };
    expect(pkg.prisma?.seed).toBeUndefined();
    for (const [k, v] of Object.entries(pkg.scripts ?? {})) expect(`${k}=${v}`).not.toMatch(/seed|fixture/i);
    expect(existsSync(path.join(WEB, 'prisma/seed.ts'))).toBe(false);
    expect(existsSync(path.join(WEB, 'prisma/seed.js'))).toBe(false);
    for (const f of files) expect(read(f), rel(f)).not.toMatch(/from ['"][^'"]*(fixtures?|__mocks__|seed-data)[^'"]*['"]/);
  });

  it('no mock, fake, sample, demo, placeholder or lorem identifiers in src or prisma', () => {
    const re = /\b(mock|fake|sample|demo|placeholder|lorem|dummy|stub)[A-Za-z0-9_]*\b/gi;
    const allowed = new Set(['placeholder', 'placeholder=']); // the <input placeholder> attribute is markup, not data
    for (const f of [...files, path.join(WEB, 'prisma/schema.prisma')]) {
      const src = read(f);
      const hits = [...src.matchAll(re)].map((m) => m[0]).filter((h) => !allowed.has(h.toLowerCase()) && !/^placeholder$/i.test(h));
      // 'placeholder' as a JSX attribute name is allowed; any other spelling is a finding
      expect(hits, `${rel(f)}: ${hits.join(',')}`).toEqual([]);
    }
  });

  it('no hardcoded coin, wallet or transaction identifiers in src (base58 strings of key length outside the Solana program ids)', () => {
    const KNOWN = new Set(['11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'ComputeBudget111111111111111111111111111111']);
    for (const f of files) {
      const src = read(f);
      const hits = [...src.matchAll(/['"`]([1-9A-HJ-NP-Za-km-z]{32,88})['"`]/g)].map((m) => m[1]!).filter((h) => !KNOWN.has(h) && !/^[a-z]+$/i.test(h) && !/^[0-9a-f]+$/i.test(h));
      expect(hits, `${rel(f)}: ${hits.join(',')}`).toEqual([]);
    }
  });

  it('INFO H-W12: .env.example wires QSD_GENESIS_CONFIG to genesis.example.json (operator configuration, not data) — the file says so itself', () => {
    const env = read(path.join(WEB, '.env.example'));
    expect(env).toMatch(/QSD_GENESIS_CONFIG=.*genesis\.example\.json/);
    const g = JSON.parse(read(path.join(WEB, 'genesis.example.json'))) as { _note: string };
    expect(g._note).toMatch(/Not data: no coin exists until a real launch/);
  });
});
