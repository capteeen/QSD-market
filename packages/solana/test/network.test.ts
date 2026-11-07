/**
 * Live devnet checks. They run only when SOLANA_RPC_URL (devnet) is set and
 * reachable; otherwise they are skipped with a printed reason — never faked.
 */
import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { Web3ChainReader, Web3TransactionSender, createConnection, ProgramAccountsSource } from '../src/index.js';

const rpc = process.env['SOLANA_RPC_URL'];
let reachable = false;
let reason = 'SOLANA_RPC_URL is not set';
if (rpc) {
  try {
    const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }), signal: AbortSignal.timeout(8000) });
    reachable = res.ok;
    if (!res.ok) reason = `RPC returned HTTP ${res.status}`;
  } catch (e) {
    reason = `RPC unreachable: ${(e as Error).message}`;
  }
}
if (!reachable) console.log(`[network.test] skipping live RPC tests: ${reason}`);

describe.skipIf(!reachable)('live devnet RPC', () => {
  it('reads the slot and the token program accounts of a mint (gPA path), and reports expiry for an unknown signature', async () => {
    const connection = createConnection(rpc as string);
    const reader = new Web3ChainReader(connection);
    const slot = await reader.getSlot();
    expect(slot).toBeGreaterThan(0);
    const sender = new Web3TransactionSender(connection, Keypair.generate(), 'devnet');
    const fake = '1'.repeat(87);
    expect(await sender.status(fake, 0)).toBe('expired');
    const src = new ProgramAccountsSource(connection);
    const page = await src.listByMint(Keypair.generate().publicKey.toBase58());
    expect(page.rows).toEqual([]);
    expect(page.observedSlot).toBeGreaterThan(0);
  });
});
