/**
 * Pure helpers for the generic action-confirmation HITL primitive.
 *
 * Transport reuses clarification_required / POST /api/clarify, but product
 * semantics and UI types stay independent via context.kind = "action_confirmation".
 */

export type ActionConfirmationDecision = "approved" | "rejected";

export type ActionConfirmationStatus =
  | "pending"
  | "resolving"
  | "approved"
  | "rejected"
  | "expired"
  | "uncertain";

export type ActionConfirmationSummaryRow = {
  label: string;
  value: string;
};

export type PendingActionConfirmation = {
  requestId: string;
  sessionId: string;
  agentId: string;
  title: string;
  summary: ActionConfirmationSummaryRow[];
  approveLabel: string;
  rejectLabel: string;
  source?: string;
  expiresAtMs?: number;
  status: ActionConfirmationStatus;
  error?: string;
};

const APPROVE_PHRASES = new Set([
  "确认",
  "确认发送",
  "同意",
  "继续",
  "yes",
  "y",
  "ok",
]);

const REJECT_PHRASES = new Set(["取消", "拒绝", "不用了", "no", "n"]);

const MAX_SUMMARY_ROWS = 12;
const MAX_LABEL_LEN = 40;
const MAX_VALUE_LEN = 1000;
const MAX_TITLE_LEN = 200;
const MAX_BUTTON_LABEL_LEN = 20;

function clampText(raw: unknown, max: number): string {
  return String(raw ?? "")
    .trim()
    .slice(0, max);
}

function normalizeSummary(raw: unknown): ActionConfirmationSummaryRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionConfirmationSummaryRow[] = [];
  for (const item of raw) {
    if (out.length >= MAX_SUMMARY_ROWS) break;
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = clampText(rec.label, MAX_LABEL_LEN);
    const value = clampText(rec.value, MAX_VALUE_LEN);
    if (!label || !value) continue;
    out.push({ label, value });
  }
  return out;
}

/**
 * Parse structured clarification context into a PendingActionConfirmation.
 * Returns null when the payload is not a valid action confirmation.
 */
export function parseActionConfirmationContext(args: {
  requestId: string;
  sessionId: string;
  agentId?: string;
  context: unknown;
  status?: ActionConfirmationStatus;
}): PendingActionConfirmation | null {
  const requestId = String(args.requestId ?? "").trim();
  const sessionId = String(args.sessionId ?? "").trim();
  if (!requestId || !sessionId) return null;
  if (!args.context || typeof args.context !== "object") return null;
  const ctx = args.context as Record<string, unknown>;
  if (String(ctx.kind ?? "").trim() !== "action_confirmation") return null;

  const title = clampText(ctx.title, MAX_TITLE_LEN);
  if (!title) return null;

  const approveLabel =
    clampText(ctx.approve_label ?? ctx.approveLabel, MAX_BUTTON_LABEL_LEN) || "确认执行";
  const rejectLabel =
    clampText(ctx.reject_label ?? ctx.rejectLabel, MAX_BUTTON_LABEL_LEN) || "取消";
  const sourceRaw = clampText(ctx.source, 80);
  const expiresRaw = ctx.expires_at_ms ?? ctx.expiresAtMs;
  let expiresAtMs: number | undefined;
  if (typeof expiresRaw === "number" && Number.isFinite(expiresRaw) && expiresRaw > 0) {
    expiresAtMs = Math.floor(expiresRaw);
  } else if (typeof expiresRaw === "string" && expiresRaw.trim()) {
    const n = Number(expiresRaw);
    if (Number.isFinite(n) && n > 0) expiresAtMs = Math.floor(n);
  }

  const status = args.status ?? "pending";
  return {
    requestId,
    sessionId,
    agentId: String(args.agentId ?? "meta").trim() || "meta",
    title,
    summary: normalizeSummary(ctx.summary),
    approveLabel,
    rejectLabel,
    ...(sourceRaw ? { source: sourceRaw } : {}),
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
    status,
  };
}

/** Exact-message phrase match (trim + English case-insensitive). */
export function matchActionConfirmationReply(
  text: string,
): ActionConfirmationDecision | null {
  const normalized = String(text ?? "").trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (APPROVE_PHRASES.has(normalized) || APPROVE_PHRASES.has(lower)) return "approved";
  if (REJECT_PHRASES.has(normalized) || REJECT_PHRASES.has(lower)) return "rejected";
  return null;
}

export function isActionConfirmationExpired(
  confirmation: Pick<PendingActionConfirmation, "expiresAtMs" | "status">,
  nowMs: number = Date.now(),
): boolean {
  if (confirmation.status === "expired") return true;
  if (
    typeof confirmation.expiresAtMs === "number" &&
    Number.isFinite(confirmation.expiresAtMs) &&
    confirmation.expiresAtMs > 0 &&
    confirmation.expiresAtMs <= nowMs
  ) {
    return true;
  }
  return false;
}

export type FindResolvableActionConfirmationResult =
  | { kind: "hit"; confirmation: PendingActionConfirmation }
  | { kind: "ambiguous" }
  | { kind: "none" }
  | { kind: "expired"; confirmation: PendingActionConfirmation };

/**
 * Find a single pending action confirmation for the current pane session that
 * can be resolved by a manual approve/reject phrase.
 */
export function findResolvableActionConfirmation(args: {
  messages: Array<{
    actionConfirmation?: PendingActionConfirmation;
    ownerSessionId?: string;
  }>;
  paneSessionId: string;
  nowMs?: number;
}): FindResolvableActionConfirmationResult {
  const paneSessionId = String(args.paneSessionId ?? "").trim();
  if (!paneSessionId) return { kind: "none" };
  const nowMs = args.nowMs ?? Date.now();

  const pending: PendingActionConfirmation[] = [];
  for (const msg of args.messages) {
    const c = msg.actionConfirmation;
    if (!c || c.status !== "pending") continue;
    if (String(c.sessionId ?? "").trim() !== paneSessionId) continue;
    const owner = String(msg.ownerSessionId ?? "").trim();
    if (owner && owner !== paneSessionId) continue;
    pending.push(c);
  }

  if (pending.length === 0) return { kind: "none" };
  if (pending.length > 1) return { kind: "ambiguous" };

  const only = pending[0]!;
  if (isActionConfirmationExpired(only, nowMs)) {
    return { kind: "expired", confirmation: only };
  }
  return { kind: "hit", confirmation: only };
}

/** Build clarify-gate answer payload for POST /api/clarify. */
export function buildActionConfirmationAnswer(
  confirmation: Pick<PendingActionConfirmation, "approveLabel" | "rejectLabel">,
  decision: ActionConfirmationDecision,
): { answerText: string; selectedOptions: string[] } {
  const label =
    decision === "approved" ? confirmation.approveLabel : confirmation.rejectLabel;
  return {
    answerText: "",
    selectedOptions: [label],
  };
}

export function remainingActionConfirmationMs(
  confirmation: Pick<PendingActionConfirmation, "expiresAtMs">,
  nowMs: number = Date.now(),
): number | null {
  if (
    typeof confirmation.expiresAtMs !== "number" ||
    !Number.isFinite(confirmation.expiresAtMs) ||
    confirmation.expiresAtMs <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.floor(confirmation.expiresAtMs - nowMs));
}

export function formatActionConfirmationCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
