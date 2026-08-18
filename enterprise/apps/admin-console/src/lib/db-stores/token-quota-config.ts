export type VersionedQuotaConfig = {
  updatedAt: string;
};

export type QuotaConfigPatch<T extends VersionedQuotaConfig> = Partial<T>;

const PATCHABLE_KEYS = [
  "defaults",
  "users",
  "departments",
  "groups",
  "modelExclusions",
  "apiTokens",
] as const;

export class QuotaConfigConflictError extends Error {
  constructor() {
    super("quota config was updated by another request");
    this.name = "QuotaConfigConflictError";
  }
}

export function mergeQuotaConfigPatch<T extends VersionedQuotaConfig>(
  current: T,
  patch: QuotaConfigPatch<T>,
): Partial<T> {
  const merged: Partial<T> = { ...current };
  for (const key of PATCHABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      Object.assign(merged, { [key]: patch[key as keyof T] });
    }
  }
  return merged;
}

export function requestedQuotaVersion<T extends VersionedQuotaConfig>(
  input: QuotaConfigPatch<T>,
  expectedUpdatedAt?: string,
): Date | undefined {
  const raw = expectedUpdatedAt ?? input.updatedAt;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function sameQuotaVersion(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

export function nextQuotaUpdatedAt(current: Date | undefined, now = new Date()): Date {
  if (!current || now.getTime() > current.getTime()) return now;
  return new Date(current.getTime() + 1);
}
