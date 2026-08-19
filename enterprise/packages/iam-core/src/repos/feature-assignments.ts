/**
 * **唯一一处**分配键解析，外加一张已经退役的功能分配表。
 *
 * 可见模型、能力包、功能开关此前各自拼一遍「这个人算哪些 key」，网关那边还有第四份。
 * 拼得不一样就会出现「后台说他有、真去用被拒」这种最难查的故障，所以这里收成一个
 * 函数（resolveAssignmentKeysForUser），各处只管拿到键集合之后查自己的表。这部分仍在用。
 *
 * ⚠️ enterprise_feature_assignments 这张表已经没有任何运行时再查了。联网搜索和深度研究
 * 现在是能力包的成员（`feature:web_search` / `feature:deep_research`），判定在 web-portal
 * 的 isPlatformFeatureAllowedForUser。listFeatureAssignments / replaceFeatureAssignments /
 * isFeatureAllowedForUser 一并没有调用方了——**不要拿它们做新的开关**：写进去不会影响
 * 任何人能不能用，只会得到一个「保存成功」。表和函数暂留，是因为它是老部署里「谁有搜索」
 * 的最后一份记录，删表得单独走一次迁移。
 */

import { enterpriseFeatureAssignments as pgTable } from "@agenticx/db-schema";
import { and, eq, inArray } from "drizzle-orm";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { listDepartmentAncestorIds } from "./departments";
import {
  mysqlDeleteFeatureAssignments,
  mysqlInsertFeatureAssignments,
  mysqlListFeatureAssignments,
} from "./mysql/feature-assignments";
import { groupAssignmentKey, listUserGroupIdsForUser } from "./user-groups";

/** 分配给全员的固定 key。 */
export const ALL_MEMBERS_ASSIGNMENT_KEY = "all";
export const DEPT_ASSIGNMENT_PREFIX = "dept:";

/** 目前有功能开关的两项。新增一项时只在这里加，表结构不动。 */
export const ASSIGNABLE_FEATURES = ["web_search", "deep_research"] as const;
export type AssignableFeature = (typeof ASSIGNABLE_FEATURES)[number];

export function isAssignableFeature(value: unknown): value is AssignableFeature {
  return typeof value === "string" && (ASSIGNABLE_FEATURES as readonly string[]).includes(value);
}

export function deptAssignmentKey(deptId: string): string {
  return `${DEPT_ASSIGNMENT_PREFIX}${String(deptId ?? "").trim()}`;
}

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

/**
 * 一个用户名下所有生效的分配键：全员 + 本人 + 邮箱 + 部门链到根 + 所属用户组。
 *
 * 部门链从直属取到根——上级分配的东西，下级成员同样拿得到。用户组取并集——属于
 * 多个组只会多拿，不会少拿。
 */
export async function resolveAssignmentKeysForUser(
  tenantId: string,
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<string[]> {
  const keys = new Set<string>([ALL_MEMBERS_ASSIGNMENT_KEY]);
  const id = String(userId ?? "").trim();
  if (id) keys.add(id);
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (normalizedEmail) keys.add(`email:${normalizedEmail}`);
  if (deptId) {
    for (const ancestor of await listDepartmentAncestorIds(tenantId, deptId)) {
      keys.add(deptAssignmentKey(ancestor));
    }
  }
  // 组表尚未建好的租户不该因此失去访问，只是没有组维度的分配。
  const groupIds = await listUserGroupIdsForUser(tenantId, id).catch(() => [] as string[]);
  for (const groupId of groupIds) keys.add(groupAssignmentKey(groupId));
  return [...keys];
}

export async function listFeatureAssignments(
  tenantId: string,
  feature: AssignableFeature,
): Promise<string[]> {
  const rows = isMysql()
    ? await mysqlListFeatureAssignments(tenantId, feature)
    : await getIamDb()
        .select({ assignmentKey: pgTable.assignmentKey })
        .from(pgTable)
        .where(and(eq(pgTable.tenantId, tenantId), eq(pgTable.feature, feature)));
  return [...new Set(rows.map((row) => row.assignmentKey))].sort();
}

/** 整体替换。让前端 diff 两个集合再发细粒度调用，正是「只改了一半」的成因。 */
export async function replaceFeatureAssignments(
  tenantId: string,
  feature: AssignableFeature,
  assignmentKeys: readonly string[],
): Promise<string[]> {
  const wanted = [
    ...new Set(assignmentKeys.map((key) => String(key ?? "").trim()).filter(Boolean)),
  ].sort();
  const now = new Date();
  if (isMysql()) {
    await mysqlDeleteFeatureAssignments(tenantId, feature);
    await mysqlInsertFeatureAssignments(
      wanted.map((assignmentKey) => ({
        tenantId,
        feature,
        assignmentKey,
        createdAt: now,
        updatedAt: now,
      })),
    );
    return wanted;
  }
  const db = getIamDb();
  await db.delete(pgTable).where(and(eq(pgTable.tenantId, tenantId), eq(pgTable.feature, feature)));
  if (wanted.length > 0) {
    await db
      .insert(pgTable)
      .values(
        wanted.map((assignmentKey) => ({
          tenantId,
          feature,
          assignmentKey,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing();
  }
  return wanted;
}

/**
 * 这个人能不能用这项功能。
 *
 * **一行都没有 = 全员可用。** 这类功能是基础能力，管理员打开总开关就是想让大家用；
 * 要求逐个分配才能用，等于每进一个新人都得记得回来点一次，而漏点的表现是「他那边
 * 就是没有」——最难查的一类。
 */
export function isFeatureAllowedByAssignments(
  assignments: readonly string[],
  userKeys: readonly string[],
): boolean {
  if (assignments.length === 0) return true;
  const keys = new Set(userKeys);
  return assignments.some((key) => keys.has(key));
}

/** 便捷组合：查分配 + 解析该用户的键 + 判定。 */
export async function isFeatureAllowedForUser(
  tenantId: string,
  feature: AssignableFeature,
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<boolean> {
  const [assignments, keys] = await Promise.all([
    listFeatureAssignments(tenantId, feature),
    resolveAssignmentKeysForUser(tenantId, userId, email, deptId),
  ]);
  return isFeatureAllowedByAssignments(assignments, keys);
}
