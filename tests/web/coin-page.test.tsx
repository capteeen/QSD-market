// @vitest-environment jsdom
/**
 * Agent H — the coin page's in-browser proof verification (SPEC §8 l.343-345;
 * physics.md "where the trust actually sits"). Two REAL bundles are produced
 * with the quantum package: a witness-signed, input-bound one through the ANU
 * provider with an injected fetch (no network; the witness key is Agent H's),
 * and an UNSAFE_DEV_RANDOM one (NODE_ENV=test). Both go through the protocol
 * resolver, are served to CoinView, and "Verify in browser" is clicked.
 */
import './client-mocks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { measurementInputs, measurementResolver, applyMeasurement, type Coin } from '@qsd/protocol';
import { AnuQuantumNumbersProvider, UnsafeDevRandomProvider, createQrngClient, ed25519SignerFromSeed, type ProofBundle, type QrngProvider } from '@qsd/quantum';
import { COIN } from '@/copy';
import { CoinView } from '@/components/views/CoinView';
import type { CoinDto, MeasurementDto } from '@/lib/types';
import { walletState } from './client-mocks';
import { DOWN, bodyText, renderPage, stubFetch } from './render';

const CA = 'So11111111111111111111111111111111111111112';
const WITNESS = ed25519SignerFromSeed(new Uint8Array(createHash('sha256').update('agent-h-witness').digest()));
const OTHER_KEY = ed25519SignerFromSeed(new Uint8Array(32).fill(7)).publicKey;

function coin(): Coin {
  return {
    ca: CA,
    name: 'PHOTON',
    ticker: 'PHO',
    image: { uri: '/api/coin/x/image', hash: 'ab'.repeat(32), lineage: 'cd'.repeat(32) },
    lineageId: 'l1',
    generation: 1,
    identityRoot: 'ef'.repeat(32),
    halfLifeSec: 3600,
    decayProgress: 0,
    decayChannels: [{ id: 'fast', probabilityPpm: 1_000_000, label: 'fast decay', daughterParams: { halfLifeSec: { min: 3600, max: 86_400 }, poolUnits: { min: 100n, max: 200n } } }],
    superposition: { supplyMin: 100n, supplyMax: 200n },
    supply: { totalUnits: 1_000_000n, remainingUnits: 1_000_000n, decimals: 0 },
    state: 'superposed',
    lastActivityAt: 1_700_000_000,
    measurements: [],
    bornAt: 1_700_000_000,
  };
}

