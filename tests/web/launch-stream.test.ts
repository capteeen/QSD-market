/**
 * Agent H — the launch API (SPEC §8 /launch; §9 l.391-393; README "the seed
 * never leaves the vault"). The REAL runLaunch generator runs end to end
 * against: an in-memory Elysium payment and deploy (no Solana ledger, no
 * pump.fun), a real KeyVault + MemoryKeyStore, a real IdentityReserve +
 * MemoryReserveBackend (instrumented), a fake `publicClient.getTransaction`
 * for the HYPE payment check, the in-memory Prisma stand-in, UNSAFE_DEV_RANDOM
 * under NODE_ENV=test, and no Redis. Key generation is real (≈3 s per
 * identity), so the suite is slow by nature.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hash } from 'viem';
import { CryptoObserver, createIdentity, toHex, type CryptoEvent } from '@qsd/crypto';
import { ChainObserver, IdentityReserve, KeyVault, MemoryKeyStore, MemoryReserveBackend, type AnchorKind } from '@qsd/solana';
import { decodeCryptoEvents } from '@qsd/scene/model';
import { fakeDb } from './fakeDb';

const ROOT = path.resolve(__dirname, '../..');
const g = globalThis as unknown as { __qsdPrisma?: unknown; __qsdQrng?: unknown };

// ----------------------------------------------------------------- fake chain
const KEK = new Uint8Array(32).fill(0x42);
const creator = privateKeyToAccount(('0x' + '22'.repeat(32)) as Hash);
const wallet = privateKeyToAccount(('0x' + '11'.repeat(32)) as Hash);
const other = privateKeyToAccount(('0x' + '33'.repeat(32)) as Hash);
const PREDICTED = '0x4444444444444444444444444444444444444444' as Address;
const LAUNCH_COST = 1_000_000_000n;
const RESERVE = 500_000_000n;

interface PaymentTx {
  found: boolean;
  status: 'success' | 'reverted';
  from: Address;
  to: Address;
  value: bigint;
  throws?: Error;
}

interface Sends {
  calls: number;
  memos: string[];
  contracts: Set<string>;
  txs: Map<string, 'success'>;
}

const state = {
  sends: { calls: 0, memos: [], contracts: new Set<string>(), txs: new Map() } as Sends,
  vault: new KeyVault(KEK, new MemoryKeyStore()),
  backend: new MemoryReserveBackend(),
  reserve: null as unknown as IdentityReserve,
  observer: new ChainObserver(),
  payment: null as unknown as PaymentTx,
  getTransactionCalls: [] as string[],
  vaultWrites: [] as { label: string; sendCalls: number }[],
  registryWrites: [] as number[],
  stateWrites: [] as number[],
};

function resetChain(): void {
  state.sends = { calls: 0, memos: [], contracts: new Set(), txs: new Map() };
  state.vault = new KeyVault(KEK, new MemoryKeyStore());
  state.backend = new MemoryReserveBackend();
  state.reserve = new IdentityReserve(state.vault, state.backend);
  state.observer = new ChainObserver();
  state.getTransactionCalls = [];
  state.vaultWrites = [];
  state.registryWrites = [];
  state.stateWrites = [];
  const storeSecret = state.vault.storeSecret.bind(state.vault);
  state.vault.storeSecret = async (label, bytes) => {
    state.vaultWrites.push({ label, sendCalls: state.sends.calls });
    return storeSecret(label, bytes);
  };
  const writeRegistry = state.backend.writeRegistry.bind(state.backend);
  state.backend.writeRegistry = async (reg) => {
    state.registryWrites.push(state.sends.calls);
    return writeRegistry(reg);
  };
  const writeState = state.backend.writeState.bind(state.backend);
  state.backend.writeState = async (root, rec, exp) => {
    state.stateWrites.push(state.sends.calls);
    return writeState(root, rec, exp);
  };
  state.payment = { found: true, status: 'success', from: wallet.address, to: creator.address, value: LAUNCH_COST + RESERVE };
}

function fakeChain() {
  const anchor = async (hash: string, kind: AnchorKind, nonce?: string) => {
    state.observer.emit({ type: 'anchorRequested', kind, hash });
    state.sends.calls += 1;
    const tx = `0x${state.sends.calls.toString(16).padStart(64, 'a')}` as Hash;
    state.sends.memos.push(`qsd:v1:${kind}`);
    state.sends.txs.set(tx, 'success');
    state.observer.emit({ type: 'anchored', kind, hash, txSignature: tx, cluster: 'testnet' });
    return { kind, hash, txSignature: tx, lastValidBlockHeight: 1, status: 'confirmed' as const, ...(nonce !== undefined ? { nonce } : {}) };
  };
  return {
    network: 'testnet' as const,
    whype: '0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234' as Address,
    publicClient: {
      async getTransaction(args: { hash: string }) {
        state.getTransactionCalls.push(args.hash);
        const p = state.payment;
        if (p.throws) throw p.throws;
        if (!p.found) return null;
        return { from: p.from, to: p.to, value: p.value };
      },
      async getTransactionReceipt() {
        const p = state.payment;
        if (!p.found) return null;
        return { status: p.status };
      },
    },
    get vault() {
      return state.vault;
    },
    get reserve() {
      return state.reserve;
    },
    get observer() {
      return state.observer;
    },
    creatorAddress: () => creator.address,
    async withCreator() {
      return {
        address: creator.address,
        anchor,
        predictedCa: PREDICTED,
        deployNonce: 2n,
        async deployToken() {
          state.sends.calls += 1;
          const tx = `0x${'b'.repeat(64)}` as Hash;
          state.sends.contracts.add(PREDICTED);
          state.sends.txs.set(tx, 'success');
          return { ca: PREDICTED, txHash: tx, supply: 1n, path: 'elysium-erc20' as const };
        },
        balanceWei: async () => 10n ** 18n,
      };
    },
    journal: () => {
      throw new Error('agent h: journal not used by launch');
    },
  };
}

vi.mock('@/server/chain', () => ({
  getChain: () => fakeChain(),
  chainStatus: () => ({ configured: true, cluster: 'testnet', reason: null }),
  serverCluster: () => 'testnet',
}));

const published: unknown[] = [];
vi.mock('@/server/redis', () => ({
  redisConfigured: () => false,
  publish: async (e: unknown) => {
    published.push(e);
  },
  EVENTS_CHANNEL: 'qsd:events',
}));

// ----------------------------------------------------------------- helpers
const PAYMENT_SIG = `0x${'4'.repeat(64)}` as Hash;
function form(overrides: Partial<import('@/server/launch').LaunchForm> = {}): import('@/server/launch').LaunchForm {
  return {
    name: 'Photon',
    ticker: 'PHO',
    description: 'agent h launch test',
    halfLifePreset: '1h',
    devBuyWei: '0',
    image: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mime: 'image/png' },
    wallet: wallet.address,
    paymentSignature: PAYMENT_SIG,
    ...overrides,
  };
}

async function collect(f: import('@/server/launch').LaunchForm): Promise<{ event: string; data: string }[]> {
  const { runLaunch } = await import('@/server/launch');
  const out: { event: string; data: string }[] = [];
  for await (const fr of runLaunch(f)) out.push(fr);
  return out;
}
const json = (fr: { data: string }) => JSON.parse(fr.data) as Record<string, unknown>;
const cryptoEvents = (frames: { event: string; data: string }[]): CryptoEvent[] => frames.filter((f) => f.event === 'crypto').flatMap((f) => decodeCryptoEvents(new Uint8Array(Buffer.from(f.data, 'base64'))));

beforeAll(async () => {
  const { HALF_LIFE_PRESETS } = await import('@qsd/protocol');
  expect(HALF_LIFE_PRESETS.some((p) => p.id === '1h')).toBe(true);
});

function freshEnvironment(): void {
  fakeDb.reset();
  delete g.__qsdPrisma;
  delete g.__qsdQrng;
  published.length = 0;
  resetChain();
  Object.assign(process.env, { NODE_ENV: 'test' });
  process.env.QSD_QRNG_PROVIDER = 'UNSAFE_DEV_RANDOM';
  process.env.QSD_GENESIS_CONFIG = path.join(ROOT, 'apps/web/genesis.example.json');
  process.env.QSD_LAUNCH_COST_LAMPORTS = LAUNCH_COST.toString();
  process.env.QSD_IDENTITY_RESERVE_LAMPORTS = RESERVE.toString();
  process.env.QSD_LAUNCH_DEV_BUY_LAMPORTS = '0';
  delete process.env.REDIS_URL;
}

// ----------------------------------------------------------------- payment first
describe('payment is verified on-chain BEFORE any identity or key material exists', () => {
  beforeEach(freshEnvironment);
  const failures: { name: string; set: () => void; re: RegExp }[] = [
    { name: 'transaction not found', set: () => (state.payment.found = false), re: /not found or not confirmed/ },
    { name: 'paid to someone other than the protocol creator', set: () => (state.payment.to = other.address), re: /does not involve the wallet and the protocol address/ },
    { name: 'paid by another wallet', set: () => (state.payment.from = other.address), re: /does not involve the wallet and the protocol address/ },
    { name: 'transaction reverted', set: () => (state.payment.status = 'reverted'), re: /failed on-chain/ },
    { name: 'one wei short', set: () => (state.payment.value = LAUNCH_COST + RESERVE - 1n), re: /below the required/ },
    { name: 'dev buy not covered', set: () => (process.env.QSD_LAUNCH_DEV_BUY_LAMPORTS = '500000000'), re: /below the required/ },
  ];
  for (const f of failures) {
    it(`${f.name}: an error frame, no vault write, no reserve entry, no transaction, no coin`, async () => {
      f.set();
      const frames = await collect(form(f.name === 'dev buy not covered' ? { devBuyWei: '500000000' } : {}));
      expect(frames.map((x) => x.event)).toEqual(['status', 'error']);
      expect(String(json(frames[1]!)['message'])).toMatch(f.re);
      expect(state.getTransactionCalls).toEqual([PAYMENT_SIG]);
      expect(state.vaultWrites).toEqual([]);
      expect(await state.vault.store.list()).toEqual([]);
      expect(Object.keys(await state.backend.readRegistry())).toEqual([]);
      expect(state.sends.calls).toBe(0);
      expect(fakeDb.coin.rows.length).toBe(0);
      expect(fakeDb.identity.rows.length).toBe(0);
      expect(fakeDb.eventLog.rows.length).toBe(0);
    });
  }

  it('a dev buy other than the fixed amount → refused before the chain is read', async () => {
    const frames = await collect(form({ devBuyWei: '500000000' }));
    expect(frames.at(-1)!.event).toBe('error');
    expect(String(json(frames.at(-1)!)['message'])).toMatch(/dev buy must be exactly 0 wei of HYPE/);
    expect(state.getTransactionCalls).toEqual([]);
    expect(state.vaultWrites).toEqual([]);
  });

  it('launch cost not configured → refused before the chain is read', async () => {
    delete process.env.QSD_LAUNCH_COST_LAMPORTS;
    const frames = await collect(form());
    expect(frames.at(-1)!.event).toBe('error');
    expect(String(json(frames.at(-1)!)['message'])).toMatch(/not configured/);
    expect(state.getTransactionCalls).toEqual([]);
    expect(state.vaultWrites).toEqual([]);
  });

  it('an invalid form never reaches the chain', async () => {
    const frames = await collect(form({ ticker: 'lower' }));
    expect(frames.map((x) => x.event)).toEqual(['error']);
    expect(state.getTransactionCalls).toEqual([]);
  });
});

// ----------------------------------------------------------------- the happy path, examined
describe('a successful Elysium testnet launch', () => {
  let frames: { event: string; data: string }[];
  let ca: string;
  beforeAll(async () => {
    freshEnvironment();
    frames = await collect(form());
    const done = frames.find((f) => f.event === 'done');
    if (!done) throw new Error(`launch did not finish: ${frames.map((f) => f.event + ':' + f.data.slice(0, 120)).join(' | ')}`);
    ca = String(json(done)['ca']);
  }, 120_000);

  // this describe runs on the state the launch left behind (no per-test reset here)
  const captured = { vaultWrites: [] as typeof state.vaultWrites, registryWrites: [] as number[], stateWrites: [] as number[], sends: null as unknown as Sends, vault: null as unknown as KeyVault, backend: null as unknown as MemoryReserveBackend, reserve: null as unknown as IdentityReserve };
  beforeAll(() => {
    captured.vaultWrites = state.vaultWrites;
    captured.registryWrites = state.registryWrites;
    captured.stateWrites = state.stateWrites;
    captured.sends = state.sends;
    captured.vault = state.vault;
    captured.backend = state.backend;
    captured.reserve = state.reserve;
  });

  it('frame sequence: payment → mint → identity (crypto) → superposition → quantum → crypto (signing) → chain → launch → lineage → done; no error', () => {
    const ev = frames.map((f) => f.event);
    expect(ev).not.toContain('error');
    const order = ['status', 'status', 'status', 'crypto', 'superposition', 'quantum', 'crypto', 'chain', 'chain', 'status', 'launch', 'status', 'lineage', 'done'];
    const compact = ev.filter((e, i) => e !== ev[i - 1] || e === 'status' || e === 'chain');
    expect(compact).toEqual(order);
    expect(json(frames[0]!)).toEqual({ step: 'payment', message: 'verifying payment' });
  });

  it('the payment was checked on-chain before the mint keypair was vaulted and before the identity seed existed', () => {
    expect(captured.vaultWrites.map((w) => w.label)).toEqual([`qsd/mint/${ca}`, `qsd/identity-seed/${ca}`]);
    // getTransaction call precedes both (frames: status(payment) then status(mint) carrying the ca)
    expect(json(frames[1]!)).toMatchObject({ step: 'mint', ca });
  });

  it('the identity reserve entry and its initial state were persisted before any transaction was sent (sendCalls = 0 at write time); the deploy was the last of three Elysium transactions', () => {
    expect(captured.registryWrites).toEqual([0]);
    expect(captured.stateWrites.length).toBeGreaterThanOrEqual(1);
    expect(captured.stateWrites[0]).toBe(0);
    expect(captured.sends.calls).toBe(3); // precommit anchor, proof anchor, ERC-20 deploy
    expect(captured.sends.memos).toEqual(['qsd:v1:precommit', 'qsd:v1:proof']);
    expect(captured.sends.contracts.has(ca)).toBe(true);
    expect(ca).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('the crypto stream is REDACTED: every keygen chainStep below depth 15 carries sha256(real value), depth 15 / leaves / fused / root carry the real values, and the stream is exactly redact(regenerate-from-seed)', async () => {
    const entry = await captured.reserve.entry(ca);
    expect(entry).toBeDefined();
    const seed = await captured.vault.loadSecret(entry!.seedLabel);
    const observer = new CryptoObserver();
    const raw: CryptoEvent[] = [];
    observer.subscribe((e) => raw.push(e));
    const id = createIdentity(seed, { observer });
    expect(id.rootHex).toBe(entry!.identityRoot);

    const sent = cryptoEvents(frames);
    const KEYGEN = new Set<CryptoEvent['type']>(['keygenStart', 'chainStep', 'chainComplete', 'leafFormed', 'treeLevelFused', 'rootReady']);
    const keygenSent = sent.filter((e) => KEYGEN.has(e.type));
    // the stream carries every keygen event except chainSteps outside the sampled leaves
    const { streamedCryptoEvent } = await import('@/server/launch');
    const rawKeygen = raw.filter((e) => KEYGEN.has(e.type) && streamedCryptoEvent(e));
    expect(keygenSent.length).toBe(rawKeygen.length);
    expect(keygenSent.filter((e) => e.type === 'chainComplete').length).toBe(raw.filter((e) => e.type === 'chainComplete').length);
    expect(keygenSent.length).toBeLessThan(raw.filter((e) => KEYGEN.has(e.type)).length / 10);
    let secretSteps = 0;
    let publicSteps = 0;
    for (let i = 0; i < keygenSent.length; i++) {
      const s = keygenSent[i]! as CryptoEvent & { hash?: Uint8Array; depth?: number };
      const r = rawKeygen[i]! as CryptoEvent & { hash?: Uint8Array; depth?: number };
      expect(s.type).toBe(r.type);
      if (s.type === 'chainStep') {
        expect(s.depth).toBe(r.depth);
        if (s.depth! < 15) {
          secretSteps++;
          expect(toHex(s.hash!)).toBe(createHash('sha256').update(r.hash!).digest('hex'));
          expect(toHex(s.hash!)).not.toBe(toHex(r.hash!));
        } else {
          publicSteps++;
          expect(toHex(s.hash!)).toBe(toHex(r.hash!));
        }
      } else if (r.hash && s.hash) {
        expect(toHex(s.hash)).toBe(toHex(r.hash));
      }
    }
    expect(secretSteps).toBeGreaterThan(1000);
    expect(publicSteps).toBeGreaterThan(0);
    // the signing stream carries only public values: no chainStep at all, and the stop values equal the regenerated chain at that depth
    const signing = sent.filter((e) => e.type === 'signChainStop' || e.type === 'signStart' || e.type === 'authPathNode' || e.type === 'signatureReady');
    expect(signing.length).toBeGreaterThan(0);
    const stops = signing.filter((e) => e.type === 'signChainStop') as (CryptoEvent & { chainIdx: number; depth: number; hash: Uint8Array })[];
    const leaf0 = raw.filter((e) => e.type === 'chainStep' && (e as { leaf: number }).leaf === 0) as (CryptoEvent & { chainIdx: number; depth: number; hash: Uint8Array })[];
    for (const st of stops) {
      const match = leaf0.find((r) => r.chainIdx === st.chainIdx && r.depth === st.depth);
      expect(match, `signChainStop chain=${st.chainIdx} depth=${st.depth}`).toBeDefined();
      expect(toHex(st.hash)).toBe(toHex(match!.hash));
    }
  });

  it('no secret reaches the stream: not the seed, not the KEK, not one depth-0..14 chain value, in any frame of any kind', async () => {
    const entry = await captured.reserve.entry(ca);
    const seed = await captured.vault.loadSecret(entry!.seedLabel);
    const all = frames.map((f) => (f.event === 'crypto' ? Buffer.from(f.data, 'base64').toString('hex') : f.data + Buffer.from(f.data).toString('hex'))).join('\n');
    expect(all).not.toContain(toHex(seed));
    expect(all).not.toContain(Buffer.from(seed).toString('base64'));
    expect(all).not.toContain(toHex(KEK));
    // The first one-time key (leaf 0) signed the launch statement: its chain values at and above the
    // signature's stop depth ARE the signature, public by design. Everything below, and every other leaf, is secret.
    const stops = new Map<number, number>();
    for (const e of cryptoEvents(frames)) if (e.type === 'signChainStop') stops.set(e.chainIdx, e.depth);
    expect(stops.size).toBeGreaterThan(0);
    const observer = new CryptoObserver();
    const secrets: string[] = [];
    observer.subscribe((e) => {
      if (e.type !== 'chainStep' || e.depth >= 15) return;
      const revealed = e.leaf === 0 && e.depth >= (stops.get(e.chainIdx) ?? 99);
      if (!revealed && secrets.length < 2000) secrets.push(toHex(e.hash));
    });
    createIdentity(seed, { observer });
    expect(secrets.length).toBeGreaterThan(500);
    for (const s of secrets) expect(all).not.toContain(s);
  });

  it('the coin row, image, identity mirror and launch log were persisted with the real mint signature; the lineage id is the quantum draw', async () => {
    const coin = fakeDb.coin.rows.find((r) => r['ca'] === ca)!;
    expect(coin).toBeDefined();
    const launch = json(frames.find((f) => f.event === 'launch')!);
    expect(coin['launchTx']).toBe(launch['txSignature']);
    expect(captured.sends.txs.get(String(launch['txSignature']))).toBe('success');
    expect(coin['state']).toBe('superposed');
    expect(coin['generation']).toBe(1);
    expect(coin['createdBy']).toBe(wallet.address);
    expect(String(coin['lineageId'])).toMatch(/^[0-9a-f]{32}$/);
    const q = frames.filter((f) => f.event === 'quantum').map(json);
    expect(q.some((e) => e['type'] === 'entropyArrived')).toBe(true);
    expect(fakeDb.coinImage.rows.length).toBe(1);
    expect(fakeDb.identity.rows[0]).toMatchObject({ coinCa: ca, nextIndex: 1 });
    expect(fakeDb.eventLog.rows.map((e) => e['type'])).toEqual(['launch']);
    expect((fakeDb.eventLog.rows[0]!['data'] as Record<string, unknown>)['paymentTx']).toBe(PAYMENT_SIG);
    expect(published).toContainEqual({ type: 'coin', ca });
  });

  it('FINDING H-W1 (HIGH): the payment replay check looks for the payment signature in Coin.launchTx, which holds the MINT transaction — so the same payment launches a second coin', async () => {
    // same chain, same database, same payment signature, a fresh form
    expect(fakeDb.coin.rows.length).toBe(1);
    const again = await collect(form({ name: 'Photon again' }));
    const last = again.at(-1)!;
    expect(last.event, `second launch with the same payment must fail; got: ${again.map((f) => f.event).join(',')}`).toBe('error');
    expect(String(json(last)['message'])).toMatch(/already used/);
    expect(fakeDb.coin.rows.length).toBe(1);
  }, 120_000);
});

describe('error frames', () => {
  beforeEach(freshEnvironment);
  it('LOW H-W11: a chain error is forwarded raw into the SSE error frame (e.message, no redactSecrets) — an RPC URL with an api-key, as web3.js puts into fetch errors, reaches the browser', async () => {
    state.payment.throws = new Error('failed to get transaction: fetch failed https://elysium-testnet.g.alchemy.com/v2/?api-key=agent-h-secret-key');
    const frames = await collect(form());
    const last = frames.at(-1)!;
    expect(last.event).toBe('error');
    expect(last.data).not.toContain('agent-h-secret-key');
  });
});
