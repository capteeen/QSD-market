import 'server-only';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton. Constructing the client does not connect; the first query
 * does. Nothing here runs at build time.
 */
const globalForPrisma = globalThis as unknown as { __qsdPrisma?: PrismaClient };

export function db(): PrismaClient {
  if (!globalForPrisma.__qsdPrisma) {
    globalForPrisma.__qsdPrisma = new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
  }
  return globalForPrisma.__qsdPrisma;
}

/** True for connection-level failures (unreachable, auth, missing tables), not for data errors. */
export function isDbUnavailable(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const name = e.constructor?.name ?? '';
  if (name === 'PrismaClientInitializationError' || name === 'PrismaClientRustPanicError') return true;
  const code = (e as { code?: string }).code;
  if (code && /^P(1\d{3}|2021|2022)$/.test(code)) return true;
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|Can't reach database|DATABASE_URL|does not exist in the current database/i.test(e.message);
}

export function dbUnavailableReason(e: unknown): string {
  if (!process.env.DATABASE_URL) return 'the database is not configured (DATABASE_URL is unset)';
  const msg = e instanceof Error ? e.message.split('\n')[0] ?? '' : String(e);
  return `the database is not reachable (${msg.slice(0, 160)})`;
}
