/**
 * admin-console · ECP E3 审核工作流（MySQL）
 */

import {
  ApprovalRequiredError,
  ApprovalWorkflowError,
  BUILTIN_APPROVAL_PRESETS,
  canActorApproveManualStep,
  deriveRequestStatusFromSteps,
  evaluateAutoScanStep,
  getBuiltinPreset,
  presetRequiredForAction,
  type ApprovalAction,
  type ApprovalActorScope,
  type ApprovalRequestStatus,
  type ApprovalResourceType,
  type ApprovalStepKind,
  type ApprovalStepSnapshot,
  type ApprovalStepStatus,
  type ScanVerdict,
  assertPublishApprovalGate,
} from "@agenticx/config";
import {
  approvalRequests,
  approvalSteps,
  approvalWorkflowPresets,
  ecpApprovalSettings,
  ecpPlatformApprovalSettings,
  enterpriseSkills,
  platformCatalogItemVersions,
} from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";

export { ApprovalRequiredError, ApprovalWorkflowError };

export type ApprovalRequestRecord = {
  id: string;
  tenantId: string;
  presetSlug: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  action: ApprovalAction;
  status: ApprovalRequestStatus;
  requesterUserId: string | null;
  requesterEmail: string | null;
  rejectionReason: string | null;
  contextJson: Record<string, unknown>;
  consumedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  steps: ApprovalStepRecord[];
};

export type ApprovalStepRecord = {
  id: string;
  requestId: string;
  stepOrder: number;
  stepKind: ApprovalStepKind;
  actorScope: ApprovalActorScope | null;
  status: ApprovalStepStatus;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
};

export type TenantApprovalSettings = {
  tenantId: string;
  skillPublishPresetSlug: string | null;
  platformIntroducePresetSlug: string | null;
};

export type PlatformApprovalSettings = {
  catalogPublishPresetSlug: string | null;
};

function platformOperatorTenantId(): string | null {
  return process.env.ECP_PLATFORM_OPERATOR_TENANT_ID?.trim() || null;
}

function rowToRequest(
  row: typeof approvalRequests.$inferSelect,
  steps: ApprovalStepRecord[],
): ApprovalRequestRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    presetSlug: row.presetSlug,
    resourceType: row.resourceType as ApprovalResourceType,
    resourceId: row.resourceId,
    action: row.action as ApprovalAction,
    status: row.status as ApprovalRequestStatus,
    requesterUserId: row.requesterUserId ?? null,
    requesterEmail: row.requesterEmail ?? null,
    rejectionReason: row.rejectionReason ?? null,
    contextJson: (row.contextJson ?? {}) as Record<string, unknown>,
    consumedAt: row.consumedAt ?? null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    steps,
  };
}

function rowToStep(row: typeof approvalSteps.$inferSelect): ApprovalStepRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    stepOrder: row.stepOrder,
    stepKind: row.stepKind as ApprovalStepKind,
    actorScope: (row.actorScope as ApprovalActorScope | null) ?? null,
    status: row.status as ApprovalStepStatus,
    decisionNote: row.decisionNote ?? null,
    decidedByUserId: row.decidedByUserId ?? null,
    decidedByEmail: row.decidedByEmail ?? null,
    decidedAt: row.decidedAt ?? null,
  };
}

async function loadSteps(requestId: string): Promise<ApprovalStepRecord[]> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.requestId, requestId))
    .orderBy(approvalSteps.stepOrder);
  return rows.map(rowToStep);
}

async function loadRequestRecord(id: string): Promise<ApprovalRequestRecord | null> {
  const db = getIamDb();
  const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
  if (!rows[0]) return null;
  const steps = await loadSteps(id);
  return rowToRequest(rows[0], steps);
}

export async function listBuiltinPresets() {
  return BUILTIN_APPROVAL_PRESETS.map((p) => ({
    slug: p.slug,
    displayNameZh: p.displayNameZh,
    steps: p.steps,
  }));
}

export async function getTenantApprovalSettings(tenantId: string): Promise<TenantApprovalSettings> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(ecpApprovalSettings)
    .where(eq(ecpApprovalSettings.tenantId, tenantId))
    .limit(1);
  return {
    tenantId,
    skillPublishPresetSlug: rows[0]?.skillPublishPresetSlug ?? null,
    platformIntroducePresetSlug: rows[0]?.platformIntroducePresetSlug ?? null,
  };
}

