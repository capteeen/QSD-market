import 'server-only';
import type { CollapseJournalDoc } from '@qsd/solana';
import { getChain } from './chain';
import { db } from './db';
import { logEvent } from './events';
import { queue } from './queues';

/**
 * Reconciliation for H-W7: a collapse outcome hands the daughter launch to the
 * `collapse` queue, and `enqueue` cannot throw (the measurement is already
 * persisted). If the queue was unreachable at that moment, the mother sits in
 * state `collapsed` with no `daughterCa` and nothing would ever launch her
 * daughter. This job runs every few minutes from the worker and re-enqueues
 * every such coin whose collapse job is not currently waiting or running.
 */

const RUNNING_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

export interface ReconcileReport {
  checked: number;
  enqueued: string[];
  running: string[];
}

/** Collapsed coins without a daughter, oldest collapse first. */
export async function collapsedWithoutDaughter(): Promise<{ ca: string; ticker: string; collapsedAt: number | null }[]> {
  const rows = await db().coin.findMany({ where: { state: 'collapsed', daughterCa: null }, orderBy: { collapsedAt: 'asc' }, select: { ca: true, ticker: true, collapsedAt: true } });
  return rows;
}

export async function reconcileCollapses(log: (line: string) => void = console.log): Promise<ReconcileReport> {
  const pending = await collapsedWithoutDaughter();
  const report: ReconcileReport = { checked: pending.length, enqueued: [], running: [] };
  if (pending.length === 0) return report;
  const q = queue('collapse');
  const chain = getChain();
  for (const coin of pending) {
    const jobId = `collapse-${coin.ca}`;
    const job = await q.getJob(jobId);
    const state = job ? await job.getState() : 'absent';
    if (RUNNING_STATES.has(state)) {
      report.running.push(coin.ca);
      continue;
    }
    // A finished (completed without a daughter row, or failed-out) job keeps its id: remove it so a fresh one can be added.
    if (job) await job.remove();
    const journal = await chain.journal<CollapseJournalDoc>(`collapse-${coin.ca}`).load();
    await q.add('collapse', { ca: coin.ca }, { jobId, attempts: 50, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100, removeOnFail: 500 });
    report.enqueued.push(coin.ca);
    const summary = `${coin.ticker} collapsed with no daughter (collapse job was ${state}${journal ? ', journal present: resuming' : ''}); daughter launch re-scheduled`;
    log(`reconcile ${coin.ca}: ${summary}`);
    await logEvent({ type: 'collapse-pending', coinCa: coin.ca, summary, data: { previousJobState: state, journal: !!journal } });
  }
  return report;
}
