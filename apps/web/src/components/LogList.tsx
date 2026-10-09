'use client';
import { useLog } from '@/hooks/useApi';
import { LogTerminal } from './terminal/pages';

/** Every event, newest first, as a terminal tail, each with its coin, proof and explorer links. */
export function LogList({ limit = 100 }: { limit?: number }) {
  const q = useLog(limit);
  return <LogTerminal q={q} limit={limit} />;
}
