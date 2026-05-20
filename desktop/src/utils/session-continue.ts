/** Unified session continuation API (POST /api/sessions/{id}/continue). */

export type ContinueReason = "stall" | "interrupted" | "exhausted" | "rate_limit" | "manual";
export type ContinueSource = "desktop_manual" | "desktop_auto_nudge" | "supervisor";

export type ContinueRequestBody = {
  reason: ContinueReason;
  source: ContinueSource;
  suppress_user_echo?: boolean;
};

export function continueSessionUrl(apiBase: string, sessionId: string): string {
  const base = apiBase.replace(/\/$/, "");
  return `${base}/api/sessions/${encodeURIComponent(sessionId)}/continue`;
}

export function inferContinueReason(args: {
  stallState: "none" | "stall" | "exhausted";
  executionState: string;
}): ContinueReason {
  if (args.stallState === "exhausted") return "exhausted";
  if (args.executionState === "interrupted") return "interrupted";
  if (args.stallState === "stall") return "stall";
  return "manual";
}
