'use client';
import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveStore } from '@/store/live';
import type { LiveEvent } from '@/lib/types';

/**
 * Subscribes to /api/events (SSE) and invalidates TanStack queries on each
 * event. The store records the connection status honestly: pages show "live"
 * only while the stream is open.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const setStatus = useLiveStore((s) => s.setStatus);
  const pushEvent = useLiveStore((s) => s.pushEvent);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.onopen = () => setStatus('open');
    es.onerror = () => setStatus('reconnecting');
    const handle = (e: MessageEvent<string>) => {
      let ev: LiveEvent;
      try {
        ev = JSON.parse(e.data) as LiveEvent;
      } catch {
        return;
      }
      pushEvent(ev);
      switch (ev.type) {
        case 'log':
          void qc.invalidateQueries({ queryKey: ['log'] });
          void qc.invalidateQueries({ queryKey: ['stats'] });
          break;
        case 'measurement':
          void qc.invalidateQueries({ queryKey: ['coin', ev.ca] });
          void qc.invalidateQueries({ queryKey: ['coins'] });
          void qc.invalidateQueries({ queryKey: ['lineage'] });
          break;
        case 'coin':
          void qc.invalidateQueries({ queryKey: ['coin', ev.ca] });
          void qc.invalidateQueries({ queryKey: ['coins'] });
          void qc.invalidateQueries({ queryKey: ['me'] });
          break;
        case 'stats':
          void qc.invalidateQueries({ queryKey: ['stats'] });
          break;
        case 'burn':
          void qc.invalidateQueries({ queryKey: ['burns'] });
          void qc.invalidateQueries({ queryKey: ['stats'] });
          break;
        default:
          break;
      }
    };
    for (const t of ['log', 'measurement', 'coin', 'stats', 'burn', 'heartbeat']) es.addEventListener(t, handle as EventListener);
    return () => {
      es.close();
      setStatus('closed');
    };
  }, [qc, setStatus, pushEvent]);
  return <>{children}</>;
}
