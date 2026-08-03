export type QuotaSummarySlice = {
  remaining: number | null;
  unlimited: boolean;
};

export type QuotaSummarySnapshot = {
  daily?: QuotaSummarySlice | null;
  weekly?: QuotaSummarySlice | null;
  monthly?: QuotaSummarySlice | null;
  user?: QuotaSummarySlice | null;
  dept?: QuotaSummarySlice | null;
};

/** A finite quota is exhausted only when the server reports no remaining tokens. */
export function isQuotaExhausted(summary: QuotaSummarySnapshot | null | undefined): boolean {
  if (!summary) return false;
  return [summary.daily, summary.weekly, summary.monthly, summary.user, summary.dept].some(
    (slice) => Boolean(slice && !slice.unlimited && slice.remaining !== null && slice.remaining <= 0),
  );
}
