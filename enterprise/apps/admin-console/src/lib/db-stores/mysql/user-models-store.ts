/**
 * admin-console · 用户 ↔ 模型可见性映射（PostgreSQL）。
 * 原为 enterprise/.runtime/admin/user-models.json。
 */

import { getAdminMysqlDb } from "./database";
import { enterpriseRuntimeUserVisibleModels as uvmTable } from "@agenticx/db-schema/mysql";
import {
  getDepartment,
  listDepartmentAncestorIds,
  migrateLegacyUserVisibleModelsIfNeeded,
  resolveRuntimeAdminDir,
} from "@agenticx/iam-core";
import * as path from "node:path";
import { eq, and, sql } from "drizzle-orm";

import {
  clipToAllowed,
  computeEffectiveDeptAllowed,
  computePrunedModelIds,
  mergeUserStoredSet,
  collectUserAssignmentKeys,
} from "../../effective-models";
import { listAllEnabledModelIds } from "../../model-providers-store";

const LEGACY_PATH = path.join(resolveRuntimeAdminDir(), "user-models.json");

function requiredTenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for user-visible model assignments.");
  return t;
}

type Mapping = Record<string, string[]>;

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function migrateLegacyIfNeeded(tid: string): Promise<void> {
  await migrateLegacyUserVisibleModelsIfNeeded(tid);
}

export type UserModelsEditPayload = {
  userId: string;
  modelIds: string[];
  parentAllowedIds: string[];
  parentLabel: string;
  prunedModelIds: string[];
  /** @deprecated 兼容旧前端，等同 parentAllowedIds */
  inheritedDeptModelIds: string[];
};

export type SetUserModelsResult = {
  modelIds: string[];
  prunedModelIds: string[];
};

async function computeUserParentAllowed(deptId: string | null): Promise<{
  parentAllowedIds: string[];
  parentLabel: string;
}> {
  const tid = requiredTenant();
  const allEnabled = await listAllEnabledModelIds();
  const userVisibleMap = await listAllAssignments();
  if (!deptId) {
    return { parentAllowedIds: allEnabled, parentLabel: "__ALL_ENABLED__" };
  }
  const chain = await listDepartmentAncestorIds(tid, deptId);
  const parentAllowedIds = computeEffectiveDeptAllowed({
    allEnabledIds: allEnabled,
    userVisibleMap,
    ancestorChain: chain,
  });
  const dept = await getDepartment(tid, deptId);
  const parentLabel = dept ? `${dept.name}（${dept.path}）` : deptId;
  return { parentAllowedIds, parentLabel };
}

export async function readUserEditPayload(
  userId: string,
  email: string,
  deptId: string | null,
): Promise<UserModelsEditPayload> {
  const modelIds = await getUserModels(userId);
  const { parentAllowedIds, parentLabel } = await computeUserParentAllowed(deptId);
  const prunedModelIds = computePrunedModelIds(modelIds, new Set(parentAllowedIds));
  return {
    userId,
    modelIds,
    parentAllowedIds,
    parentLabel,
    prunedModelIds,
    inheritedDeptModelIds: parentAllowedIds,
  };
}

export async function getUserModels(userId: string): Promise<string[]> {
  const tid = requiredTenant();
  await migrateLegacyIfNeeded(tid);
  const db = getAdminMysqlDb();
  const rows = await db
    .select({ modelId: uvmTable.modelId })
    .from(uvmTable)
    .where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, userId)));
  return [...new Set(rows.map((r) => r.modelId))];
}

export async function setUserModels(
  userId: string,
  modelIds: string[],
  deptId: string | null = null,
): Promise<SetUserModelsResult> {
  const tid = requiredTenant();
  await migrateLegacyIfNeeded(tid);
  const db = getAdminMysqlDb();
  const { parentAllowedIds } = await computeUserParentAllowed(deptId);
  const parentAllowed = new Set(parentAllowedIds);
  const { saved, prunedModelIds } = clipToAllowed(modelIds, parentAllowed);

  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, userId)));
  if (saved.length > 0) {
    const rows = saved.map((modelId) => ({ tenantId: tid, assignmentKey: userId, modelId }));
    for (const chunk of chunked(rows, 100)) {
      await db
        .insert(uvmTable)
        .values(chunk)
        .onDuplicateKeyUpdate({ set: { modelId: sql`${uvmTable.modelId}` } });
    }
  }
  return { modelIds: saved, prunedModelIds };
}

export async function listAllAssignments(): Promise<Mapping> {
  const tid = requiredTenant();
  await migrateLegacyIfNeeded(tid);
  const db = getAdminMysqlDb();
  const rows = await db.select().from(uvmTable).where(eq(uvmTable.tenantId, tid));
  const map: Mapping = {};
  for (const r of rows) {
    if (!map[r.assignmentKey]) map[r.assignmentKey] = [];
    map[r.assignmentKey]!.push(r.modelId);
  }
  for (const k of Object.keys(map)) {
    map[k] = [...new Set(map[k]!)];
  }
  return map;
}

export async function deleteUserAssignment(userId: string): Promise<void> {
  const tid = requiredTenant();
  await migrateLegacyIfNeeded(tid);
  const db = getAdminMysqlDb();
  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, userId)));
}

export function userModelsFilePath(): string {
  return LEGACY_PATH;
}

export function __resetUserModelsCache(): void {
  /* legacy in-process flag removed; kept for tests that reset module state */
}

export { collectUserAssignmentKeys, mergeUserStoredSet };
