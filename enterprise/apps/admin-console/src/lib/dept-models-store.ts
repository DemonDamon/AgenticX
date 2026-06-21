/**
 * admin-console · 部门 ↔ 模型可见性映射（PostgreSQL）。
 * assignment_key 使用 `dept:<deptId>` 写入 enterprise_runtime_user_visible_models。
 */

import { enterpriseRuntimeUserVisibleModels as uvmTable } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, eq } from "drizzle-orm";

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

export async function getDeptModels(deptId: string): Promise<string[]> {
  const tid = requiredTenant();
  const db = getIamDb();
  const rows = await db
    .select({ modelId: uvmTable.modelId })
    .from(uvmTable)
    .where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
  return [...new Set(rows.map((r) => r.modelId))];
}

export async function setDeptModels(deptId: string, modelIds: string[]): Promise<string[]> {
  const tid = requiredTenant();
  const db = getIamDb();
  const unique = Array.from(new Set(modelIds.map((m) => m.trim()).filter(Boolean)));
  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
  if (unique.length === 0) return [];
  const rows = unique.map((modelId) => ({ tenantId: tid, assignmentKey: deptKey(deptId), modelId }));
  for (const chunk of chunked(rows, 100)) {
    await db.insert(uvmTable).values(chunk).onConflictDoNothing();
  }
  return [...unique];
}

export async function deleteDeptAssignment(deptId: string): Promise<void> {
  const tid = requiredTenant();
  const db = getIamDb();
  await db.delete(uvmTable).where(and(eq(uvmTable.tenantId, tid), eq(uvmTable.assignmentKey, deptKey(deptId))));
}

export { DEPT_PREFIX, deptKey };
