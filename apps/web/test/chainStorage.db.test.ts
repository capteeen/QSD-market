// @vitest-environment node
/**
 * PrismaKvStore against a real Postgres. Runs only when QSD_TEST_DATABASE_URL
 * points at a database whose schema is pushed (`prisma db push`); its ChainKv
 * rows are deleted before each test.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createIdentity, KeyReuseError, Signer } from '@qsd/crypto';
import { IdentityReserve, KeyVault, KvKeyStore, KvReserveBackend, PersistentStateStore } from '@qsd/solana';
import { Keypair } from '@solana/web3.js';
import { randomBytes } from 'node:crypto';

vi.mock('server-only', () => ({}));

const url = process.env.QSD_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('PrismaKvStore (Postgres)', async () => {
  const { PrismaKvStore } = await import('@/server/chainStorage');
  const { db } = await import('@/server/db');
  const kv = new PrismaKvStore();
  const identity = createIdentity(new Uint8Array(32).fill(3));
  const msg = new TextEncoder().encode('qsd');

  beforeEach(async () => {
    await db().chainKv.deleteMany({});
  });

  it('cas: create-if-absent once, then update only at the expected version', async () => {
    expect(await kv.cas('k', 'a', 0)).toBe(true);
    expect(await kv.cas('k', 'b', 0)).toBe(false);
    expect(await kv.cas('k', 'c', 2)).toBe(false);
    expect(await kv.cas('k', 'd', 1)).toBe(true);
    expect(await kv.get('k')).toEqual({ value: 'd', version: 2 });
    await kv.put('k', 'e');
    expect(await kv.get('k')).toEqual({ value: 'e', version: 3 });
    await kv.put('k2', 'x');
    expect(await kv.list('k')).toEqual(['k', 'k2']);
    await kv.delete('k');
    expect(await kv.get('k')).toBeUndefined();
  });

  it('concurrent creates: exactly one wins', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => kv.cas('race', String(i), 0)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('keys and identity state survive a "restart" and concurrent signers never reuse an index', async () => {
    const kek = new Uint8Array(randomBytes(32));
    const kp = Keypair.generate();
    await new KeyVault(kek, new KvKeyStore(kv)).storeKeypair('qsd/mint/x', kp);
    expect((await new KeyVault(kek, new KvKeyStore(new PrismaKvStore())).loadKeypair('qsd/mint/x')).publicKey.equals(kp.publicKey)).toBe(true);

    const vault = new KeyVault(kek, new KvKeyStore(kv));
    await new IdentityReserve(vault, new KvReserveBackend(kv)).createForCoin('CoinX', { seed: new Uint8Array(32).fill(3) });
    const a = new Signer(identity, new PersistentStateStore(new KvReserveBackend(new PrismaKvStore())));
    const b = new Signer(identity, new PersistentStateStore(new KvReserveBackend(new PrismaKvStore())));
    const [x, y] = await Promise.all([a.sign(msg), b.sign(msg)]);
    expect(x.index).not.toBe(y.index);
    const c = new Signer(identity, new PersistentStateStore(new KvReserveBackend(new PrismaKvStore())));
    await expect(c.signWithIndex(x.index, msg)).rejects.toThrow(KeyReuseError);
  }, 30_000);
});