export async function upsertTenantApprovalSettings(
  tenantId: string,
  input: {
    skillPublishPresetSlug?: string | null;
    platformIntroducePresetSlug?: string | null;
  },
): Promise<TenantApprovalSettings> {
  for (const slug of [input.skillPublishPresetSlug, input.platformIntroducePresetSlug]) {
    if (slug && !getBuiltinPreset(slug)) {
      throw new ApprovalWorkflowError("unknown approval preset");
    }
  }
  const db = getIamDb();
  const now = new Date();
  const existing = await getTenantApprovalSettings(tenantId);
  await db
    .insert(ecpApprovalSettings)
    .values({
      tenantId,
      skillPublishPresetSlug:
        input.skillPublishPresetSlug !== undefined
          ? input.skillPublishPresetSlug
          : existing.skillPublishPresetSlug,
      platformIntroducePresetSlug:
        input.platformIntroducePresetSlug !== undefined
          ? input.platformIntroducePresetSlug
          : existing.platformIntroducePresetSlug,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: ecpApprovalSettings.tenantId,
      set: {
        skillPublishPresetSlug:
          input.skillPublishPresetSlug !== undefined
            ? input.skillPublishPresetSlug
            : existing.skillPublishPresetSlug,
        platformIntroducePresetSlug:
          input.platformIntroducePresetSlug !== undefined
            ? input.platformIntroducePresetSlug
            : existing.platformIntroducePresetSlug,
        updatedAt: now,
      },
    });
  return getTenantApprovalSettings(tenantId);
}

export async function getPlatformApprovalSettings(): Promise<PlatformApprovalSettings> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(ecpPlatformApprovalSettings)
    .where(eq(ecpPlatformApprovalSettings.id, "default"))
    .limit(1);
  return { catalogPublishPresetSlug: rows[0]?.catalogPublishPresetSlug ?? null };
}

export async function upsertPlatformApprovalSettings(input: {
  catalogPublishPresetSlug?: string | null;
}): Promise<PlatformApprovalSettings> {
  if (input.catalogPublishPresetSlug && !getBuiltinPreset(input.catalogPublishPresetSlug)) {
    throw new ApprovalWorkflowError("unknown approval preset");
  }
  const db = getIamDb();
  const now = new Date();
  const existing = await getPlatformApprovalSettings();
  await db
    .insert(ecpPlatformApprovalSettings)
    .values({
      id: "default",
      catalogPublishPresetSlug:
        input.catalogPublishPresetSlug !== undefined
          ? input.catalogPublishPresetSlug
          : existing.catalogPublishPresetSlug,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: ecpPlatformApprovalSettings.id,
      set: {
        catalogPublishPresetSlug:
          input.catalogPublishPresetSlug !== undefined
            ? input.catalogPublishPresetSlug
            : existing.catalogPublishPresetSlug,
        updatedAt: now,
      },
    });
  return getPlatformApprovalSettings();
}

async function resolveScanVerdict(input: {
  resourceType: ApprovalResourceType;
  resourceId: string;
  contextJson: Record<string, unknown>;
}): Promise<ScanVerdict> {
  const db = getIamDb();
  if (input.resourceType === "enterprise_skill") {
    const rows = await db
      .select({ scanVerdict: enterpriseSkills.scanVerdict })
      .from(enterpriseSkills)
      .where(eq(enterpriseSkills.id, input.resourceId))
      .limit(1);
    return (rows[0]?.scanVerdict as ScanVerdict) ?? null;
  }
  if (input.resourceType === "platform_catalog_version") {
    const versionId =
      typeof input.contextJson.versionId === "string"
        ? input.contextJson.versionId
        : input.resourceId;
    const rows = await db
      .select({ scanVerdict: platformCatalogItemVersions.scanVerdict })
      .from(platformCatalogItemVersions)
      .where(eq(platformCatalogItemVersions.id, versionId))
      .limit(1);
    return (rows[0]?.scanVerdict as ScanVerdict) ?? null;
  }
  if (input.resourceType === "platform_catalog_item" || input.resourceType === "expert_package") {
    const versionId = input.contextJson.versionId;
    if (typeof versionId === "string") {
      const rows = await db
        .select({ scanVerdict: platformCatalogItemVersions.scanVerdict })
        .from(platformCatalogItemVersions)
        .where(eq(platformCatalogItemVersions.id, versionId))
        .limit(1);
      return (rows[0]?.scanVerdict as ScanVerdict) ?? null;
    }
  }
  return null;
}

