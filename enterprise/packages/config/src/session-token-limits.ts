export type SessionTokenLimits = {
  /** First (yellow) alert. */
  warningTokensPerSession: number;
  /** Wire-compatible name for the second (red) alert; this is not a blocking cap. */
  maxTokensPerSession: number;
};

export const DEFAULT_SESSION_TOKEN_LIMITS: SessionTokenLimits = {
  warningTokensPerSession: 500_000,
  maxTokensPerSession: 1_000_000,
};

export const MIN_SESSION_WARNING_TOKENS = 50_000;
export const MIN_SESSION_MAX_TOKENS = 100_000;
export const MAX_SESSION_TOKENS = 5_000_000;

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

/** Strict request validation for the ordered yellow/red alert pair. */
export function isValidSessionTokenLimits(value: unknown): value is SessionTokenLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    isIntegerInRange(
      row.warningTokensPerSession,
      MIN_SESSION_WARNING_TOKENS,
      MAX_SESSION_TOKENS - 1,
    ) &&
    isIntegerInRange(
      row.maxTokensPerSession,
      MIN_SESSION_MAX_TOKENS,
      MAX_SESSION_TOKENS,
    ) &&
    row.warningTokensPerSession < row.maxTokensPerSession
  );
}

/**
 * Normalize a missing or malformed stored policy to the current enterprise
 * defaults. This is default resolution, not a migration of local Desktop data.
 */
export function normalizeSessionTokenLimits(value: unknown): SessionTokenLimits {
  if (!isValidSessionTokenLimits(value)) return { ...DEFAULT_SESSION_TOKEN_LIMITS };
  return {
    warningTokensPerSession: value.warningTokensPerSession,
    maxTokensPerSession: value.maxTokensPerSession,
  };
}
