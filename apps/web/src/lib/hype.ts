/** Parse a HYPE amount typed on the launch form into wei. Blank is not an amount. */

const MAX_DEV_BUY_WEI = 100n * 10n ** 18n;

/** A decimal token amount in base units. Empty input is null. No upper cap: a trade is not a first buy. */
export function parseAmountWei(raw: string, decimals = 18): bigint | null {
  const v = raw.trim();
  if (!v) return null;
  if (!new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`).test(v)) throw new Error('enter a number');
  const [whole = '0', frac = ''] = v.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals));
}

export function parseHypeToWei(raw: string): bigint | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\d+(\.\d{0,18})?$/.test(v)) throw new Error('first buy must be a HYPE amount');
  const [whole = '0', frac = ''] = v.split('.');
  const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18));
  if (wei > MAX_DEV_BUY_WEI) throw new Error('first buy must be a number of HYPE between 0 and 100');
  return wei;
}
