/**
 * Client fetch helper. A 503 with `{ unavailable }` is returned as a value,
 * never thrown, so pages render the honest unavailable state; other failures
 * become `{ unavailable: { reason } }` too, with the HTTP status or the
 * network error as the reason.
 */
import { isUnavailable, type Unavailable } from './types';

export type ApiResult<T> = T | Unavailable;

export async function apiGet<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store' });
  } catch (e) {
    return { unavailable: { reason: `network error: ${e instanceof Error ? e.message : String(e)}` } };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { unavailable: { reason: `HTTP ${res.status} with a non-JSON body` } };
  }
  if (isUnavailable(body)) return body;
  if (!res.ok) {
    const msg = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
    return { unavailable: { reason: msg } };
  }
  return body as T;
}

export async function apiPost<T>(path: string, data: unknown): Promise<ApiResult<T>> {
  return apiGet<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
}

export { isUnavailable };
