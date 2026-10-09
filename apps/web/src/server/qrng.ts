import 'server-only';
import { createProviderFromEnv, createQrngClient, QuantumEventBus, type QrngClient, type QrngProvider } from '@qsd/quantum';

/**
 * The QRNG provider from env. No fallback exists: if construction fails the
 * reason is reported and measurement is unavailable.
 */
const g = globalThis as unknown as { __qsdQrng?: { provider?: QrngProvider; error?: string } };

function init(): { provider?: QrngProvider; error?: string } {
  if (!g.__qsdQrng) {
    try {
      g.__qsdQrng = { provider: createProviderFromEnv() };
    } catch (e) {
      g.__qsdQrng = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return g.__qsdQrng;
}

export function qrngStatus(): { configured: boolean; providerId: string | null; reason: string | null } {
  const s = init();
  if (s.provider) return { configured: true, providerId: s.provider.id, reason: null };
  return { configured: false, providerId: null, reason: s.error ?? null };
}

/** A client with its own event bus (one bus per operation keeps `seq` per draw). */
export function qrngClient(bus?: QuantumEventBus): QrngClient {
  const s = init();
  if (!s.provider) throw new Error(`the quantum random number provider is not configured: ${s.error ?? 'unknown'}`);
  return createQrngClient(bus ? { provider: s.provider, bus } : { provider: s.provider });
}

/** One byte from the provider, to prove it answers (launch preflight). Throws with the provider's reason. */
export async function qrngProbe(): Promise<void> {
  const s = init();
  if (!s.provider) throw new Error(`not configured: ${s.error ?? 'unknown'}`);
  await s.provider.draw(1);
}
