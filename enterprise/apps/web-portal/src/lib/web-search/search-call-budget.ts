/** Tenant-configurable provider-call budget for one ordinary web-search turn. */

export const DEFAULT_MAX_SEARCH_CALLS = 3;
export const MIN_MAX_SEARCH_CALLS = 1;
export const MAX_MAX_SEARCH_CALLS = 5;

export function isValidMaxSearchCalls(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_MAX_SEARCH_CALLS &&
    value <= MAX_MAX_SEARCH_CALLS
  );
}

/**
 * Runtime reads are fail-safe: legacy/missing/corrupt values retain the stable
 * default instead of silently widening the number of paid provider calls.
 */
export function normalizeMaxSearchCalls(value: unknown): number {
  return isValidMaxSearchCalls(value) ? value : DEFAULT_MAX_SEARCH_CALLS;
}
