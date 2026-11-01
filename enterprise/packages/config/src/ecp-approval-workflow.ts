/**
 * ECP E3 · 可插拔审核工作流（纯逻辑，无 IO）
 */

import { assertScanAllowsPublish, type ScanVerdict, ShelfPublishError } from "./ecp-shelf-lifecycle";

export type ApprovalAction = "shelf_publish" | "platform_introduce";
export type ApprovalResourceType =
  | "enterprise_skill"
  | "platform_catalog_version"
  | "platform_catalog_item"
  | "expert_package";
export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ApprovalStepKind = "auto_scan" | "manual";
export type ApprovalActorScope = "enterprise_admin" | "platform_operator";
export type ApprovalStepStatus = "pending" | "passed" | "failed" | "skipped";

export type ApprovalPresetSlug = "enterprise_admin_only" | "enterprise_admin_platform";

export type ApprovalStepDefinition = {
  kind: ApprovalStepKind;
  /** manual 步骤必填；auto_scan 为 null */
  actorScope: ApprovalActorScope | null;
};

export type BuiltinApprovalPreset = {
  slug: ApprovalPresetSlug;
  /** 中文展示名（UI） */
  displayNameZh: string;
  steps: ApprovalStepDefinition[];
};

export const BUILTIN_APPROVAL_PRESETS: BuiltinApprovalPreset[] = [
  {
    slug: "enterprise_admin_only",
    displayNameZh: "企管单级",
    steps: [
      { kind: "auto_scan", actorScope: null },
      { kind: "manual", actorScope: "enterprise_admin" },
    ],
  },
  {
    slug: "enterprise_admin_platform",
    displayNameZh: "企管+平台",
    steps: [
      { kind: "auto_scan", actorScope: null },
      { kind: "manual", actorScope: "enterprise_admin" },
      { kind: "manual", actorScope: "platform_operator" },
    ],
  },
];

export class ApprovalWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalWorkflowError";
  }
}

export class ApprovalRequiredError extends Error {
  readonly code = "approval_required" as const;
  constructor(message = "publish requires a completed approval") {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

export function getBuiltinPreset(slug: string | null | undefined): BuiltinApprovalPreset | null {
  if (!slug) return null;
  return BUILTIN_APPROVAL_PRESETS.find((p) => p.slug === slug) ?? null;
}

export function presetRequiredForAction(
  settings: {
    skillPublishPresetSlug?: string | null;
    platformIntroducePresetSlug?: string | null;
    catalogPublishPresetSlug?: string | null;
  },
  action: ApprovalAction,
  resourceType: ApprovalResourceType,
): ApprovalPresetSlug | null {
  if (action === "shelf_publish") {
    if (resourceType === "enterprise_skill") {
      const slug = settings.skillPublishPresetSlug;
      return slug && getBuiltinPreset(slug) ? (slug as ApprovalPresetSlug) : null;
    }
    if (resourceType === "platform_catalog_version") {
      const slug = settings.catalogPublishPresetSlug;
      return slug && getBuiltinPreset(slug) ? (slug as ApprovalPresetSlug) : null;
    }
  }
  if (action === "platform_introduce") {
    const slug = settings.platformIntroducePresetSlug;
    return slug && getBuiltinPreset(slug) ? (slug as ApprovalPresetSlug) : null;
  }
  return null;
}

/** 自动 scan 节点：复用 E2 门禁，不可人工把 dangerous 改成 safe。 */
export function evaluateAutoScanStep(scanVerdict: ScanVerdict): {
  status: "passed" | "failed";
  note: string;
} {
  try {
    assertScanAllowsPublish(scanVerdict);
    return { status: "passed", note: "安全扫描已通过" };
  } catch (error) {
    const message =
      error instanceof ShelfPublishError ? error.message : "安全扫描未通过";
    return { status: "failed", note: message };
  }
}

export type ApprovalStepSnapshot = {
  stepOrder: number;
  stepKind: ApprovalStepKind;
  actorScope: ApprovalActorScope | null;
  status: ApprovalStepStatus;
};

export function findCurrentPendingManualStep(
  steps: ApprovalStepSnapshot[],
): ApprovalStepSnapshot | null {
  const ordered = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  for (const step of ordered) {
    if (step.stepKind === "auto_scan") continue;
    if (step.status === "pending") return step;
    if (step.status === "failed") return null;
  }
  return null;
}

export function deriveRequestStatusFromSteps(
  steps: ApprovalStepSnapshot[],
): ApprovalRequestStatus {
  const ordered = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  if (ordered.some((s) => s.status === "failed")) return "rejected";
  if (ordered.every((s) => s.status === "passed" || s.status === "skipped")) {
    return "approved";
  }
  return "pending";
}

export function assertPublishApprovalGate(input: {
  presetSlug: ApprovalPresetSlug | null;
  requestStatus: ApprovalRequestStatus | null;
  consumedAt: string | null;
}): void {
  if (!input.presetSlug) return;
  if (input.requestStatus !== "approved" || input.consumedAt) {
    throw new ApprovalRequiredError();
  }
}

export function canActorApproveManualStep(input: {
  step: ApprovalStepSnapshot;
  actorScopes: string[];
  actorTenantId: string;
  requestTenantId: string;
  platformOperatorTenantId: string | null;
}): boolean {
  if (input.step.stepKind !== "manual" || input.step.status !== "pending") return false;
  if (input.step.actorScope === "enterprise_admin") {
    return (
      input.actorTenantId === input.requestTenantId &&
      input.actorScopes.includes("provider:update")
    );
  }
  if (input.step.actorScope === "platform_operator") {
    const platformTenant = input.platformOperatorTenantId?.trim();
    const onPlatformTenant =
      !platformTenant || platformTenant === input.actorTenantId;
    return onPlatformTenant && input.actorScopes.includes("provider:update");
  }
  return false;
}
