export type TurnIntent = "default" | "plan" | "isolate";

export function normalizeTurnIntent(raw: unknown): TurnIntent {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "plan" || value === "isolate") return value;
  if (value === "multitask") return "isolate";
  return "default";
}

export function applyTurnIntentToggle(
  current: TurnIntent,
  next: "plan" | "isolate",
  enabled: boolean,
): TurnIntent {
  if (!enabled) return current === next ? "default" : current;
  return next;
}

export function togglePlanIntent(current: TurnIntent): TurnIntent {
  return current === "plan" ? "default" : "plan";
}
