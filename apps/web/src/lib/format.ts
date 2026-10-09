/**
 * Formatting helpers. Every function takes a real value; none has a default
 * that would print a number for missing data.
 */

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatPpm(ppm: number, digits = 1): string {
  return `${(ppm / 10_000).toFixed(digits)}%`;
}

export function formatBps(bps: number, digits = 2): string {
  return `${(bps / 100).toFixed(digits)}%`;
}

/** Base units → UI amount with the mint's decimals, grouped, exact (bigint arithmetic). */
export function formatUnits(units: bigint, decimals: number, maxFraction = 2): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const wholeStr = whole.toLocaleString('en-US');
  if (decimals === 0 || maxFraction === 0) return `${neg ? '-' : ''}${wholeStr}`;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  return `${neg ? '-' : ''}${wholeStr}${fracStr ? `.${fracStr}` : ''}`;
}

export function formatLamports(lamports: bigint, maxFraction = 4): string {
  return `${formatUnits(lamports, 9, maxFraction)} SOL`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatHalfLife(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return formatDuration(seconds);
}

export function formatUnix(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function formatIso(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : formatUnix(Math.floor(t / 1000));
}

export function shortAddress(addr: string, head = 4, tail = 4): string {
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
