import { describe, expect, it } from 'vitest';
import { createIdentity, KeyReuseError, Signer, verify } from '@qsd/crypto';
import { randomBytes } from '@noble/hashes/utils.js';
import { Keypair } from '@solana/web3.js';
import {
  ENV,
  IdentityReserve,
  KeyVault,
  KvJournalStore,
  KvKeyStore,
  KvReserveBackend,
  LeasedJournal,
  MemoryKvStore,
  PersistentStateStore,
  createChain,
  kvChainStorage,
  loadChainConfig,
} from '../src/index.js';

const seed = new Uint8Array(32).fill(9);
const identity = createIdentity(seed); // ≈ 3 s, shared by every test in this file
const msg = new TextEncoder().encode('qsd launch');

describe('kvChainStorage (database-backed keys, reserve and journals)', () => {
  it('keys round-trip encrypted through the table; only ciphertext is stored', async () => {
    const kv = new MemoryKvStore();
    const kek = randomBytes(32);
    const kp = Keypair.generate();
    await new KeyVault(kek, new KvKeyStore(kv)).storeKeypair('qsd/mint/abc', kp);
    const row = (await kv.get('key/qsd/mint/abc'))!;
    expect(row.value).not.toContain(Buffer.from(kp.secretKey).toString('hex'));
    // another "process" over the same table decrypts the same key
    const again = await new KeyVault(kek, new KvKeyStore(kv)).loadKeypair('qsd/mint/abc');
    expect(again.publicKey.equals(kp.publicKey)).toBe(true);
    expect(await new KvKeyStore(kv).list()).toEqual(['qsd/mint/abc']);
  });

  it('identity state CAS: a used one-time key stays used across restarts, and concurrent signers never share an index', async () => {
    const kv = new MemoryKvStore();
    const r = await new Signer(identity, new PersistentStateStore(new KvReserveBackend(kv))).sign(msg);
    const reopened = new Signer(identity, new PersistentStateStore(new KvReserveBackend(kv)));
    await expect(reopened.signWithIndex(r.index, msg)).rejects.toThrow(KeyReuseError);
    const a = new Signer(identity, new PersistentStateStore(new KvReserveBackend(kv)));
    const b = new Signer(identity, new PersistentStateStore(new KvReserveBackend(kv)));
    const [x, y] = await Promise.all([a.sign(msg), b.sign(msg)]);
    expect(x.index).not.toBe(y.index);
  });

  it('a stale version is refused by the backend', async () => {
    const backend = new KvReserveBackend(new MemoryKvStore());
    const state = identity.initialState();
    expect(await backend.writeState(identity.rootHex, { version: 1, state }, 0)).toBe(true);
    expect(await backend.writeState(identity.rootHex, { version: 1, state }, 0)).toBe(false);
    expect(await backend.writeState(identity.rootHex, { version: 3, state }, 1)).toBe(false); // version must be expected + 1
  });

  it('IdentityReserve over the table: concurrent registry writes keep every coin; the identity rebuilds after a restart', async () => {
    const kv = new MemoryKvStore();
    const vault = new KeyVault(randomBytes(32), new KvKeyStore(kv));
    const reserve = new IdentityReserve(vault, new KvReserveBackend(kv));
    const ca = 'DaughterCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
    await reserve.createForCoin(ca, { seed });
    // a second writer that read the registry before `ca` existed must not erase it
    await new KvReserveBackend(kv).writeRegistry({ OtherCA: { ca: 'OtherCA', identityRoot: 'r', pubSeed: 'p', seedLabel: 'l', createdAt: 't' } });
    expect(Object.keys(await new KvReserveBackend(kv).readRegistry()).sort()).toEqual([ca, 'OtherCA'].sort());
    const restarted = new IdentityReserve(vault, new KvReserveBackend(kv));
    const signer = await restarted.signerFor(ca);
    const r = await signer.sign(msg);
    expect(verify(identity.publicKey, msg, r.signature)).toBe(true);
  });

  it('journals round-trip bigints and support leases', async () => {
    const kv = new MemoryKvStore();
    const store = new KvJournalStore<{ n: bigint; version?: number }>(kv, 'collapse-x');
    await store.save({ n: 123n });
    expect((await new KvJournalStore<{ n: bigint }>(kv, 'collapse-x').load())!.n).toBe(123n);
    const leased = new LeasedJournal(store, { owner: 'w1' });
    const doc = await leased.acquire(() => ({ n: 0n }));
    doc.n = 5n;
    await leased.save(doc);
    await leased.release(doc);
    const after = (await store.load())!;
    expect(after.n).toBe(5n);
    expect((after as { lease?: unknown }).lease).toBeUndefined();
  });

  it('createChain accepts table storage on mainnet in place of QSD_KEYSTORE_PATH', () => {
    const cfg = loadChainConfig({ [ENV.KEY_ENCRYPTION_KEY]: 'ab'.repeat(32), [ENV.MAINNET_ENABLED]: 'true' });
    expect(() => createChain(cfg)).toThrow(/QSD_KEYSTORE_PATH/);
    const chain = createChain(cfg, kvChainStorage(new MemoryKvStore()));
    expect(chain.journal('burn')).toBeInstanceOf(KvJournalStore);
    expect(chain.airdropJournal('abc')).toBeInstanceOf(KvJournalStore);
  });
});
