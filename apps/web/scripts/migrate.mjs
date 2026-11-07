// Applies Prisma migrations before `next build` when a database is configured.
// No DATABASE_URL → skip (the site still builds and shows "not available").
// Migrations use the direct (unpooled) connection when the host provides one:
// Neon on Vercel sets DATABASE_URL_UNPOOLED, Vercel Postgres sets POSTGRES_URL_NON_POOLING.
import { spawnSync } from 'node:child_process';

const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!process.env.DATABASE_URL) {
  console.log('[migrate] DATABASE_URL is unset: skipping migrations');
  process.exit(0);
}
if (process.env.QSD_SKIP_MIGRATE === '1') {
  console.log('[migrate] QSD_SKIP_MIGRATE=1: skipping migrations');
  process.exit(0);
}
const r = spawnSync('prisma', ['migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: direct },
});
process.exit(r.status ?? 1);