async function syncRequestStatus(requestId: string): Promise<ApprovalRequestRecord | null> {
  const db = getIamDb();
  const steps = await loadSteps(requestId);
  const status = deriveRequestStatusFromSteps(steps as ApprovalStepSnapshot[]);
  const nowIso = new Date().toISOString();
  const patch: Partial<typeof approvalRequests.$inferInsert> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "approved" || status === "rejected") {
    patch.completedAt = nowIso;
  }
  if (status === "rejected") {
    const failed = steps.find((s) => s.status === "failed");
    patch.rejectionReason = failed?.decisionNote ?? "审核未通过";
  }
  await db.update(approvalRequests).set(patch).where(eq(approvalRequests.id, requestId));
  const record = await loadRequestRecord(requestId);
  if (record?.status === "approved" && record.action === "platform_introduce") {
    await executePlatformIntroduceSideEffect(record);
  }
  return record;
}

async function executePlatformIntroduceSideEffect(record: ApprovalRequestRecord): Promise<void> {
  if (record.contextJson.introduceExecuted === true) return;
  const catalogItemId = record.resourceId;
  const tenantId = record.tenantId;
  const { grantCatalogToTenant } = await import("./platform-catalog-store");
  await grantCatalogToTenant(catalogItemId, tenantId);
  const db = getIamDb();
  await db
    .update(approvalRequests)
    .set({
      contextJson: { ...record.contextJson, introduceExecuted: true },
      updatedAt: new Date(),
    })
    .where(eq(approvalRequests.id, record.id));
}

async function runAutoScanForRequest(requestId: string, contextJson: Record<string, unknown>) {
  const db = getIamDb();
  const reqRows = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1);
  const req = reqRows[0];
  if (!req) return;
  const stepRows = await db
    .select()
    .from(approvalSteps)
    .where(and(eq(approvalSteps.requestId, requestId), eq(approvalSteps.stepKind, "auto_scan")))
    .limit(1);
  const step = stepRows[0];
  if (!step || step.status !== "pending") return;
  const verdict = await resolveScanVerdict({
    resourceType: req.resourceType as ApprovalResourceType,
    resourceId: req.resourceId,
    contextJson,
  });
  const result = evaluateAutoScanStep(verdict);
  const nowIso = new Date().toISOString();
  await db
    .update(approvalSteps)
    .set({
      status: result.status,
      decisionNote: result.note,
      decidedAt: nowIso,
      updatedAt: new Date(),
    })
    .where(eq(approvalSteps.id, step.id));
}

