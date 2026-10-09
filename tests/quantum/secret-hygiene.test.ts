/**
 * Spec §4: "the integrator will supply the API key via env"; §9: "no secrets
 * in logs". Checks the ANU provider never puts the key in a URL, error,
 * attestation, event, JSON or console-style dump, and that the witness seed
 * is not recoverable from the provider object.
 */
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  AnuQuantumNumbersProvider,
  createProviderFromEnv,
  createQrngClient,
  ed25519SignerFromSeed,
  recordEvents,
  MeasurementUnavailableError,
  type OutcomeResolver,
} from '@qsd/quantum';

const API_KEY = 'THE-SECRET-API-KEY-0xDEADBEEF';
const WITNESS_SEED_HEX = 'ab'.repeat(32);
const witness = ed25519SignerFromSeed(new Uint8Array(Buffer.from(WITNESS_SEED_HEX, 'hex')));
const resolver: OutcomeResolver<{ p: number }> = { id: 'h/v1', resolve: (b) => ({ value: b[0]!, label: String(b[0]) }) };

const okBody = JSON.stringify({ success: true, type: 'hex8', length: '4', data: ['00', '01', '02', '03'] });

describe('ANU provider secret hygiene', () => {
  it('the key goes only in the x-api-key header; never in the URL, attestation, commitment input or events', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenHeaders = { ...(init?.headers as Record<string, string>) };
      return new Response(okBody, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const p = new AnuQuantumNumbersProvider({ apiKey: API_KEY, witness, fetch: f });
    const client = createQrngClient({ provider: p });
    const rec = recordEvents(client.bus);
    const { bundle } = await client.measure({ p: 1 }, resolver, { nBytes: 4 });
    rec.stop();
    expect(seenHeaders['x-api-key']).toBe(API_KEY);
    expect(seenUrl).not.toContain(API_KEY);
    expect(JSON.stringify(bundle)).not.toContain(API_KEY);
    expect(JSON.stringify(rec.events, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v))).not.toContain(API_KEY);
    expect(JSON.stringify(bundle)).not.toContain(WITNESS_SEED_HEX);
  });

  it('errors (403, 429, network, timeout, bad body) never contain the key or the witness seed', async () => {
    const mk = (f: typeof fetch) => new AnuQuantumNumbersProvider({ apiKey: API_KEY, witness, fetch: f, timeoutMs: 50 });
    const attempts: Array<() => Promise<unknown>> = [
      () => mk((async () => new Response('{"message":"Forbidden"}', { status: 403 })) as typeof fetch).draw(4),
      () => mk((async () => new Response('{"message":"Limit Exceeded"}', { status: 429 })) as typeof fetch).draw(4),
      () => mk((async () => { throw new TypeError(`fetch failed for key ${API_KEY}`); }) as typeof fetch).draw(4),
      () => mk((async (_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch).draw(4),
      () => mk((async () => new Response('not json', { status: 200 })) as typeof fetch).draw(4),
      () => mk((async () => new Response(JSON.stringify({ success: true, type: 'hex8', length: '4', data: ['zz', '01', '02', '03'] }), { status: 200 })) as typeof fetch).draw(4),
    ];
    for (const run of attempts) {
      let err: unknown;
      try { await run(); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(MeasurementUnavailableError);
      const text = [String(err), (err as Error).message, inspect(err, { depth: 1 }), JSON.stringify(err)].join('\n');
      expect(text).not.toContain(WITNESS_SEED_HEX);
      expect((err as Error).message).not.toContain(API_KEY);
      expect(String(err)).not.toContain(API_KEY);
      // The `cause` is a raw network error and may carry anything the fetch impl put there; check it is not surfaced by message/toString.
    }
  });

  it('FINDING H-Q6 (MEDIUM): JSON.stringify / util.inspect of the provider object reveal the API key (TS `private` is not runtime-private)', () => {
    const p = new AnuQuantumNumbersProvider({ apiKey: API_KEY, witness, fetch: (async () => new Response('')) as typeof fetch });
    const json = JSON.stringify(p);
    const dump = inspect(p, { depth: 4 });
    expect(json, 'JSON.stringify(provider) must not contain the API key').not.toContain(API_KEY);
    expect(dump, 'util.inspect(provider) / console.log(provider) must not contain the API key').not.toContain(API_KEY);
  });

  it('the witness seed is not recoverable from the provider or the signer object', () => {
    const p = new AnuQuantumNumbersProvider({ apiKey: 'k', witness, fetch: (async () => new Response('')) as typeof fetch });
    const dump = inspect(p, { depth: 6, showHidden: true }) + JSON.stringify(p) + inspect(witness, { depth: 6, showHidden: true });
    expect(dump).not.toContain(WITNESS_SEED_HEX);
  });

  it('createProviderFromEnv error messages never echo the key or seed', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      for (const env of [
        { QSD_QRNG_API_KEY: API_KEY },
        { QSD_QRNG_API_KEY: API_KEY, QSD_WITNESS_SECRET_KEY: 'short' },
        { QSD_QRNG_API_KEY: API_KEY, QSD_WITNESS_SECRET_KEY: WITNESS_SEED_HEX, QSD_QRNG_PROVIDER: 'bogus' },
      ]) {
        try { createProviderFromEnv(env); } catch (e) {
          expect((e as Error).message).not.toContain(API_KEY);
          expect((e as Error).message).not.toContain(WITNESS_SEED_HEX);
        }
      }
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
    }
  });

  it('LOW H-Q8: a provider error message is echoed verbatim into a UI-safe error (third-party string injection)', async () => {
    const p = new AnuQuantumNumbersProvider({ apiKey: 'k', witness, fetch: (async () => new Response(JSON.stringify({ success: false, message: '<img src=x onerror=alert(1)> visit evil.example' }), { status: 200 })) as typeof fetch });
    let err: Error | undefined;
    try { await p.draw(4); } catch (e) { err = e as Error; }
    expect(err).toBeInstanceOf(MeasurementUnavailableError);
    // Documented: the message is described as "safe to show in the UI" but embeds provider-controlled text.
    expect(err!.message).toContain('evil.example');
  });
});
