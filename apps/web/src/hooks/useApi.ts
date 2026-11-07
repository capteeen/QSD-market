'use client';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet, type ApiResult } from '@/lib/api';
import type { BurnsResponse, CoinDto, CoinsResponse, HoldersResponse, HowResponse, LaunchQuoteResponse, LineageResponse, LogResponse, MeResponse, StatsResponse } from '@/lib/types';

/**
 * One hook per endpoint. Each resolves to the payload or `{ unavailable }`;
 * the query never errors on a 503, so a page can render the honest state.
 */
export function useStats(): UseQueryResult<ApiResult<StatsResponse>> {
  return useQuery({ queryKey: ['stats'], queryFn: () => apiGet<StatsResponse>('/api/stats'), refetchInterval: 30_000 });
}
export function useLog(limit = 100): UseQueryResult<ApiResult<LogResponse>> {
  return useQuery({ queryKey: ['log', limit], queryFn: () => apiGet<LogResponse>(`/api/log?limit=${limit}`) });
}
export function useCoins(): UseQueryResult<ApiResult<CoinsResponse>> {
  return useQuery({ queryKey: ['coins'], queryFn: () => apiGet<CoinsResponse>('/api/coins'), refetchInterval: 60_000 });
}
export function useCoin(ca: string): UseQueryResult<ApiResult<CoinDto>> {
  return useQuery({ queryKey: ['coin', ca], queryFn: () => apiGet<CoinDto>(`/api/coin/${encodeURIComponent(ca)}`) });
}
export function useHolders(ca: string, enabled = true): UseQueryResult<ApiResult<HoldersResponse>> {
  return useQuery({ queryKey: ['coin', ca, 'holders'], queryFn: () => apiGet<HoldersResponse>(`/api/coin/${encodeURIComponent(ca)}/holders`), enabled });
}
export function useLineage(id: string): UseQueryResult<ApiResult<LineageResponse>> {
  return useQuery({ queryKey: ['lineage', id], queryFn: () => apiGet<LineageResponse>(`/api/lineage/${encodeURIComponent(id)}`) });
}
export function useBurns(): UseQueryResult<ApiResult<BurnsResponse>> {
  return useQuery({ queryKey: ['burns'], queryFn: () => apiGet<BurnsResponse>('/api/burns') });
}
export function useMe(wallet: string | null): UseQueryResult<ApiResult<MeResponse>> {
  return useQuery({ queryKey: ['me', wallet], queryFn: () => apiGet<MeResponse>(`/api/me?wallet=${encodeURIComponent(wallet ?? '')}`), enabled: !!wallet });
}
export function useHow(): UseQueryResult<ApiResult<HowResponse>> {
  return useQuery({ queryKey: ['how'], queryFn: () => apiGet<HowResponse>('/api/how'), staleTime: Infinity });
}
export function useLaunchQuote(): UseQueryResult<ApiResult<LaunchQuoteResponse>> {
  return useQuery({ queryKey: ['launch-quote'], queryFn: () => apiGet<LaunchQuoteResponse>('/api/launch/quote') });
}
