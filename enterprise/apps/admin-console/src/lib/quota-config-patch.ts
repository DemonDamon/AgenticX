/** Top-level quota fields a caller may replace without sending the rest of the document. */

export const QUOTA_PATCH_KEYS = ["defaults", "users", "departments", "apiTokens", "featureUsage"] as const;

export type QuotaPatchKey = (typeof QUOTA_PATCH_KEYS)[number];

export class QuotaConflictError extends Error {
  constructor() {
    super("quota config was updated by another request");
    this.name = "QuotaConflictError";
  }
}

export function mergeQuotaPatch<T extends Record<string, unknown>>(
  current: T | null | undefined,
  patch: Record<string, unknown>,
): T {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const key of QUOTA_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
  }
  return next as T;
}

export function asQuotaDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

export function sameQuotaVersion(expected: string, stored: unknown): boolean {
  const left = new Date(expected).getTime();
  const right = asQuotaDate(stored)?.getTime();
  return Number.isFinite(left) && right !== undefined && left === right;
}

export function nextQuotaUpdatedAt(current: Date | undefined, now = new Date()): Date {
  if (!current || now.getTime() > current.getTime()) return now;
  return new Date(current.getTime() + 1);
}