/** The ANU provider against an injected fetch answering 32 chosen bytes in ANU's documented shape. */
function anuProvider(bytes: Uint8Array): QrngProvider {
  const body = JSON.stringify({ success: true, type: 'hex8', length: String(bytes.length), data: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')) });
  const fakeFetch = (async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json', date: 'Thu, 09 Oct 2026 09:00:00 GMT' } })) as unknown as typeof fetch;
  return new AnuQuantumNumbersProvider({ apiKey: 'agent-h-not-a-real-key', witness: WITNESS, fetch: fakeFetch });
}

async function measured(kind: 'witness' | 'dev', bytes = new Uint8Array(32).fill(0xff)): Promise<{ dto: CoinDto; bundle: ProofBundle }> {
  const c = coin();
  const at = c.lastActivityAt + 1800;
  const provider = kind === 'witness' ? anuProvider(bytes) : new UnsafeDevRandomProvider();
  const client = createQrngClient({ provider });
  const { bundle } = await client.measure(measurementInputs(c, at), measurementResolver);
  const verify = kind === 'witness' ? { trustedWitnessKeys: [WITNESS.publicKey], requireInputBinding: true } : { allowUnsafeDev: true };
  const { coin: next, measurement: m } = applyMeasurement(c, bundle, { at, by: 'protocol', verify });
  const mdto: MeasurementDto = { id: m.id, index: 0, at: m.at, by: m.by, outcome: m.outcome, decayBefore: m.decayBefore, decayAfter: m.decayAfter, proofBundle: m.proofBundle as unknown as ProofBundle, precommitTx: null, proofTx: null, attestationKind: bundle.draw.attestation.kind };
  const dto: CoinDto = {
    ca: next.ca,
    name: next.name,
    ticker: next.ticker,
    image: next.image,
    lineageId: next.lineageId,
    generation: 1,
    motherCa: null,
    daughterCa: null,
    identityRoot: next.identityRoot,
    halfLifeSec: next.halfLifeSec,
    decayProgress: next.decayProgress,
    decayChannels: next.decayChannels.map((ch) => ({ id: ch.id, probabilityPpm: ch.probabilityPpm, label: ch.label, halfLifeSec: ch.daughterParams.halfLifeSec, poolUnits: { min: ch.daughterParams.poolUnits.min.toString(), max: ch.daughterParams.poolUnits.max.toString() } })),
    superposition: { supplyMin: next.superposition.supplyMin.toString(), supplyMax: next.superposition.supplyMax.toString() },
    supply: { totalUnits: next.supply.totalUnits.toString(), remainingUnits: next.supply.remainingUnits.toString(), decimals: 0 },
    state: next.state,
    lastActivityAt: next.lastActivityAt,
    bornAt: next.bornAt,
    collapsedAt: next.collapsedAt ?? null,
    launchPath: 'devnet-spl',
    launchTx: '5'.repeat(88),
    createdBy: null,
    measurements: [mdto],
    now: at + 1,
    holderCount: null,
    activity: 0,
    nextAutoMeasureAt: null,
  };
  return { dto, bundle: m.proofBundle as unknown as ProofBundle };
}

afterEach(() => {
  vi.unstubAllGlobals();
  walletState.publicKey = null;
  walletState.signMessage = undefined;
  delete process.env.NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS;
});

async function renderCoin(dto: CoinDto) {
  stubFetch((p) => (p === `/api/coin/${CA}` ? { body: dto } : { status: 503, body: DOWN }));
  const r = renderPage(<CoinView ca={CA} />);
  await waitFor(() => expect(r.container.querySelector('[data-measurement]')).not.toBeNull());
  return r;
}
const badgeOf = (container: HTMLElement) => container.querySelector('[data-measurement] [role="status"][data-status]')!;
async function clickVerify(r: { container: HTMLElement; getByText: (t: string) => HTMLElement }) {
  fireEvent.click(r.getByText(COIN.verifyButton));
  await waitFor(() => expect(['verified', 'invalid']).toContain(badgeOf(r.container).getAttribute('data-status')));
  return badgeOf(r.container);
}

describe('proof verification on /coin/[ca] (witness-signed, input-bound bundle; key published to the build)', () => {
  it('verifies in the browser with the published witness key and shows the honesty caption; the attestation kind is on the badge and in the rows', async () => {
    process.env.NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS = WITNESS.publicKey;
    const { dto } = await measured('witness');
    const r = await renderCoin(dto);
    expect(badgeOf(r.container).getAttribute('data-attestation')).toBe('witness-signed');
    expect(bodyText(r.container)).toContain('witness-signed');
    const badge = await clickVerify(r);
    expect(badge.getAttribute('data-status')).toBe('verified');
    expect(bodyText(r.container)).toContain(COIN.verifiedCaption);
    expect(bodyText(r.container)).toMatch(/ppb \(matches\)/);
  });

  it('a tampered bundle (outcome flipped) is invalid with the resolver’s reason', async () => {
    process.env.NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS = WITNESS.publicKey;
    const { dto } = await measured('witness');
    const b = dto.measurements[0]!.proofBundle as unknown as { outcome: { label: string; value: unknown } };
    const wasSurvive = b.outcome.label === 'survive';
    b.outcome = wasSurvive ? { label: 'collapse:fast', value: { kind: 'collapse', channelId: 'fast', poolUnits: '150' } } : { label: 'survive', value: { kind: 'survive' } };
    const r = await renderCoin(dto);
    const badge = await clickVerify(r);
    expect(badge.getAttribute('data-status')).toBe('invalid');
    expect(badge.getAttribute('aria-label')).toMatch(/outcome|resolver|does not match/);
  });

  it('a bundle signed by an unpublished witness key is invalid, not "self-consistent", not verified', async () => {
    process.env.NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS = OTHER_KEY;
    const { dto } = await measured('witness');
    const r = await renderCoin(dto);
    const badge = await clickVerify(r);
    expect(badge.getAttribute('data-status')).toBe('invalid');
    expect(badge.getAttribute('aria-label')).toMatch(/witness|trusted|key/i);
  });

  it('with no key published to the build the page says so and offers no verify button (only the download)', async () => {
    const { dto } = await measured('witness');
    const { container } = await renderCoin(dto);
    expect(bodyText(container)).toContain(COIN.verifyNoKeys);
    expect(badgeOf(container).getAttribute('data-status')).toBe('unverified');
    expect([...container.querySelectorAll('[data-measurement] button.qsd-btn')].map((b) => b.textContent)).toEqual([COIN.downloadBundle]);
  });
});

describe('UNSAFE_DEV_RANDOM bundle on the coin page', () => {
  it('renders invalid in the browser (the dev attestation carries no draw binding and the page requires one) with the kit’s warning on the badge', async () => {
    const { dto } = await measured('dev');
    const r = await renderCoin(dto);
    expect(badgeOf(r.container).getAttribute('data-attestation')).toBe('unsafe-dev');
    expect(badgeOf(r.container).getAttribute('aria-label')).toMatch(/dev randomness, not a quantum draw/);
    expect(bodyText(r.container)).toContain('UNSAFE_DEV_RANDOM');
    const badge = await clickVerify(r);
    expect(badge.getAttribute('data-status')).toBe('invalid');
    expect(badge.getAttribute('aria-label')).toMatch(/binding|bound/i);
  });

  it('LOW H-W4: CoinView passes allowUnsafeDev to verify() whenever the BUNDLE says kind=unsafe-dev — a verifier option taken from the data under verification; masked today by requireInputBinding (above), it must still be removed', () => {
    const src = readFileSync(path.resolve(__dirname, '../../apps/web/src/components/views/CoinView.tsx'), 'utf8');
    expect(src).toMatch(/requireInputBinding: true/);
    expect(src).not.toMatch(/allowUnsafeDev: true/);
  });
});

describe('measure button', () => {
  it('with a wallet and a configured protocol it states the reward and the risk from protocol constants and the live decay', async () => {
    const { dto } = await measured('witness');
    walletState.publicKey = { toBase58: () => '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' };
    walletState.signMessage = async (m) => m;
    stubFetch((p) =>
      p === `/api/coin/${CA}`
        ? { body: dto }
        : p.startsWith('/api/stats')
          ? { body: { counters: { superposed: 1, measurementsToday: 1, collapses: 0, daughters: 0, tunnels: 0, qsdBurned: '0' }, nextBurnAt: null, health: { db: true, redis: true, qrng: { configured: true, providerId: 'anu-quantum-numbers', reason: null }, chain: { configured: true, cluster: 'devnet', reason: null } }, now: 1 } }
          : { status: 503, body: DOWN },
    );
    const { container } = renderPage(<CoinView ca={CA} />);
    await waitFor(() => expect(bodyText(container)).toMatch(/if it collapses you receive/));
    // 1 % of 1 000 000 remaining = 10 000 removed; 20 % of that = 2 000 to the measurer = 0.20 % of remaining supply
    expect(bodyText(container)).toMatch(/if it collapses you receive 2,000 PHO \(0\.20% of remaining supply\)/);
    expect(bodyText(container)).toMatch(/current collapse probability: \d+\.\d%/);
  });

  it('without the QRNG provider configured the button is disabled with the no-fallback sentence and the server reason', async () => {
    const { dto } = await measured('witness');
    walletState.publicKey = { toBase58: () => '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' };
    walletState.signMessage = async (m) => m;
    stubFetch((p) =>
      p === `/api/coin/${CA}`
        ? { body: dto }
        : p.startsWith('/api/stats')
          ? { body: { counters: { superposed: 1, measurementsToday: 1, collapses: 0, daughters: 0, tunnels: 0, qsdBurned: '0' }, nextBurnAt: null, health: { db: true, redis: true, qrng: { configured: false, providerId: null, reason: 'QSD_QRNG_API_KEY is unset' }, chain: { configured: true, cluster: 'devnet', reason: null } }, now: 1 } }
          : { status: 503, body: DOWN },
    );
    const { container } = renderPage(<CoinView ca={CA} />);
    await waitFor(() => expect(bodyText(container)).toContain('QSD_QRNG_API_KEY is unset'));
    expect(container.querySelector('[data-measurement]')).not.toBeNull();
  });
});
