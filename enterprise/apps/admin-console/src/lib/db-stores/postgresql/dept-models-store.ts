/**
 * admin-console · 部门 ↔ 模型可见性映射（PostgreSQL）。
 * assignment_key 使用 `dept:<deptId>` 写入 enterprise_runtime_user_visible_models。
 */

import { getDepartment, getIamDb, listDepartmentAncestorIds } from "@agenticx/iam-core";
import { enterpriseRuntimeUserVisibleModels as uvmTable } from "@agenticx/db-schema";
import { and, eq } from "drizzle-orm";

import {
  clipToAllowed,
  computeParentAllowedIds,
  computePrunedModelIds,
} from "../../effective-models";
import { listAllEnabledModelIds } from "../../model-providers-store";
import { listAllAssignments } from "../../user-models-store";

const DEPT_PREFIX = "dept:";

function deptKey(deptId: string): string {
  return `${DEPT_PREFIX}${deptId}`;
}

function requiredTenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for dept-visible model assignments.");
  return t;
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type DeptModelsEditPayload = {
  deptId: string;
  modelIds: string[];
  parentAllowedIds: string[];
  parentLabel: string;
  prunedModelIds: string[];
};

export type SetDeptModelsResult = {
  modelIds: string[];
  prunedModelIds: string[];
};

async function resolveParentLabel(tenantId: string, ancestorChain: readonly string[]): Promise<string> {
  if (ancestorChain.length <= 1) return "__ALL_ENABLED__";
  const parentId = ancestorChain[1];
  if (!parentId) return "__ALL_ENABLED__";
  const parent = await getDepartment(tenantId, parentId);
  return parent ? `${parent.name}（${parent.path}）` : parentId;
}

export async function readDeptEditPayload(deptId: string): Promise<DeptModelsEditPayload> {
  const tid = requiredTenant();
  const [chain, allEnabled, userVisibleMap, modelIds] = await Promise.all([
    listDepartmentAncestorIds(tid, deptId),
    listAllEnabledModelIds(),
    listAllAssignments(),
    getDeptModels(deptId),
  ]);
  const parentAllowedIds = computeParentAllowedIds(allEnabled, userVisibleMap, chain);
  const parentLabel = await resolveParentLabel(tid, chain);
  const prunedModelIds = computePrunedModelIds(modelIds, new Set(parentAllowedIds));
  return { deptId, modelIds, parentAllowedIds, parentLabel, prunedModelIds };
}

export async function getDeptModels(deptId: string): Promise<string[]> {
  const tid = requiredTenant();
  const db = getIamDb();
  const rows = await db
    .select({ modelId: uvmTable.modelId })
    .from(uvmTable)
    .where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
  return [...new Set(rows.map((r) => r.modelId))];
}

export async function setDeptModels(deptId: string, modelIds: string[]): Promise<SetDeptModelsResult> {
  const tid = requiredTenant();
  const db = getIamDb();
  const [chain, allEnabled, userVisibleMap] = await Promise.all([
    listDepartmentAncestorIds(tid, deptId),
    listAllEnabledModelIds(),
    listAllAssignments(),
  ]);
  const parentAllowed = new Set(computeParentAllowedIds(allEnabled, userVisibleMap, chain));
  const { saved, prunedModelIds } = clipToAllowed(modelIds, parentAllowed);

  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
  if (saved.length > 0) {
    const rows = saved.map((modelId) => ({ tenantId: tid, assignmentKey: deptKey(deptId), modelId }));
    for (const chunk of chunked(rows, 100)) {
      await db.insert(uvmTable).values(chunk).onConflictDoNothing();
    }
  }
  return { modelIds: saved, prunedModelIds };
}

export async function deleteDeptAssignment(deptId: string): Promise<void> {
  const tid = requiredTenant();
  const db = getIamDb();
  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
}

export { DEPT_PREFIX, deptKey };
