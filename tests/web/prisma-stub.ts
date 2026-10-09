/**
 * Agent H — `@prisma/client` is aliased to this module in tests/vitest.config.ts:
 * the generated client does not exist in this sandbox (no `prisma generate`,
 * no database), and every server test runs the app's real modules against
 * the in-memory stand-in in ./fakeDb.ts instead.
 */
export { SharedFakePrismaClient as PrismaClient } from './fakeDb';
