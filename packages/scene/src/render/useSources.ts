/**
 * Wire real observables into the store. Subscriptions are the ONLY way events
 * enter the scene; unsubscribing on unmount means a stale scene cannot be
 * driven by a later operation.
 */
import { useEffect } from 'react';
import type { CryptoEvent } from '@qsd/crypto';
import type { QuantumEvent } from '@qsd/quantum';
import type { SceneStore } from '../model/store.js';
import type { ChainEvent, LineageInput, Observable, SuperpositionInput } from '../model/types.js';

export interface SceneSources {
  crypto?: Observable<CryptoEvent>;
  quantum?: Observable<QuantumEvent>;
  chain?: Observable<ChainEvent>;
  superposition?: SuperpositionInput;
  lineage?: LineageInput;
}

export function useSources(store: SceneStore, sources: SceneSources): void {
  const { crypto, quantum, chain, superposition, lineage } = sources;

  useEffect(() => (crypto ? store.connect(crypto) : undefined), [store, crypto]);
  useEffect(() => (quantum ? store.connect(quantum) : undefined), [store, quantum]);
  useEffect(() => (chain ? store.connect(chain) : undefined), [store, chain]);
  useEffect(() => {
    if (superposition) store.dispatch({ type: 'superposition', input: superposition });
  }, [store, superposition]);
  useEffect(() => {
    if (lineage) store.dispatch({ type: 'lineage', input: lineage });
  }, [store, lineage]);
}
