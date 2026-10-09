import { describe, expect, it } from 'vitest';
import {
  createQrngClient,
  QuantumEventBus,
  recordEvents,
  UnsafeDevRandomProvider,
} from '../src/index.js';
import { sampleInputs, testResolver, withNodeEnv } from './helpers.js';

describe('events', () => {
  it('measure() emits the four events in order with monotonic seq and real values', async () => {
    const provider = withNodeEnv('test', () => new UnsafeDevRandomProvider());
    const client = createQrngClient({ provider });
    const rec = recordEvents(client);

    const { draw, bundle } = await client.measure(sampleInputs, testResolver);
    rec.stop();

    expect(rec.events.map((e) => e.type)).toEqual([
      'entropyRequested',
      'entropyArrived',
      'commitmentComputed',
      'outcomeResolved',
    ]);
    expect(rec.events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);

    const [req, arr, com, out] = rec.events;
    if (req?.type !== 'entropyRequested') throw new Error();
    expect(req.providerId).toBe('UNSAFE_DEV_RANDOM');
    expect(req.nBytes).toBe(32);
    expect(req.requestedAt).toBe(draw.requestedAt);

    if (arr?.type !== 'entropyArrived') throw new Error();
    expect(arr.bytes).toEqual(draw.bytes);
    expect(arr.attestation).toEqual(draw.attestation);

    if (com?.type !== 'commitmentComputed') throw new Error();
    expect(com.hash).toBe(draw.commitment);

    if (out?.type !== 'outcomeResolved') throw new Error();
    expect(out.value).toEqual(bundle.outcome.value);
    expect(out.outcomeLabel).toBe(bundle.outcome.label);

    for (let i = 1; i < rec.events.length; i++) {
      expect(Date.parse(rec.events[i]!.at)).toBeGreaterThanOrEqual(Date.parse(rec.events[i - 1]!.at));
    }
  });

  it('unsubscribe stops delivery and a throwing listener does not block others', () => {
    const bus = new QuantumEventBus();
    const seen: number[] = [];
    bus.subscribe(() => {
      throw new Error('bad listener');
    });
    const unsub = bus.subscribe((e) => seen.push(e.seq));
    bus.emit({ type: 'commitmentComputed', hash: 'aa' });
    unsub();
    bus.emit({ type: 'commitmentComputed', hash: 'bb' });
    expect(seen).toEqual([0]);
    expect(bus.seq).toBe(2);
  });

  it('a shared bus keeps a single seq across draws', async () => {
    const provider = withNodeEnv('test', () => new UnsafeDevRandomProvider());
    const bus = new QuantumEventBus();
    const client = createQrngClient({ provider, bus });
    const rec = recordEvents(bus);
    await client.draw(4);
    await client.draw(4);
    expect(rec.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
