'use client';
import { create } from 'zustand';
import type { LiveEvent } from '@/lib/types';
import type { LiveMeasurement, Observable } from '@qsd/scene/model';

export type LiveStatus = 'closed' | 'open' | 'reconnecting';

interface LiveState {
  status: LiveStatus;
  lastHeartbeat: string | null;
  recent: LiveEvent[];
  setStatus(s: LiveStatus): void;
  pushEvent(e: LiveEvent): void;
}

const listeners = new Set<(m: LiveMeasurement) => void>();

/** An observable of live measurements for the FieldScene (a vessel flashes on each). */
export const liveMeasurements: Observable<LiveMeasurement> = {
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useLiveStore = create<LiveState>((set) => ({
  status: 'closed',
  lastHeartbeat: null,
  recent: [],
  setStatus: (status) => set({ status }),
  pushEvent: (e) => {
    if (e.type === 'heartbeat') {
      set({ lastHeartbeat: e.at, status: 'open' });
      return;
    }
    if (e.type === 'measurement') for (const l of listeners) l({ ca: e.ca, at: new Date(e.at * 1000).toISOString(), outcomeLabel: e.outcome });
    set((s) => ({ recent: [e, ...s.recent].slice(0, 50) }));
  },
}));
