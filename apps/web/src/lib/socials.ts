/** Optional launch links. Blank stays blank. A handle or a bare host becomes an https URL. */

export type SocialKind = 'website' | 'x' | 'telegram';

export function normalizeSocial(kind: SocialKind, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length > 200) throw new Error(`${kind} must be at most 200 characters`);
  let candidate = v;
  if (kind === 'x' && /^@[A-Za-z0-9_]{1,15}$/.test(v)) candidate = `https://x.com/${v.slice(1)}`;
  else if (kind === 'telegram' && /^@[A-Za-z0-9_]{5,32}$/.test(v)) candidate = `https://t.me/${v.slice(1)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${kind} must be an https link`);
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.')) throw new Error(`${kind} must be an https link`);
  return url.toString();
}
