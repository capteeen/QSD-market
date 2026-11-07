import 'server-only';
import { remainingCount } from '@qsd/crypto';
import { db } from './db';
import { getChain } from './chain';

/** Refresh the display mirror of a coin's identity reserve entry (root, pubSeed, next index, used bitmap). */
export async function syncIdentityMirror(ca: string): Promise<void> {
  const chain = getChain();
  const entry = await chain.reserve.entry(ca);
  if (!entry) return;
  const state = await chain.reserve.stateStore.get(entry.identityRoot);
  const nextIndex = state?.nextIndex ?? 0;
  const usedBitmap = state?.used ?? '0'.repeat(64);
  const remaining = state ? remainingCount(state) : 256;
  await db().identity.upsert({
    where: { coinCa: ca },
    create: { coinCa: ca, root: entry.identityRoot, pubSeed: entry.pubSeed, nextIndex, usedBitmap, remaining },
    update: { nextIndex, usedBitmap, remaining },
  });
}
