import type { Message } from "../store";

export type BudgetExceededInfo = {
  source: string;
  current: number;
  maxAllowed: number;
  sessionId?: string;
};

const BUDGET_EXCEEDED_RE =
  /Token budget exceeded\s*\((\d+)\/(\d+),\s*source=([^)]+)\)/i;

export function parseBudgetExceededFromText(text: string): BudgetExceededInfo | null {
  const match = String(text ?? "").match(BUDGET_EXCEEDED_RE);
  if (!match) return null;
  const current = Number(match[1]);
  const maxAllowed = Number(match[2]);
  const source = String(match[3] ?? "session").trim() || "session";
  if (!Number.isFinite(current) || !Number.isFinite(maxAllowed)) return null;
  return { source, current, maxAllowed };
}

export function isBudgetExceededErrorPayload(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  if (data.budget_exceeded === true) return true;
  return String(data.detector ?? "").trim() === "token_budget";
}

export function budgetExceededInfoFromPayload(
  data: Record<string, unknown> | undefined,
): BudgetExceededInfo | null {
  if (!isBudgetExceededErrorPayload(data)) return null;
  const current = Number(data.current);
  const maxAllowed = Number(data.max_allowed);
  const source = String(data.budget_source ?? "session").trim() || "session";
  if (Number.isFinite(current) && Number.isFinite(maxAllowed)) {
    return { source, current, maxAllowed };
  }
  const errText = String(data.text ?? "");
  return parseBudgetExceededFromText(errText);
}

export function findBudgetExceededInMessages(messages: Message[]): BudgetExceededInfo | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;
    if (msg.noticeKind === "budget_exceeded") {
      const current = Number(msg.budgetCurrent);
      const maxAllowed = Number(msg.budgetMax);
      const source = String(msg.budgetSource ?? "session").trim() || "session";
      if (Number.isFinite(current) && Number.isFinite(maxAllowed)) {
        return { source, current, maxAllowed };
      }
    }
    const parsed = parseBudgetExceededFromText(msg.content);
    if (parsed) return parsed;
  }
  return null;
}

export function budgetExceededPercent(info: BudgetExceededInfo): number {
  if (!info.maxAllowed) return 100;
  return Math.round((info.current / info.maxAllowed) * 100);
}
