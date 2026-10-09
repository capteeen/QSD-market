import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { ComputeBudgetProgram, Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { ANCHOR_ATTEMPTS, ChainUnavailableError, Web3TransactionSender, anchorCommitment, decodeAnchorMemo, loadChainConfig } from '../src/index.js';
import { FakeChain } from './helpers/fakeChain.js';

const h = 'ab'.repeat(32);

describe('anchor retry', () => {
  it('re-sends a dropped anchor with a fresh blockhash and lands it once', async () => {
    const chain = new FakeChain(Keypair.generate());
    chain.sendBehaviours = ['expire'];
    const r = await anchorCommitment(h, 'proof', { sender: chain });
    expect(chain.sendCalls).toBe(2);
    expect(r.status).toBe('confirmed');
    expect(chain.memos.map((m) => decodeAnchorMemo(m.memo))).toEqual([{ kind: 'proof', hash: h }]);
    expect(chain.memos[0]!.signature).toBe(r.txSignature);
  });

  it(`gives up after ${ANCHOR_ATTEMPTS} expired attempts`, async () => {
    const chain = new FakeChain(Keypair.generate());
    chain.sendBehaviours = Array(ANCHOR_ATTEMPTS).fill('expire');
    const err = await anchorCommitment(h, 'proof', { sender: chain }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChainUnavailableError);
    expect(String(err)).toContain(`after ${ANCHOR_ATTEMPTS} attempts`);
    expect(chain.sendCalls).toBe(ANCHOR_ATTEMPTS);
    expect(chain.memos).toHaveLength(0);
  });

  it('does not retry a transaction that failed on-chain', async () => {
    const chain = new FakeChain(Keypair.generate());
    chain.sendBehaviours = ['fail'];
    await expect(anchorCommitment(h, 'proof', { sender: chain })).rejects.toThrow(/failed$/);
    expect(chain.sendCalls).toBe(1);
  });
});

/** A Connection stand-in recording what the sender broadcasts. */
function fakeConnection(statuses: (null | { confirmationStatus: 'confirmed' })[]) {
  const sent: Uint8Array[] = [];
  const conn = {
    getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 500 }),
    sendRawTransaction: async (bytes: Uint8Array) => {
      sent.push(bytes);
      return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]!);
    },
    getSignatureStatuses: async () => ({ value: [statuses.shift() ?? null] }),
    getBlockHeight: async () => 100,
  };
  return { conn: conn as unknown as Connection, sent };
}

describe('Web3TransactionSender priority fee and re-broadcast', () => {
  it('adds the default compute-unit price to every transaction', async () => {
    const { conn, sent } = fakeConnection([{ confirmationStatus: 'confirmed' }]);
    const sender = new Web3TransactionSender(conn, Keypair.generate(), 'mainnet-beta', { defaultComputeUnitPriceMicroLamports: 100_000, pollMs: 1 });
    await sender.send([]);
    const tx = VersionedTransaction.deserialize(sent[0]!);
    const programs = tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex]!.toBase58());
    expect(programs).toContain(ComputeBudgetProgram.programId.toBase58());
  });

  it('adds no compute-budget instruction without a price', async () => {
    const { conn, sent } = fakeConnection([]);
    const sender = new Web3TransactionSender(conn, Keypair.generate(), 'devnet', { pollMs: 1 });
    await sender.send([]);
    const tx = VersionedTransaction.deserialize(sent[0]!);
    expect(tx.message.compiledInstructions).toHaveLength(0);
  });

  it('re-broadcasts the same signed bytes while the transaction is pending', async () => {
    const { conn, sent } = fakeConnection([null, null, { confirmationStatus: 'confirmed' }]);
    const sender = new Web3TransactionSender(conn, Keypair.generate(), 'mainnet-beta', { pollMs: 1 });
    const s = await sender.send([]);
    expect(await sender.confirm(s.signature, s.lastValidBlockHeight)).toBe('confirmed');
    expect(sent.length).toBe(3);
    expect(new Set(sent.map((b) => Buffer.from(b).toString('hex'))).size).toBe(1);
  });
});

describe('priority fee config', () => {
  const base = { QSD_KEY_ENCRYPTION_KEY: '00'.repeat(32) };
  it('defaults to 100000 micro-lamports on mainnet and 0 on devnet', () => {
    expect(loadChainConfig({ ...base, SOLANA_CLUSTER: 'mainnet-beta', QSD_MAINNET_ENABLED: 'true' }).priorityFeeMicroLamports).toBe(100_000);
    expect(loadChainConfig({ ...base, SOLANA_CLUSTER: 'devnet' }).priorityFeeMicroLamports).toBe(0);
  });
  it('reads QSD_PRIORITY_FEE_MICROLAMPORTS and rejects junk', () => {
    expect(loadChainConfig({ ...base, SOLANA_CLUSTER: 'devnet', QSD_PRIORITY_FEE_MICROLAMPORTS: '250000' }).priorityFeeMicroLamports).toBe(250_000);
    expect(() => loadChainConfig({ ...base, SOLANA_CLUSTER: 'devnet', QSD_PRIORITY_FEE_MICROLAMPORTS: '-1' })).toThrow(/QSD_PRIORITY_FEE_MICROLAMPORTS/);
  });
});
