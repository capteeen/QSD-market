/**
 * BullMQ workers: `pnpm --filter web worker`.
 *
 *   ingest-trades  buys queued by the webhook when the database was unreachable
 *   auto-measure   every minute: measure every coin whose window elapsed (by = 'protocol')
 *   collapse       execute / resume a collapse (snapshot → rewards → daughter → allocation → airdrop)
 *   hourly-burn    cron at minute 0: tally fees, buy $QSD, burn
 *   snapshot       refresh a coin's identity-reserve mirror
 *
 * Every worker calls @qsd/solana, writes results to Prisma, and publishes to
 * Redis through the same server modules the route handlers use.
 */
import { Worker, Queue, type Job } from 'bullmq';
import { PROTOCOL_PARAMS } from '@qsd/protocol';
import { autoMeasureDue } from '@qsd/solana';
import { QUEUES, bullConnection, type JobData } from '../server/queues';
import { db } from '../server/db';
import { coinFromDb, coinInclude } from '../server/coins';
import { performMeasurement } from '../server/measure';
import { runCollapse } from '../server/collapse';
import { runHourlyBurn } from '../server/burn';
import { ingestBuy } from '../server/trades';
import { syncIdentityMirror } from '../server/identityMirror';
import { nowSeconds } from '../lib/format';

const log = (line: string): void => console.log(`[worker ${new Date().toISOString()}] ${line}`);

async function autoMeasure(): Promise<void> {
  const rows = await db().coin.findMany({ where: { state: { in: ['superposed', 'measured_alive', 'tunnelled'] } }, include: coinInclude });
  const due = autoMeasureDue(rows.map(coinFromDb), nowSeconds());
  for (const coin of due) {
    try {
      const r = await performMeasurement(coin.ca, PROTOCOL_PARAMS.AUTO_MEASURER_ID);
      log(`auto-measured ${coin.ca}: ${r.measurement.outcome.kind}`);
    } catch (e) {
      log(`auto-measure ${coin.ca} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function main(): Promise<void> {
  const connection = bullConnection();
  const workers: Worker[] = [];

  workers.push(
    new Worker<JobData['ingest-trades']>(
      QUEUES.ingestTrades,
      async (job: Job<JobData['ingest-trades']>) => {
        for (const b of job.data.buys) {
          await ingestBuy({
            mint: b.mint,
            buyer: b.buyer,
            lamports: BigInt(b.lamports),
            slot: b.slot,
            signature: b.signature,
            timestamp: b.timestamp,
            tokenUiAmount: b.tokenUiAmount,
            type: 'SWAP',
            ...(b.tokenUnits !== undefined ? { tokenUnits: BigInt(b.tokenUnits) } : {}),
            ...(b.source !== undefined ? { source: b.source } : {}),
          });
        }
      },
      { connection },
    ),
    new Worker<JobData['auto-measure']>(QUEUES.autoMeasure, autoMeasure, { connection, concurrency: 1 }),
    new Worker<JobData['collapse']>(QUEUES.collapse, async (job) => runCollapse(job.data.ca, log), { connection, concurrency: 1 }),
    new Worker<JobData['hourly-burn']>(QUEUES.hourlyBurn, async () => runHourlyBurn(log), { connection, concurrency: 1 }),
    new Worker<JobData['snapshot']>(QUEUES.snapshot, async (job) => syncIdentityMirror(job.data.ca), { connection }),
  );
  for (const w of workers) {
    w.on('failed', (job, err) => log(`${w.name} job ${job?.id ?? '?'} failed: ${err.message}`));
    w.on('completed', (job) => log(`${w.name} job ${job.id} done`));
  }

  // Repeatable jobs.
  const auto = new Queue(QUEUES.autoMeasure, { connection });
  await auto.add('tick', {}, { repeat: { every: 60_000 }, jobId: 'auto-measure-tick', removeOnComplete: 10, removeOnFail: 50 });
  if (process.env.QSD_TOKEN_MINT) {
    const burn = new Queue(QUEUES.hourlyBurn, { connection });
    await burn.add('hourly', {}, { repeat: { pattern: '0 * * * *' }, jobId: 'hourly-burn-cron', removeOnComplete: 10, removeOnFail: 50 });
  } else {
    log('QSD_TOKEN_MINT unset: the hourly burn is not scheduled');
  }
  log(`workers up: ${workers.map((w) => w.name).join(', ')}`);

  const shutdown = async (): Promise<void> => {
    log('shutting down');
    await Promise.all(workers.map((w) => w.close()));
    await db().$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
