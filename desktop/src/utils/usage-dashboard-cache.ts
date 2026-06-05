import type { UsageDashboardPayload } from "../services/usageApi";
import type { TokenDashboardRange } from "../store";

const CACHE_KEY = "agx-usage-dashboard-cache-v1";

export type UsageDashboardCacheEntry = {
  savedAt: number;
  range: TokenDashboardRange;
  customFrom: string;
  customTo: string;
  payload: UsageDashboardPayload;
};

export function readUsageDashboardCache(): UsageDashboardCacheEntry | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UsageDashboardCacheEntry;
    if (!parsed?.payload?.summary) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeUsageDashboardCache(entry: UsageDashboardCacheEntry): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // quota / private mode — ignore
  }
}

export function usageDashboardCacheKey(
  range: TokenDashboardRange,
  customFrom: string,
  customTo: string,
): string {
  return `${range}|${customFrom.trim()}|${customTo.trim()}`;
}
