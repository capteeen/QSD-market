import type { OutcomeResolver } from '../src/index.js';

/**
 * A tiny deterministic resolver standing in for the protocol package's real
 * one. Uses the first 4 bytes as a big-endian u32 to pick survive/collapse and
 * a channel. Pure.
 */
export interface TestInputs {
  coin: string;
  decayProgress: number;
  channels: number[];
  [k: string]: string | number | number[];
}

export const testResolver: OutcomeResolver<TestInputs> = {
  id: 'test-resolver/v1',
  resolve(bytes, inputs) {
    if (bytes.length < 4) throw new Error('need >= 4 bytes');
    const u = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
    const x = u / 0x1_0000_0000;
    if (x >= inputs.decayProgress) {
      return { value: { kind: 'survive', x }, label: 'survive' };
    }
    const total = inputs.channels.reduce((a, b) => a + b, 0);
    let acc = 0;
    let idx = 0;
    const y = (x / inputs.decayProgress) * total;
    for (let i = 0; i < inputs.channels.length; i++) {
      acc += inputs.channels[i]!;
      if (y < acc) {
        idx = i;
        break;
      }
      idx = i;
    }
    return { value: { kind: 'collapse', channel: idx, x }, label: `collapse:channel-${idx}` };
  },
};

export const sampleInputs: TestInputs = {
  coin: 'So11111111111111111111111111111111111111112',
  decayProgress: 0.6,
  channels: [0.5, 0.3, 0.2],
};

export function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
}

export async function withNodeEnvAsync<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
}
