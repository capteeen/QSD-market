/**
 * ChainObserver: ordered events the scene subscribes to (stage 7, anchoring).
 * Same shape as the crypto/quantum observers: `subscribe(listener) => unsubscribe`,
 * monotonic `seq` per observer. Every event carries real chain values.
 */
export type AnchorKind = 'precommit' | 'proof' | 'allocation-root';

export type ChainEvent =
  | { type: 'anchorRequested'; seq: number; at: string; kind: AnchorKind; hash: string }
  | { type: 'anchored'; seq: number; at: string; kind: AnchorKind; hash: string; txSignature: string; cluster: string }
  | { type: 'airdropBatchSent'; seq: number; at: string; txSignature: string; wallets: string[]; units: string }
  | { type: 'airdropBatchConfirmed'; seq: number; at: string; txSignature: string; wallets: string[] }
  | { type: 'burnSent'; seq: number; at: string; txSignature: string; mint: string; units: string }
  | { type: 'daughterLaunched'; seq: number; at: string; ca: string; txSignature: string }
  | { type: 'collapseStep'; seq: number; at: string; step: string; status: 'started' | 'done' | 'skipped' };

export type ChainEventInput = ChainEvent extends infer E ? (E extends ChainEvent ? Omit<E, 'seq' | 'at'> : never) : never;
export type ChainListener = (e: ChainEvent) => void;

export class ChainObserver {
  private readonly listeners = new Set<ChainListener>();
  private _seq = 0;
  get seq(): number {
    return this._seq;
  }
  subscribe(listener: ChainListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(input: ChainEventInput): ChainEvent {
    const e = { ...input, seq: this._seq++, at: new Date().toISOString() } as ChainEvent;
    for (const l of this.listeners) l(e);
    return e;
  }
}

export function recordChainEvents(observer: ChainObserver): { events: ChainEvent[]; stop: () => void } {
  const events: ChainEvent[] = [];
  const stop = observer.subscribe((e) => events.push(e));
  return { events, stop };
}
