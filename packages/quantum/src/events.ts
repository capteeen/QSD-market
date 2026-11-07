import { nowIso } from './encoding.js';
import type { DrawObserver, QuantumEvent, QuantumEventBody, QuantumListener } from './types.js';

/**
 * Ordered event bus. Every emit gets a monotonic `seq` and a timestamp.
 * Listeners are called synchronously in subscription order; a throwing
 * listener does not stop the others.
 */
export class QuantumEventBus implements DrawObserver {
  private listeners = new Set<QuantumListener>();
  private nextSeq = 0;

  subscribe(listener: QuantumListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(body: QuantumEventBody): QuantumEvent {
    const event = { ...body, seq: this.nextSeq++, at: nowIso() } as QuantumEvent;
    for (const l of Array.from(this.listeners)) {
      try {
        l(event);
      } catch {
        // A misbehaving listener must not break the measurement.
      }
    }
    return event;
  }

  get seq(): number {
    return this.nextSeq;
  }
}

export interface EventRecording {
  /** Live array; events are appended as they arrive. */
  readonly events: QuantumEvent[];
  /** Stop recording. */
  stop(): void;
}

/** Subscribe and collect events into an array; useful for tests and replay. */
export function recordEvents(bus: Pick<QuantumEventBus, 'subscribe'>): EventRecording {
  const events: QuantumEvent[] = [];
  const stop = bus.subscribe((e) => {
    events.push(e);
  });
  return { events, stop };
}
