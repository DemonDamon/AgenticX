// SP2 security-eval-and-admission: admission gate decision (pure function).
// Enforced in provider model routes before any enable action; every
// decision path is audited by the caller (audit-before-action discipline).

import { readTenantAdmission } from "./model-admission-store";
import type { AdmissionOverride, TenantAdmission } from "./model-admission-store";

export type GateAction =
  | { kind: "allow"; reason: "gate-off" }
  | { kind: "allow"; reason: "no-scorecard" }
  | { kind: "allow"; reason: "score-passed"; score: number; grade: string }
  | { kind: "block"; reason: "score-below-threshold"; score: number; grade: string; minScore: number }
  | { kind: "block"; reason: "scorecard-required"; score: number; grade: string; minScore: number };

export async function evaluateAdmission(
  tenantId: string,
  modelName: string,
): Promise<{ admission: TenantAdmission; action: GateAction }> {
  const admission = await readTenantAdmission(tenantId);
  const action = decideAdmission(admission, modelName);
  return { admission, action };
}

export function decideAdmission(admission: TenantAdmission, modelName: string): GateAction {
  const threshold = admission.threshold;
  if (!threshold.enabled) {
    // Gate off == pre-SP2 behavior (regression-safe default escape).
    return { kind: "allow", reason: "gate-off" };
  }
  const latest = admission.scorecards[modelName]?.latest;
  if (!latest) {
    if (threshold.requireScorecard) {
      return { kind: "block", reason: "scorecard-required", score: -1, grade: "", minScore: threshold.minScore };
    }
    return { kind: "allow", reason: "no-scorecard" };
  }
  if (latest.safetyScore < threshold.minScore) {
    return {
      kind: "block",
      reason: "score-below-threshold",
      score: latest.safetyScore,
      grade: latest.grade,
      minScore: threshold.minScore,
    };
  }
  return { kind: "allow", reason: "score-passed", score: latest.safetyScore, grade: latest.grade };
}

export function isBlocked(action: GateAction): action is Extract<GateAction, { kind: "block" }> {
  return action.kind === "block";
}

export function validateOverrideInput(input: unknown): { reason: string; ticket?: string } {
  if (!input || typeof input !== "object") {
    throw new Error("override payload required");
  }
  const { reason, ticket } = input as { reason?: unknown; ticket?: unknown };
  if (typeof reason !== "string" || reason.trim().length < 5) {
    throw new Error("override reason must be at least 5 characters");
  }
  const out: { reason: string; ticket?: string } = { reason: reason.trim() };
  if (typeof ticket === "string" && ticket.trim()) {
    out.ticket = ticket.trim();
  }
  return out;
}

export function makeOverride(
  admission: TenantAdmission,
  modelName: string,
  operator: string,
  input: { reason: string; ticket?: string },
): AdmissionOverride {
  return {
    model: modelName,
    operator,
    reason: input.reason,
    ticket: input.ticket,
    at: new Date().toISOString(),
    scoreAtOverride: admission.scorecards[modelName]?.latest?.safetyScore ?? -1,
  };
}
