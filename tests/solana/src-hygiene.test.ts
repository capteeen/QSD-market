/**
 * Agent H — source scans of @qsd/protocol and @qsd/solana: no logging, no
 * local randomness where the spec says computed, no placeholders, no clock in
 * the protocol; the airdrop batch size is computed from a real transaction.
 * Spec §1 l.66-68, §2 l.96-97, §9 l.393.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Keypair, PACKET_DATA_SIZE } from '@solana/web3.js';
import { buildTransferInstructions, computeMaxTransfersPerTx, transactionSize } from '@qsd/solana';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', 'packages');
const files = (pkg: string) =>
  readdirSync(path.join(root, pkg, 'src'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(path.join(root, pkg, 'src', f), 'utf8')] as const);

describe('source hygiene', () => {
  it('no console.* in protocol or solana src', () => {
    for (const pkg of ['protocol', 'solana']) for (const [f, src] of files(pkg)) expect(src, `${pkg}/${f}`).not.toMatch(/\bconsole\.(log|error|warn|info|debug|trace)\(/);
  });

  it('the protocol is pure: no clock, no randomness, no I/O, no process access', () => {
    for (const [f, src] of files('protocol')) {
      expect(src, f).not.toMatch(/\bDate\b|Math\.random|getRandomValues|randomBytes|\bfetch\(|process\.env|require\(|node:fs/);
    }
  });

  it('local randomness in solana src is only where it belongs (nonces, seeds, nonce for the cipher, a tmp-file name, lock jitter) — never an outcome', () => {
    const allowed: Record<string, RegExp[]> = {
      'keys.ts': [/randomBytes\(NONCE_BYTES\)/, /Math\.random\(\)\.toString\(36\)/, /const kp = Keypair\.generate\(\);\s*await this\.storeKeypair/], // vault.generateKeypair
      'measure.ts': [/\(deps\.random \?\? randomBytes\)\(PRECOMMIT_NONCE_BYTES\)/],
      'reserve.ts': [/randomBytes\(SEED_BYTES\)/, /Math\.random\(\) \* 8/],
      'airdrop.ts': [/Keypair\.generate\(\)/], // sizing probe recipients only
      'collapse.ts': [/Keypair\.generate\(\)/], // the daughter mint keypair
      'launch.ts': [/Keypair\.generate\(\)/], // fallback mint keypair
    };
    for (const [f, src] of files('solana')) {
      const uses = src.match(/Math\.random\([^)]*\)[^;\n]*|randomBytes\([^)]*\)|getRandomValues\([^)]*\)|Keypair\.generate\(\)/g) ?? [];
      for (const u of uses) {
        const ok = (allowed[f] ?? []).some((re) => re.test(u) || re.test(src.slice(src.indexOf(u) - 60, src.indexOf(u) + 80)));
        expect(ok, `${f}: ${u}`).toBe(true);
      }
    }
  });

  it('no placeholder / stub / mock / TODO markers in src', () => {
    for (const pkg of ['protocol', 'solana']) for (const [f, src] of files(pkg)) expect(src, `${pkg}/${f}`).not.toMatch(/\b(TODO|FIXME|XXX|HACK|placeholder|lorem|dummy)\b/i);
  });

  it('every number in PROTOCOL_PARAMS is referenced by name somewhere in protocol src (no shadow literals of the same value doing the work)', () => {
    const params = readFileSync(path.join(root, 'protocol', 'src', 'params.ts'), 'utf8');
    const names = [...params.matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]!);
    const all = files('protocol')
      .map(([, s]) => s)
      .join('\n');
    for (const n of names) expect(all.split(n).length - 1, n).toBeGreaterThanOrEqual(2); // definition + at least one use
    // the two "magic" protocol fractions are never written as bare decimals in the rules
    const rules = files('protocol').filter(([f]) => !['params.ts', 'types.ts', 'errors.ts', 'index.ts'].includes(f));
    for (const [f, src] of rules) {
      const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/\b0\.75\b|\b0\.5\b|\b0\.025\b|\b7500\b|\b25000\b|\b25_000\b/);
    }
  });

  it('the airdrop batch size is computed by serialising a real v0 transaction against the 1232-byte packet limit, not guessed', () => {
    const payer = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const n = computeMaxTransfersPerTx(payer, mint);
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(14);
    const recipients = (k: number) => Array.from({ length: k }, () => ({ wallet: Keypair.generate().publicKey.toBase58(), units: 1n }));
    expect(transactionSize(payer, buildTransferInstructions(payer, mint, recipients(n)))).toBeLessThanOrEqual(PACKET_DATA_SIZE);
    expect(transactionSize(payer, buildTransferInstructions(payer, mint, recipients(n + 1)))).toBeGreaterThan(PACKET_DATA_SIZE);
    expect(() => buildTransferInstructions(payer, mint, [{ wallet: payer.toBase58(), units: 0n }])).toThrow(/positive/);
  });
});
