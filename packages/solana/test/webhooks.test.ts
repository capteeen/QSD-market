import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WebhookAuthError, ChainError, buildHeliusWebhookRegistration, parseHeliusWebhook } from '../src/index.js';

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/helius-enhanced-swap.json'), 'utf8')) as { payload: unknown[] };
const SECRET = 'whsec_test_value';
const MINT = 'DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ';

describe('parseHeliusWebhook', () => {
  it('parses the documented SWAP example into one BuyEvent', () => {
    const events = parseHeliusWebhook(fixture.payload, SECRET, { secret: SECRET, mints: [MINT] });
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.mint).toBe(MINT);
    expect(e.buyer).toBe('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    expect(e.lamports).toBe(500_000_000n);
    expect(e.tokenUnits).toBe(1_234_567_890_123n);
    expect(e.slot).toBe(287654321);
    expect(e.signature).toMatch(/^5h6xBEau/);
    expect(e.type).toBe('SWAP');
  });

  it('falls back to nativeTransfers when events.swap is absent', () => {
    const tx = structuredClone(fixture.payload[0]) as { events: unknown };
    tx.events = {};
    const [e] = parseHeliusWebhook([tx], SECRET, { secret: SECRET });
    expect(e?.lamports).toBe(500_000_000n);
    expect(e?.tokenUnits).toBeUndefined();
    expect(e?.tokenUiAmount).toBeCloseTo(1234567.890123);
  });

  it('accepts a JSON string body and filters by mint', () => {
    expect(parseHeliusWebhook(JSON.stringify(fixture.payload), SECRET, { secret: SECRET, mints: ['other'] })).toEqual([]);
    expect(parseHeliusWebhook(JSON.stringify(fixture.payload), SECRET, { secret: SECRET })).toHaveLength(1);
  });

  it('rejects bad, missing or unset auth', () => {
    expect(() => parseHeliusWebhook(fixture.payload, 'wrong', { secret: SECRET })).toThrow(WebhookAuthError);
    expect(() => parseHeliusWebhook(fixture.payload, undefined, { secret: SECRET })).toThrow(/missing Authorization/);
    expect(() => parseHeliusWebhook(fixture.payload, SECRET, { secret: undefined })).toThrow(/QSD_WEBHOOK_SECRET is unset/);
    expect(() => parseHeliusWebhook(fixture.payload, SECRET + 'x', { secret: SECRET })).toThrow(WebhookAuthError);
  });

  it('rejects malformed bodies and ignores failed transactions', () => {
    expect(() => parseHeliusWebhook('{not json', SECRET, { secret: SECRET })).toThrow(ChainError);
    expect(() => parseHeliusWebhook({ a: 1 }, SECRET, { secret: SECRET })).toThrow(/JSON array/);
    const failed = structuredClone(fixture.payload[0]) as Record<string, unknown>;
    failed['transactionError'] = { InstructionError: [0, 'Custom'] };
    expect(parseHeliusWebhook([failed], SECRET, { secret: SECRET })).toEqual([]);
  });

  it('builds the documented registration body', () => {
    const r = buildHeliusWebhookRegistration({ webhookUrl: 'https://qsd.market/api/webhooks/helius', mints: [MINT], cluster: 'devnet', secret: SECRET });
    expect(r.body).toEqual({ webhookURL: 'https://qsd.market/api/webhooks/helius', transactionTypes: ['SWAP'], accountAddresses: [MINT], webhookType: 'enhancedDevnet', authHeader: SECRET, txnStatus: 'success' });
    expect(r.url('k')).toBe('https://api.helius.xyz/v0/webhooks?api-key=k');
  });
});
