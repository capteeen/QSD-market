/** Parse a HYPE amount typed on the launch form into wei. Blank is not an amount. */

const MAX_DEV_BUY_WEI = 100n * 10n ** 18n;

export function parseHypeToWei(raw: string): bigint | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\d+(\.\d{0,18})?$/.test(v)) throw new Error('dev buy must be a HYPE amount');
  const [whole, frac = ''] = v.split('.');
  const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18));
  if (wei > MAX_DEV_BUY_WEI) throw new Error('dev buy must be a number of HYPE between 0 and 100');
  return wei;
}
