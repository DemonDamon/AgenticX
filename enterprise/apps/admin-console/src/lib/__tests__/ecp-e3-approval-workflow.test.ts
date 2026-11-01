import { describe, expect, it } from "vitest";

import {
  ApprovalRequiredError,
  BUILTIN_APPROVAL_PRESETS,
  deriveRequestStatusFromSteps,
  evaluateAutoScanStep,
  assertPublishApprovalGate,
} from "@agenticx/config";

describe("ECP E3 approval workflow acceptance (synthetic)", () => {
  it("two-step preset requires approved unconsumed request before publish", () => {
    expect(BUILTIN_APPROVAL_PRESETS[1]?.steps.filter((s) => s.kind === "manual")).toHaveLength(2);
    expect(() =>
      assertPublishApprovalGate({
        presetSlug: "enterprise_admin_platform",
        requestStatus: "pending",
        consumedAt: null,
      }),
    ).toThrow(ApprovalRequiredError);
    expect(() =>
      assertPublishApprovalGate({
        presetSlug: "enterprise_admin_platform",
        requestStatus: "approved",
        consumedAt: null,
      }),
    ).not.toThrow();
  });

  it("reject path keeps failed step note for audit", () => {
    const status = deriveRequestStatusFromSteps([
      { stepOrder: 0, stepKind: "auto_scan", actorScope: null, status: "passed" },
      {
        stepOrder: 1,
        stepKind: "manual",
        actorScope: "enterprise_admin",
        status: "failed",
      },
    ]);
    expect(status).toBe("rejected");
  });

  it("scan auto-node still gates dangerous payloads", () => {
    expect(evaluateAutoScanStep("dangerous").status).toBe("failed");
  });
});
