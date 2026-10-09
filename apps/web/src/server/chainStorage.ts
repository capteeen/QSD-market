import 'server-only';
import { Prisma } from '@prisma/client';
import { kvChainStorage, type ChainStorage, type KvRecord, type KvStore } from '@qsd/solana';
import { db } from './db';

/**
 * The chain layer's keys, identity state and journals in Postgres (table ChainKv),
 * so launches and collapses survive redeploys on hosts without a persistent disk.
 * Each operation is a single statement; `cas` is a conditional insert or update.
 */
export class PrismaKvStore implements KvStore {
  async get(key: string): Promise<KvRecord | undefined> {
    const row = await db().chainKv.findUnique({ where: { key }, select: { value: true, version: true } });
    return row ?? undefined;
  }

  async put(key: string, value: string): Promise<void> {
    await db().chainKv.upsert({ where: { key }, create: { key, value, version: 1 }, update: { value, version: { increment: 1 } } });
  }

  async cas(key: string, value: string, expectedVersion: number): Promise<boolean> {
    if (expectedVersion === 0) {
      try {
        await db().chainKv.create({ data: { key, value, version: 1 } });
        return true;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false; // someone created it first
        throw e;
      }
    }
    const { count } = await db().chainKv.updateMany({ where: { key, version: expectedVersion }, data: { value, version: expectedVersion + 1 } });
    return count === 1;
  }

  async delete(key: string): Promise<void> {
    await db().chainKv.deleteMany({ where: { key } });
  }

  async list(prefix: string): Promise<string[]> {
    const rows = await db().chainKv.findMany({ where: { key: { startsWith: prefix } }, select: { key: true }, orderBy: { key: 'asc' } });
    return rows.map((r) => r.key);
  }
}

/** Database storage unless QSD_KEYSTORE_PATH asks for files (a host with a persistent disk). */
export function chainStorageFromEnv(env: Record<string, string | undefined> = process.env): ChainStorage | undefined {
  return env.QSD_KEYSTORE_PATH?.trim() ? undefined : kvChainStorage(new PrismaKvStore());
}
