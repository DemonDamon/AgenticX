import { describe, expect, it } from "vitest";

import {
  ApprovalRequiredError,
  BUILTIN_APPROVAL_PRESETS,
  canActorApproveManualStep,
  deriveRequestStatusFromSteps,
  evaluateAutoScanStep,
  assertPublishApprovalGate,
  presetRequiredForAction,
} from "../ecp-approval-workflow";

describe("ecp-approval-workflow", () => {
  it("exposes two builtin presets with scan as first auto node", () => {
    expect(BUILTIN_APPROVAL_PRESETS).toHaveLength(2);
    for (const preset of BUILTIN_APPROVAL_PRESETS) {
      expect(preset.steps[0]).toEqual({ kind: "auto_scan", actorScope: null });
    }
    expect(BUILTIN_APPROVAL_PRESETS[1].steps).toHaveLength(3);
  });

  it("auto scan node blocks dangerous and unscanned verdicts", () => {
    expect(evaluateAutoScanStep("dangerous").status).toBe("failed");
    expect(evaluateAutoScanStep(null).status).toBe("failed");
    expect(evaluateAutoScanStep("safe").status).toBe("passed");
  });

  it("two-step preset blocks publish until request approved and unconsumed", () => {
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
        consumedAt: "2026-01-01T00:00:00.000Z",
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

  it("derives approved only after all steps pass", () => {
    const steps = [
      { stepOrder: 0, stepKind: "auto_scan" as const, actorScope: null, status: "passed" as const },
      {
        stepOrder: 1,
        stepKind: "manual" as const,
        actorScope: "enterprise_admin" as const,
        status: "passed" as const,
      },
      {
        stepOrder: 2,
        stepKind: "manual" as const,
        actorScope: "platform_operator" as const,
        status: "pending" as const,
      },
    ];
    expect(deriveRequestStatusFromSteps(steps)).toBe("pending");
    steps[2].status = "passed";
    expect(deriveRequestStatusFromSteps(steps)).toBe("approved");
  });

  it("reject leaves auditable failed step state", () => {
    const steps = [
      { stepOrder: 0, stepKind: "auto_scan" as const, actorScope: null, status: "passed" as const },
      {
        stepOrder: 1,
        stepKind: "manual" as const,
        actorScope: "enterprise_admin" as const,
        status: "failed" as const,
      },
    ];
    expect(deriveRequestStatusFromSteps(steps)).toBe("rejected");
  });

  it("resolves preset per action from tenant settings", () => {
    expect(
      presetRequiredForAction(
        {
          skillPublishPresetSlug: "enterprise_admin_only",
          platformIntroducePresetSlug: "enterprise_admin_platform",
        },
        "shelf_publish",
        "enterprise_skill",
      ),
    ).toBe("enterprise_admin_only");
    expect(
      presetRequiredForAction(
        { platformIntroducePresetSlug: "enterprise_admin_platform" },
        "platform_introduce",
        "enterprise_skill",
      ),
    ).toBe("enterprise_admin_platform");
  });

  it("scopes enterprise vs platform manual approvers", () => {
    const pendingPlatformStep = {
      stepOrder: 2,
      stepKind: "manual" as const,
      actorScope: "platform_operator" as const,
      status: "pending" as const,
    };
    expect(
      canActorApproveManualStep({
        step: pendingPlatformStep,
        actorScopes: ["provider:update"],
        actorTenantId: "01PLATFORM",
        requestTenantId: "01TENANT",
        platformOperatorTenantId: "01PLATFORM",
      }),
    ).toBe(true);
    expect(
      canActorApproveManualStep({
        step: pendingPlatformStep,
        actorScopes: ["provider:update"],
        actorTenantId: "01TENANT",
        requestTenantId: "01TENANT",
        platformOperatorTenantId: "01PLATFORM",
      }),
    ).toBe(false);
  });
});
