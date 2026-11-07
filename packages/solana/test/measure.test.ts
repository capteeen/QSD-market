import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { UnsafeDevRandomProvider, createQrngClient, verify, bundleHash, hashJson } from '@qsd/quantum';
import { measurementInputs, measurementResolver } from '@qsd/protocol';
import { ChainObserver, MemoryJournalStore, anchorWith, autoMeasureDue, decodeAnchorMemo, measureCoin, recordChainEvents, type MeasurementJournalDoc } from '../src/index.js';
import { FakeChain } from './helpers/fakeChain.js';
import { coin } from './helpers/coin.js';

describe('measureCoin', () => {
  it('anchors a precommit BEFORE the draw, then the bundle hash, and applies a verifiable bundle', async () => {
    const payer = Keypair.generate();
    const chain = new FakeChain(payer);
    const observer = new ChainObserver();
    const rec = recordChainEvents(observer);
    const client = createQrngClient({ provider: new UnsafeDevRandomProvider() });
    const drawOrder: string[] = [];
    client.subscribe((e) => drawOrder.push(`quantum:${e.type}`));
    observer.subscribe((e) => drawOrder.push(`chain:${e.type}:${'kind' in e ? e.kind : ''}`));
    const journal = new MemoryJournalStore<MeasurementJournalDoc>();
    const c = coin();
    const at = c.lastActivityAt + 600;
    const r = await measureCoin(c, { by: 'WalletMeasurerAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1', at }, { client: client, anchor: anchorWith({ sender: chain, observer }), verify: { allowUnsafeDev: true }, journal });

    // order: precommit anchored, then entropy requested, then proof anchored
    const iPre = drawOrder.indexOf('chain:anchored:precommit');
    const iReq = drawOrder.indexOf('quantum:entropyRequested');
    const iProof = drawOrder.indexOf('chain:anchored:proof');
    expect(iPre).toBeGreaterThanOrEqual(0);
    expect(iPre).toBeLessThan(iReq);
    expect(iReq).toBeLessThan(iProof);

    // the memos on-chain are the exact strings
    expect(chain.memos).toHaveLength(2);
    const pre = decodeAnchorMemo(chain.memos[0]!.memo)!;
    expect(pre).toEqual({ kind: 'precommit', hash: hashJson(measurementInputs(c, at)), nonce: r.nonce });
    expect(decodeAnchorMemo(chain.memos[1]!.memo)).toEqual({ kind: 'proof', hash: bundleHash(r.bundle) });
    expect(r.precommit.txSignature).toBe(chain.memos[0]!.signature);
    expect(r.proof.txSignature).toBe(chain.memos[1]!.signature);

    // bundle verifies and is bound to the anchored nonce
    expect(verify(r.bundle, measurementResolver, { allowUnsafeDev: true })).toEqual({ ok: true });
    // (UNSAFE_DEV_RANDOM carries no binding in its attestation; the ANU witness attestation does — see requireInputBinding)
    expect(r.bundle.inputs.hash).toBe(r.inputsHash);
    expect(r.measurement.id).toBe(bundleHash(r.bundle));
    expect(['survive', 'tunnel', 'collapse']).toContain(r.outcome.kind);
    expect(r.coin.measurements).toHaveLength(1);

    // journal has both signatures
    const doc = (await journal.load())!;
    expect(doc.precommitTx).toBe(r.precommit.txSignature);
    expect(doc.proofTx).toBe(r.proof.txSignature);
    expect(doc.bundleHash).toBe(bundleHash(r.bundle));
    expect(doc.completedAt).toBeTruthy();
    expect(rec.events.map((e) => e.type)).toEqual(['anchorRequested', 'anchored', 'anchorRequested', 'anchored']);
  });

  it('a failed precommit anchor means no draw is made', async () => {
    const client = createQrngClient({ provider: new UnsafeDevRandomProvider() });
    let draws = 0;
    client.subscribe((e) => {
      if (e.type === 'entropyRequested') draws++;
    });
    const c = coin();
    await expect(
      measureCoin(c, { by: 'w', at: c.lastActivityAt + 10 }, {
        client,
        anchor: async () => {
          throw new Error('rpc down');
        },
      }),
    ).rejects.toThrow('rpc down');
    expect(draws).toBe(0);
  });

  it('autoMeasureDue selects only coins past 2 half-lives of quiet', () => {
    const a = coin({ ca: 'A'.repeat(44), lastActivityAt: 0 });
    const b = coin({ ca: 'B'.repeat(44), lastActivityAt: 10_000 });
    const dead = coin({ ca: 'C'.repeat(44), lastActivityAt: 0, state: 'collapsed' });
    expect(autoMeasureDue([a, b, dead], 7_300).map((c) => c.ca)).toEqual([a.ca]);
  });
});