export async function createApprovalRequest(input: {
  tenantId: string;
  action: ApprovalAction;
  resourceType: ApprovalResourceType;
  resourceId: string;
  presetSlug: string;
  requesterUserId?: string;
  requesterEmail?: string;
  contextJson?: Record<string, unknown>;
}): Promise<ApprovalRequestRecord> {
  const preset = getBuiltinPreset(input.presetSlug);
  if (!preset) throw new ApprovalWorkflowError("unknown approval preset");
  const db = getIamDb();
  const requestId = ulid();
  const now = new Date();
  const contextJson = input.contextJson ?? {};
  await db.insert(approvalRequests).values({
    id: requestId,
    tenantId: input.tenantId,
    presetSlug: preset.slug,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action: input.action,
    status: "pending",
    requesterUserId: input.requesterUserId,
    requesterEmail: input.requesterEmail,
    contextJson,
    createdAt: now,
    updatedAt: now,
  });
  for (let i = 0; i < preset.steps.length; i += 1) {
    const def = preset.steps[i]!;
    await db.insert(approvalSteps).values({
      id: ulid(),
      requestId,
      stepOrder: i,
      stepKind: def.kind,
      actorScope: def.actorScope,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }
  await runAutoScanForRequest(requestId, contextJson);
  const synced = await syncRequestStatus(requestId);
  if (!synced) throw new Error("create approval request failed");
  return synced;
}

export async function listApprovalRequests(input: {
  tenantId?: string;
  status?: ApprovalRequestStatus;
  limit?: number;
}): Promise<ApprovalRequestRecord[]> {
  const db = getIamDb();
  const conditions = [];
  if (input.tenantId) conditions.push(eq(approvalRequests.tenantId, input.tenantId));
  if (input.status) conditions.push(eq(approvalRequests.status, input.status));
  const rows = await db
    .select()
    .from(approvalRequests)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(approvalRequests.updatedAt))
    .limit(input.limit ?? 100);
  const out: ApprovalRequestRecord[] = [];
  for (const row of rows) {
    const steps = await loadSteps(row.id);
    out.push(rowToRequest(row, steps));
  }
  return out;
}

export async function getApprovalRequest(id: string): Promise<ApprovalRequestRecord | null> {
  return loadRequestRecord(id);
}

export async function approveApprovalRequest(input: {
  requestId: string;
  actorUserId: string;
  actorEmail: string;
  actorTenantId: string;
  actorScopes: string[];
  note?: string;
}): Promise<ApprovalRequestRecord> {
  const record = await loadRequestRecord(input.requestId);
  if (!record) throw new ApprovalWorkflowError("approval request not found");
  if (record.status !== "pending") throw new ApprovalWorkflowError("request is not pending");
  const pending = record.steps.find(
    (s) => s.stepKind === "manual" && s.status === "pending",
  );
  if (!pending) throw new ApprovalWorkflowError("no pending manual step");
  const allowed = canActorApproveManualStep({
    step: pending as ApprovalStepSnapshot,
    actorScopes: input.actorScopes,
    actorTenantId: input.actorTenantId,
    requestTenantId: record.tenantId,
    platformOperatorTenantId: platformOperatorTenantId(),
  });
  if (!allowed) throw new ApprovalWorkflowError("forbidden to approve this step");
  const db = getIamDb();
  const nowIso = new Date().toISOString();
  await db
    .update(approvalSteps)
    .set({
      status: "passed",
      decisionNote: input.note?.trim() || "已通过",
      decidedByUserId: input.actorUserId,
      decidedByEmail: input.actorEmail,
      decidedAt: nowIso,
      updatedAt: new Date(),
    })
    .where(eq(approvalSteps.id, pending.id));
  const synced = await syncRequestStatus(input.requestId);
  if (!synced) throw new Error("approve failed");
  return synced;
}

export async function rejectApprovalRequest(input: {
  requestId: string;
  actorUserId: string;
  actorEmail: string;
  actorTenantId: string;
  actorScopes: string[];
  reason: string;
}): Promise<ApprovalRequestRecord> {
  const reason = input.reason.trim();
  if (!reason) throw new ApprovalWorkflowError("rejection reason is required");
  const record = await loadRequestRecord(input.requestId);
  if (!record) throw new ApprovalWorkflowError("approval request not found");
  if (record.status !== "pending") throw new ApprovalWorkflowError("request is not pending");
  const pending = record.steps.find(
    (s) => s.stepKind === "manual" && s.status === "pending",
  );
  if (!pending) throw new ApprovalWorkflowError("no pending manual step");
  const allowed = canActorApproveManualStep({
    step: pending as ApprovalStepSnapshot,
    actorScopes: input.actorScopes,
    actorTenantId: input.actorTenantId,
    requestTenantId: record.tenantId,
    platformOperatorTenantId: platformOperatorTenantId(),
  });
  if (!allowed) throw new ApprovalWorkflowError("forbidden to reject this step");
  const db = getIamDb();
  const nowIso = new Date().toISOString();
  await db
    .update(approvalSteps)
    .set({
      status: "failed",
      decisionNote: reason,
      decidedByUserId: input.actorUserId,
      decidedByEmail: input.actorEmail,
      decidedAt: nowIso,
      updatedAt: new Date(),
    })
    .where(eq(approvalSteps.id, pending.id));
  await db
    .update(approvalRequests)
    .set({
      status: "rejected",
      rejectionReason: reason,
      completedAt: nowIso,
      updatedAt: new Date(),
    })
    .where(eq(approvalRequests.id, input.requestId));
  const synced = await loadRequestRecord(input.requestId);
  if (!synced) throw new Error("reject failed");
  return synced;
}

async function findLatestApprovedRequest(input: {
  tenantId: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  action: ApprovalAction;
}): Promise<ApprovalRequestRecord | null> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.tenantId, input.tenantId),
        eq(approvalRequests.resourceType, input.resourceType),
        eq(approvalRequests.resourceId, input.resourceId),
        eq(approvalRequests.action, input.action),
        eq(approvalRequests.status, "approved"),
        isNull(approvalRequests.consumedAt),
      ),
    )
    .orderBy(desc(approvalRequests.completedAt))
    .limit(1);
  if (!rows[0]) return null;
  const steps = await loadSteps(rows[0].id);
  return rowToRequest(rows[0], steps);
}

