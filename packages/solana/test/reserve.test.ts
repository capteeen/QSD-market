import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createIdentity, KeyReuseError, Signer, StateConflictError, signWithIndex, verify, isIndexUsed } from '@qsd/crypto';
import { randomBytes } from '@noble/hashes/utils.js';
import { FileReserveBackend, IdentityReserve, KeyVault, MemoryKeyStore, MemoryReserveBackend, PersistentStateStore } from '../src/index.js';

const seed = new Uint8Array(32).fill(7);
const identity = createIdentity(seed); // ≈ 3 s, shared by every test in this file
const msg = new TextEncoder().encode('qsd launch');

describe('PersistentStateStore (identity reserve)', () => {
  it('compare-and-swap: expected=null, stale expected and concurrent version bumps all conflict', async () => {
    const store = new PersistentStateStore(new MemoryReserveBackend());
    const root = identity.rootHex;
    const s0 = identity.initialState();
    await store.put(root, s0, null);
    await expect(store.put(root, s0, null)).rejects.toThrow(StateConflictError);
    const s1 = signWithIndex(identity, s0, 0, msg).state;
    await store.put(root, s1, s0);
    await expect(store.put(root, s1, s0)).rejects.toThrow(StateConflictError); // stale expectation
    const got = (await store.get(root))!;
    expect(isIndexUsed(got, 0)).toBe(true);
    // a store never clears a used bit even when handed an older state
    await store.put(root, s0);
    expect(isIndexUsed((await store.get(root))!, 0)).toBe(true);
  });

  it('reuse is refused across a process restart (memory backend reopened)', async () => {
    const backend = new MemoryReserveBackend();
    const signer = new Signer(identity, new PersistentStateStore(backend));
    const r = await signer.sign(msg);
    expect(verify(identity.publicKey, msg, r.signature)).toBe(true);
    // "restart": a new backend over the same persisted bytes, a new signer
    const again = new Signer(identity, new PersistentStateStore(backend.reopen()));
    await expect(again.signWithIndex(r.index, msg)).rejects.toThrow(KeyReuseError);
    const r2 = await again.sign(msg);
    expect(r2.index).toBe(r.index + 1);
  });

  it('reuse is refused across a restart with the file backend', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'qsd-reserve-'));
    const file = path.join(dir, 'reserve.json');
    const r = await new Signer(identity, new PersistentStateStore(new FileReserveBackend(file))).sign(msg);
    const reopened = new Signer(identity, new PersistentStateStore(new FileReserveBackend(file)));
    await expect(reopened.signWithIndex(r.index, msg)).rejects.toThrow(KeyReuseError);
    // concurrent signers on one file never collide
    const a = new Signer(identity, new PersistentStateStore(new FileReserveBackend(file)));
    const b = new Signer(identity, new PersistentStateStore(new FileReserveBackend(file)));
    const [x, y] = await Promise.all([a.sign(msg), b.sign(msg)]);
    expect(x.index).not.toBe(y.index);
  });

  it('IdentityReserve stores the seed encrypted and rebuilds the same identity', async () => {
    const vault = new KeyVault(randomBytes(32), new MemoryKeyStore());
    const backend = new MemoryReserveBackend();
    const reserve = new IdentityReserve(vault, backend);
    const ca = 'DaughterCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
    const { entry } = await reserve.createForCoin(ca, { seed });
    expect(entry.identityRoot).toBe(identity.rootHex);
    await expect(reserve.createForCoin(ca, { seed })).rejects.toThrow(/already holds/);
    const stored = JSON.stringify(await vault.store.get(entry.seedLabel));
    expect(stored).not.toContain(Buffer.from(seed).toString('hex'));
    const restarted = new IdentityReserve(vault, backend.reopen());
    const signer = await restarted.signerFor(ca); // rebuilds from the encrypted seed (≈ 3 s)
    const r = await signer.sign(msg);
    expect(verify(identity.publicKey, msg, r.signature)).toBe(true);
    await expect(signer.signWithIndex(r.index, msg)).rejects.toThrow(KeyReuseError);
    expect((await restarted.list()).map((e) => e.ca)).toEqual([ca]);
  });
});
