import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { publish } from './redis';
import type { LogEntryDto } from '@/lib/types';

export type LogType = 'launch' | 'measurement' | 'collapse' | 'collapse-pending' | 'tunnel' | 'daughter' | 'airdrop' | 'burn' | 'trade' | 'survive';

/** Write an EventLog row and publish it to the live stream. */
export async function logEvent(e: { type: LogType; at?: Date; coinCa?: string; refId?: string; tx?: string; summary: string; data?: unknown }): Promise<LogEntryDto> {
  const row = await db().eventLog.create({
    data: {
      type: e.type,
      at: e.at ?? new Date(),
      coinCa: e.coinCa ?? null,
      refId: e.refId ?? null,
      tx: e.tx ?? null,
      summary: e.summary,
      ...(e.data !== undefined ? { data: e.data as Prisma.InputJsonValue } : {}),
    },
  });
  const entry: LogEntryDto = { id: row.id, type: row.type, at: row.at.toISOString(), coinCa: row.coinCa, refId: row.refId, tx: row.tx, summary: row.summary };
  await publish({ type: 'log', entry });
  await publish({ type: 'stats' });
  return entry;
}