export async function consumeApprovalRequest(requestId: string): Promise<void> {
  const db = getIamDb();
  await db
    .update(approvalRequests)
    .set({ consumedAt: new Date().toISOString(), updatedAt: new Date() })
    .where(eq(approvalRequests.id, requestId));
}

export async function assertShelfPublishApproval(input: {
  tenantId: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  action?: ApprovalAction;
}): Promise<ApprovalRequestRecord | null> {
  const action = input.action ?? "shelf_publish";
  const tenantSettings = await getTenantApprovalSettings(input.tenantId);
  const platformSettings = await getPlatformApprovalSettings();
  const presetSlug = presetRequiredForAction(
    {
      skillPublishPresetSlug: tenantSettings.skillPublishPresetSlug,
      platformIntroducePresetSlug: tenantSettings.platformIntroducePresetSlug,
      catalogPublishPresetSlug: platformSettings.catalogPublishPresetSlug,
    },
    action,
    input.resourceType,
  );
  if (!presetSlug) return null;
  const approved = await findLatestApprovedRequest({
    tenantId: input.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action,
  });
  assertPublishApprovalGate({
    presetSlug,
    requestStatus: approved?.status ?? null,
    consumedAt: approved?.consumedAt ?? null,
  });
  return approved;
}

export async function submitShelfPublishApprovalRequest(input: {
  tenantId: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  requesterUserId?: string;
  requesterEmail?: string;
  contextJson?: Record<string, unknown>;
}): Promise<ApprovalRequestRecord> {
  const tenantSettings = await getTenantApprovalSettings(input.tenantId);
  const platformSettings = await getPlatformApprovalSettings();
  const presetSlug = presetRequiredForAction(
    {
      skillPublishPresetSlug: tenantSettings.skillPublishPresetSlug,
      platformIntroducePresetSlug: tenantSettings.platformIntroducePresetSlug,
      catalogPublishPresetSlug: platformSettings.catalogPublishPresetSlug,
    },
    "shelf_publish",
    input.resourceType,
  );
  if (!presetSlug) {
    throw new ApprovalWorkflowError("approval workflow is not enabled for this action");
  }
  return createApprovalRequest({
    tenantId: input.tenantId,
    action: "shelf_publish",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    presetSlug,
    requesterUserId: input.requesterUserId,
    requesterEmail: input.requesterEmail,
    contextJson: input.contextJson,
  });
}

export async function submitPlatformIntroduceRequest(input: {
  tenantId: string;
  catalogItemId: string;
  requesterUserId?: string;
  requesterEmail?: string;
  contextJson?: Record<string, unknown>;
}): Promise<ApprovalRequestRecord> {
  const tenantSettings = await getTenantApprovalSettings(input.tenantId);
  const presetSlug = presetRequiredForAction(
    {
      skillPublishPresetSlug: tenantSettings.skillPublishPresetSlug,
      platformIntroducePresetSlug: tenantSettings.platformIntroducePresetSlug,
    },
    "platform_introduce",
    "platform_catalog_item",
  );
  if (!presetSlug) {
    throw new ApprovalWorkflowError("approval workflow is not enabled for platform introduce");
  }
  return createApprovalRequest({
    tenantId: input.tenantId,
    action: "platform_introduce",
    resourceType: "platform_catalog_item",
    resourceId: input.catalogItemId,
    presetSlug,
    requesterUserId: input.requesterUserId,
    requesterEmail: input.requesterEmail,
    contextJson: input.contextJson,
  });
}

/** 供迁移/测试：确认预设表可读。 */
export async function countWorkflowPresets(): Promise<number> {
  const db = getIamDb();
  const rows = await db.select({ id: approvalWorkflowPresets.id }).from(approvalWorkflowPresets);
  return rows.length;
}
