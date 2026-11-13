// SP2 admission gate enforcement for model enable actions. Shared by the
// provider model routes (PATCH enable / POST add-model). Audit-before-
// action: every decision path below writes an IAM audit event before the
// caller proceeds or returns the block response.

import { NextResponse } from "next/server";

import type { AdminSession } from "./admin-auth";
import { auditConsoleEvent } from "./console-audit";
import { recordOverride } from "./model-admission-store";
import {
  evaluateAdmission,
  isBlocked,
  makeOverride,
  validateOverrideInput,
  type GateAction,
} from "./model-admission";

export type GateOutcome =
  | { ok: true; action: GateAction }
  | { ok: false; response: NextResponse };

export function admissionBlockResponse(action: Extract<GateAction, { kind: "block" }>): NextResponse {
  const detail =
    action.reason === "scorecard-required"
      ? { reason: action.reason, message: "model admission requires a security scorecard before enablement" }
      : {
          reason: action.reason,
          score: action.score,
          grade: action.grade,
          minScore: action.minScore,
          message: "model safety score below admission threshold; enable requires a recorded override",
        };
  return NextResponse.json(
    { code: "40310", message: "model_admission_blocked", data: detail },
    { status: 403 },
  );
}

export async function runAdmissionGate(
  session: AdminSession,
  modelName: string,
  overrideInput: unknown,
): Promise<GateOutcome> {
  const { admission, action } = await evaluateAdmission(session.tenantId, modelName);

  if (action.reason === "gate-off") {
    // Gate disabled == pre-SP2 behavior; no gate audit noise on this path.
    return { ok: true, action };
  }

  if (isBlocked(action)) {
    if (overrideInput === undefined) {
      await auditConsoleEvent(session, "model_admission.blocked_attempt", "model", {
        model: modelName,
        reason: action.reason,
        score: action.reason === "score-below-threshold" ? action.score : undefined,
        minScore: action.reason === "score-below-threshold" ? action.minScore : undefined,
      });
      return { ok: false, response: admissionBlockResponse(action) };
    }
    let override;
    try {
      override = validateOverrideInput(overrideInput);
    } catch (err) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            code: "40000",
            message: err instanceof Error ? err.message : "invalid override",
          },
          { status: 400 },
        ),
      };
    }
    const recorded = makeOverride(admission, modelName, session.userId, override);
    await recordOverride(session.tenantId, recorded);
    // Audit the override BEFORE the enable action is applied (审计后动作).
    await auditConsoleEvent(session, "model_admission.override", "model", {
      model: modelName,
      reason: recorded.reason,
      ticket: recorded.ticket,
      scoreAtOverride: recorded.scoreAtOverride,
      threshold: admission.threshold.minScore,
    });
    return { ok: true, action };
  }

  await auditConsoleEvent(session, `model_admission.${action.reason}`, "model", {
    model: modelName,
    reason: action.reason,
    score: action.reason === "score-passed" ? action.score : undefined,
  });
  return { ok: true, action };
}
