/**
 * Deep-research freezes the Gateway Bearer at request start. Long retrieve phases
 * can outlive the 1h access JWT; refresh in-place before synthesize so outline /
 * section writes do not all fail with Gateway 40100.
 */

export type RefreshAccessToken = () => Promise<{ accessToken: string } | null>;

/** Extra time past the orchestrator budget, clarify wait, and plan-gate allowance. */
export const RESEARCH_AUTH_HEADROOM_MS = 5 * 60_000;

/**
 * Plan-chat waits without a timeout. Bearer lifetime still reserves a bounded
 * plan-gate window so a refresh is required before a long continue.
 */
export const RESEARCH_PLAN_GATE_WAIT_MS = 60_000;

export function requiredResearchBearerLifetimeMs(
  totalBudgetMs: number,
  clarifyWaitMs: number,
  planGateWaitMs = RESEARCH_PLAN_GATE_WAIT_MS,
): number {
  return totalBudgetMs + clarifyWaitMs + planGateWaitMs + RESEARCH_AUTH_HEADROOM_MS;
}

function accessExpSeconds(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const exp = (value as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** True only when the unverified JWT `exp` is strictly beyond `requiredRemainingMs`. */
export function hasGatewayBearerLifetime(
  token: string,
  requiredRemainingMs: number,
  nowMs = Date.now(),
): boolean {
  const exp = accessExpSeconds(token);
  return (
    exp !== null &&
    Number.isFinite(requiredRemainingMs) &&
    requiredRemainingMs >= 0 &&
    exp * 1000 > nowMs + requiredRemainingMs
  );
}

/** Mutates `headers.authorization` when refresh succeeds. Returns whether it updated. */
export async function refreshGatewayBearer(args: {
  headers: Record<string, string>;
  refreshAccessToken: RefreshAccessToken;
}): Promise<boolean> {
  try {
    const next = await args.refreshAccessToken();
    const token = next?.accessToken?.trim();
    if (!token) return false;
    args.headers.authorization = `Bearer ${token}`;
    return true;
  } catch {
    return false;
  }
}
