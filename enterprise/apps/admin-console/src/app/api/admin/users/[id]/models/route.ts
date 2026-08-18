import { getAdminUser } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { computeEffectiveUserAllowed } from "../../../../../../lib/effective-models";
import { getQuotaConfig } from "../../../../../../lib/token-quota-store";
import {
  groupModelExclusionsForUser,
  groupModelSourcesForUser,
  listUserGroups,
  setUserGroupModelExclusions,
} from "../../../../../../lib/user-groups-store";
import {
  collectUserAssignmentKeys,
  listAllAssignments,
  mergeUserStoredSet,
  readUserEditPayload,
  setUserModels,
} from "../../../../../../lib/user-models-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const user = await getAdminUser(auth.session.tenantId, id);
  if (!user) {
    return NextResponse.json({ code: "40400", message: "user not found" }, { status: 404 });
  }
  const [payload, groups, assignments, quotaConfig] = await Promise.all([
    readUserEditPayload(id, user.email, user.deptId),
    listUserGroups(auth.session.tenantId),
    listAllAssignments(),
    getQuotaConfig(auth.session.tenantId),
  ]);
  const allowed = new Set(payload.parentAllowedIds);
  const storedModelIds = mergeUserStoredSet(assignments, collectUserAssignmentKeys(id, user.email)) ?? [];
  const groupModelSources = groupModelSourcesForUser(groups, id).map((group) => ({
    ...group,
    modelIds: group.modelIds.filter((modelId) => allowed.has(modelId)),
  }));
  const groupModelIds = [...new Set(groupModelSources.flatMap((group) => group.modelIds))];
  const groupModelIdSet = new Set(groupModelIds);
  const individualModelIds = storedModelIds.filter((modelId) => !groupModelIdSet.has(modelId));
  const excludedGroupModelIds = groupModelExclusionsForUser(quotaConfig, id).filter((modelId) => groupModelIdSet.has(modelId));
  const effectiveModelIds = computeEffectiveUserAllowed(
    payload.parentAllowedIds,
    storedModelIds.length > 0 ? storedModelIds : null,
    groupModelIds,
    excludedGroupModelIds,
  );
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      ...payload,
      parentSourceLabel: payload.parentLabel,
      individualModelIds,
      groupModelIds,
      excludedGroupModelIds,
      groupModelSources,
      effectiveModelIds,
    },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const user = await getAdminUser(auth.session.tenantId, id);
  if (!user) {
    return NextResponse.json({ code: "40400", message: "user not found" }, { status: 404 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const raw = Array.isArray(body.modelIds) ? body.modelIds : [];
    const modelIds = raw.filter((x): x is string => typeof x === "string");
    const groups = await listUserGroups(auth.session.tenantId);
    const groupModelIds = new Set(groupModelSourcesForUser(groups, id).flatMap((group) => group.modelIds));
    const individualModelIds = modelIds.filter((modelId) => !groupModelIds.has(modelId));
    const rawExclusions = Array.isArray(body.excludedGroupModelIds) ? body.excludedGroupModelIds : [];
    const excludedGroupModelIds = rawExclusions.filter(
      (modelId): modelId is string => typeof modelId === "string" && groupModelIds.has(modelId),
    );
    const saved = await setUserModels(id, individualModelIds, user.deptId);
    await setUserModels(`email:${user.email.toLowerCase()}`, saved.modelIds, user.deptId);
    const savedExclusions = await setUserGroupModelExclusions(
      auth.session.tenantId,
      id,
      excludedGroupModelIds,
    );
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        userId: id,
        modelIds: saved.modelIds,
        excludedGroupModelIds: savedExclusions,
        prunedModelIds: saved.prunedModelIds,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 },
    );
  }
}
