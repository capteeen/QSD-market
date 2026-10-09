import { describe, expect, it } from 'vitest';
import fixture from './fixtures/anu-documented-response.json';
import {
  ANU_DEFAULT_ENDPOINT,
  AnuQuantumNumbersProvider,
  createQrngClient,
  ed25519SignerFromSeed,
  ephemeralEd25519Signer,
  MeasurementUnavailableError,
  parseAnuResponse,
  recordEvents,
  verifyBundle,
} from '../src/index.js';
import { sampleInputs, testResolver } from './helpers.js';

const SECRET = 'this-is-the-api-key-and-must-never-leak';
const witness = ed25519SignerFromSeed(new Uint8Array(32).fill(42));

function mockFetch(status: number, bodyObj: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(bodyObj), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('parseAnuResponse against the documented fixture', () => {
  it('parses hex8', () => {
    const bytes = parseAnuResponse(JSON.stringify(fixture.response.body), 8);
    expect(Array.from(bytes)).toEqual([0x2f, 0x24, 0x97, 0xd2, 0x07, 0xa3, 0x9d, 0x67]);
  });
  it('parses uint8', () => {
    const bytes = parseAnuResponse(JSON.stringify(fixture.responseUint8.body), 4);
    expect(Array.from(bytes)).toEqual([224, 0, 255, 17]);
  });
  it('rejects length mismatch, bad values, non-success, non-JSON', () => {
    expect(() => parseAnuResponse(JSON.stringify(fixture.response.body), 7)).toThrow(MeasurementUnavailableError);
    expect(() => parseAnuResponse('{"success":true,"type":"hex8","data":["zz"]}', 1)).toThrow(/malformed hex8/);
    expect(() => parseAnuResponse('{"success":true,"type":"uint8","data":[256]}', 1)).toThrow(/malformed uint8/);
    expect(() => parseAnuResponse('{"success":true,"type":"hex16","data":["abcd"]}', 1)).toThrow(/unexpected data type/);
    expect(() => parseAnuResponse(JSON.stringify(fixture.responseForbidden.body), 1)).toThrow(/Forbidden/);
    expect(() => parseAnuResponse('not json', 1)).toThrow(/not valid JSON/);
  });
});

describe('AnuQuantumNumbersProvider with mocked transport', () => {
  it('sends the documented request and produces a verifiable witness-signed draw', async () => {
    const { f, calls } = mockFetch(200, fixture.response.body, fixture.response.headers);
    const provider = new AnuQuantumNumbersProvider({ apiKey: SECRET, witness, fetch: f });
    const client = createQrngClient({ provider });
    const rec = recordEvents(client);

    const { draw, bundle } = await client.measure(sampleInputs, testResolver, { nBytes: 8 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${ANU_DEFAULT_ENDPOINT}?length=8&type=hex8&size=1`);
    expect((calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe(SECRET);

    expect(draw.providerId).toBe('anu-quantum-numbers');
    expect(Array.from(draw.bytes)).toEqual([0x2f, 0x24, 0x97, 0xd2, 0x07, 0xa3, 0x9d, 0x67]);
    expect(draw.attestation.kind).toBe('witness-signed');
    if (draw.attestation.kind !== 'witness-signed') throw new Error();
    expect(draw.attestation.witnessPublicKey).toBe(witness.publicKey);
    expect(draw.attestation.response.body).toBe(JSON.stringify(fixture.response.body));
    expect(draw.attestation.response.headers['x-amzn-requestid']).toBe(fixture.response.headers['x-amzn-requestid']);
    expect(draw.attestation.response.headers['date']).toBe(fixture.response.headers['date']);
    expect(JSON.stringify(draw.attestation)).not.toContain(SECRET);
    expect(JSON.stringify(bundle)).not.toContain(SECRET);

    expect(rec.events.map((e) => e.type)).toEqual([
      'entropyRequested',
      'entropyArrived',
      'commitmentComputed',
      'outcomeResolved',
    ]);

    expect(verifyBundle(bundle, testResolver)).toEqual({ ok: true });
    expect(verifyBundle(bundle, testResolver, { trustedWitnessKeys: [witness.publicKey] })).toEqual({ ok: true });
    expect(
      verifyBundle(bundle, testResolver, { trustedWitnessKeys: [ephemeralEd25519Signer().publicKey] }).ok,
    ).toBe(false);
  });

  it('403 -> MeasurementUnavailableError with a UI-safe message, key not leaked', async () => {
    const { f } = mockFetch(403, fixture.responseForbidden.body);
    const provider = new AnuQuantumNumbersProvider({ apiKey: SECRET, witness, fetch: f });
    const err = await provider.draw(8).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MeasurementUnavailableError);
    const m = err as MeasurementUnavailableError;
    expect(m.code).toBe('http-status');
    expect(m.message).toMatch(/^Measurement unavailable/);
    expect(m.message).not.toContain(SECRET);
  });

  it('429 -> rate limit message', async () => {
    const { f } = mockFetch(429, fixture.responseRateLimited.body);
    const provider = new AnuQuantumNumbersProvider({ apiKey: SECRET, witness, fetch: f });
    await expect(provider.draw(8)).rejects.toThrow(/rate limit/);
  });

  it('network failure -> MeasurementUnavailableError, no fallback', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const provider = new AnuQuantumNumbersProvider({ apiKey: SECRET, witness, fetch: f });
    const err = (await provider.draw(8).catch((e: unknown) => e)) as MeasurementUnavailableError;
    expect(err).toBeInstanceOf(MeasurementUnavailableError);
    expect(err.code).toBe('network');
    expect(err.message).toMatch(/could not be reached/);
  });

  it('timeout -> MeasurementUnavailableError', async () => {
    const f = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const provider = new AnuQuantumNumbersProvider({ apiKey: SECRET, witness, fetch: f, timeoutMs: 20 });
    const err = (await provider.draw(8).catch((e: unknown) => e)) as MeasurementUnavailableError;
    expect(err).toBeInstanceOf(MeasurementUnavailableError);
    expect(err.message).toMatch(/did not respond within/);
  });

  it('200 with wrong length -> bad-response', async () => {
    const { f } = mockFetch(200, fixture.response.body);
    const provider = new AnuQuantumNumbersProvider({ apiKey: SECRET, witness, fetch: f });
    const err = (await provider.draw(16).catch((e: unknown) => e)) as MeasurementUnavailableError;
    expect(err.code).toBe('bad-response');
  });

  it('refuses out-of-range nBytes', async () => {
    const { f } = mockFetch(200, fixture.response.body);
    const provider = new AnuQuantumNumbersProvider({ apiKey: SECRET, witness, fetch: f });
    await expect(provider.draw(1025)).rejects.toThrow(/1\.\.1024/);
  });

  it('honours an endpoint override', async () => {
    const { f, calls } = mockFetch(200, fixture.response.body);
    const provider = new AnuQuantumNumbersProvider({
      apiKey: SECRET,
      witness,
      fetch: f,
      endpoint: 'https://proxy.example/anu/',
    });
    await provider.draw(8);
    expect(calls[0]!.url).toBe('https://proxy.example/anu?length=8&type=hex8&size=1');
  });
});

const LIVE_KEY = process.env['QSD_QRNG_API_KEY'];

describe.skipIf(!LIVE_KEY)('AnuQuantumNumbersProvider LIVE (needs QSD_QRNG_API_KEY)', () => {
  if (!LIVE_KEY) {
    // eslint-disable-next-line no-console
    console.log('[anu.test] QSD_QRNG_API_KEY not set; skipping live ANU Quantum Numbers test.');
  }
  it('draws 32 bytes from the live API and the bundle verifies', async () => {
    const provider = new AnuQuantumNumbersProvider({
      apiKey: LIVE_KEY!,
      witness,
      ...(process.env['QSD_QRNG_ENDPOINT'] ? { endpoint: process.env['QSD_QRNG_ENDPOINT'] } : {}),
    });
    const client = createQrngClient({ provider });
    const { draw, bundle } = await client.measure(sampleInputs, testResolver);
    expect(draw.bytes.length).toBe(32);
    expect(new Set(Array.from(draw.bytes)).size).toBeGreaterThan(1);
    expect(verifyBundle(bundle, testResolver, { trustedWitnessKeys: [witness.publicKey] })).toEqual({ ok: true });
  }, 30_000);
});
