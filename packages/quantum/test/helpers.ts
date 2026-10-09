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

type Vars = Record<string, string | undefined>;

function applyVars(vars: Vars): () => void {
  const prev: Vars = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return () => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  };
}

/** Run with process.env overrides (undefined deletes), restoring afterwards. */
export function withEnv<T>(vars: Vars, fn: () => T): T {
  const restore = applyVars(vars);
  try {
    return fn();
  } finally {
    restore();
  }
}

export async function withEnvAsync<T>(vars: Vars, fn: () => Promise<T>): Promise<T> {
  const restore = applyVars(vars);
  try {
    return await fn();
  } finally {
    restore();
  }
}

export function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
  return withEnv({ NODE_ENV: value }, fn);
}

export async function withNodeEnvAsync<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  return withEnvAsync({ NODE_ENV: value }, fn);
}
