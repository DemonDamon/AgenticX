/**
 * 用户组仓库（PG / MySQL 双方言）。
 *
 * 用户组此前只是 `enterprise_runtime_token_quotas.config.groups` 这个 JSON 里的一个
 * 字段。提成表之后有三个具体好处：删用户由外键级联清理成员身份（原来要靠一段全表
 * 改写 JSON 的代码）、能力包可以用 `group:<ulid>` 直接引用、成员查询走索引而不是
 * 把整份配额文档读出来在内存里过滤。
 *
 * 组的语义是**授予**：属于多个组取并集。部门仍是上限（级联收窄），个人仍只能关。
 */

import {
  enterpriseRuntimeTokenQuotas as pgQuotas,
  enterpriseUserGroupMembers as pgMembers,
  enterpriseUserGroups as pgGroups,
  users as pgUsers,
} from "@agenticx/db-schema";
import { and, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import {
  mysqlDeleteUserGroup,
  mysqlInsertUserGroup,
  mysqlListExistingUserIds,
  mysqlListGroupIdsForUser,
  mysqlListMembers,
  mysqlReadQuotaConfig,
  mysqlListUserGroups,
  mysqlReplaceMembers,
  mysqlUpdateUserGroup,
} from "./mysql/user-groups";

/** 分配键前缀，与 `all` / `dept:<id>` / 用户 ulid 并列。 */
export const GROUP_ASSIGNMENT_PREFIX = "group:";

export function groupAssignmentKey(groupId: string): string {
  return `${GROUP_ASSIGNMENT_PREFIX}${String(groupId ?? "").trim()}`;
}

export type UserGroupRow = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type UserGroupWriteInput = {
  name: string;
  description?: string | null;
  memberIds?: string[];
};

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

function normalizeIds(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function normalizeName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("name is required");
  if (name.length > 64) throw new Error("name must be at most 64 characters");
  return name;
}

function normalizeDescription(value: unknown): string {
  const description = String(value ?? "").trim();
  if (description.length > 240) throw new Error("description must be at most 240 characters");
  return description;
}

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

export async function listUserGroups(tenantId: string): Promise<UserGroupRow[]> {
  const groups = isMysql()
    ? await mysqlListUserGroups(tenantId)
    : await getIamDb().select().from(pgGroups).where(eq(pgGroups.tenantId, tenantId));
  const ids = groups.map((row) => row.id);
  const memberRows = ids.length
    ? isMysql()
      ? await mysqlListMembers(ids)
      : await getIamDb().select().from(pgMembers).where(inArray(pgMembers.groupId, ids))
    : [];
  const byGroup = new Map<string, string[]>();
  for (const row of memberRows) {
    const list = byGroup.get(row.groupId) ?? [];
    list.push(row.userId);
    byGroup.set(row.groupId, list);
  }
  return groups
    .map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description ?? "",
      memberIds: (byGroup.get(row.id) ?? []).sort(),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getUserGroup(tenantId: string, id: string): Promise<UserGroupRow | null> {
  const groups = await listUserGroups(tenantId);
  return groups.find((group) => group.id === id) ?? null;
}

/** 该用户所属的组 id。能力包解析分配键时按这个展开成 `group:<id>`。 */
export async function listUserGroupIdsForUser(
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const id = String(userId ?? "").trim();
  if (!id) return [];
  const rows = isMysql()
    ? await mysqlListGroupIdsForUser(tenantId, id)
    : await getIamDb()
        .select({ groupId: pgMembers.groupId })
        .from(pgMembers)
        .innerJoin(pgGroups, eq(pgGroups.id, pgMembers.groupId))
        .where(and(eq(pgGroups.tenantId, tenantId), eq(pgMembers.userId, id)));
  return [...new Set(rows.map((row) => row.groupId))].sort();
}

async function replaceMembers(groupId: string, memberIds: string[]): Promise<void> {
  const now = new Date();
  const rows = memberIds.map((userId) => ({ groupId, userId, createdAt: now, updatedAt: now }));
  if (isMysql()) {
    await mysqlReplaceMembers(groupId, rows);
    return;
  }
  const db = getIamDb();
  await db.delete(pgMembers).where(eq(pgMembers.groupId, groupId));
  if (rows.length > 0) await db.insert(pgMembers).values(rows);
}

export async function createUserGroup(
  tenantId: string,
  input: UserGroupWriteInput,
): Promise<UserGroupRow> {
  const id = ulid();
  const now = new Date();
  const row = {
    id,
    tenantId,
    name: normalizeName(input.name),
    description: normalizeDescription(input.description),
    createdAt: now,
    updatedAt: now,
  };
  if (isMysql()) await mysqlInsertUserGroup(row);
  else await getIamDb().insert(pgGroups).values(row);
  await replaceMembers(id, normalizeIds(input.memberIds));
  const created = await getUserGroup(tenantId, id);
  if (!created) throw new Error("create failed");
  return created;
}

export async function updateUserGroup(
  tenantId: string,
  id: string,
  input: Partial<UserGroupWriteInput>,
): Promise<UserGroupRow> {
  const existing = await getUserGroup(tenantId, id);
  if (!existing) throw new Error("user group not found");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = normalizeName(input.name);
  if (input.description !== undefined) patch.description = normalizeDescription(input.description);
  if (isMysql()) await mysqlUpdateUserGroup(tenantId, id, patch);
  else
    await getIamDb()
      .update(pgGroups)
      .set(patch)
      .where(and(eq(pgGroups.tenantId, tenantId), eq(pgGroups.id, id)));
  // 成员整体替换：让前端 diff 两个集合再发细粒度调用，正是「组只改了一半」的成因。
  if (input.memberIds !== undefined) await replaceMembers(id, normalizeIds(input.memberIds));
  const updated = await getUserGroup(tenantId, id);
  if (!updated) throw new Error("user group not found");
  return updated;
}

export async function deleteUserGroup(tenantId: string, id: string): Promise<boolean> {
  const existing = await getUserGroup(tenantId, id);
  if (!existing) return false;
  if (isMysql()) await mysqlDeleteUserGroup(tenantId, id);
  else
    await getIamDb()
      .delete(pgGroups)
      .where(and(eq(pgGroups.tenantId, tenantId), eq(pgGroups.id, id)));
  return true;
}

/**
 * 把配额 JSON 里的用户组一次性搬进表。
 *
 * 沿用原来的组 id，不重新生成——`quotaConfig.groups[<id>]` 里还留着 monthlyTokens
 * 与 modelIds，这一轮不动它们，id 一致才能继续对得上。
 *
 * 成员按 users 表过滤：JSON 里没有外键，早就可能存着已删用户的 id，直接插会撞外键。
 */
export async function migrateLegacyUserGroupsIfNeeded(tenantId: string): Promise<{
  action: "imported" | "skipped";
  count: number;
  reason?: string;
}> {
  const existing = await listUserGroups(tenantId);
  if (existing.length > 0) return { action: "skipped", count: 0, reason: "tables already populated" };

  const legacy = await readLegacyGroups(tenantId);
  const entries = Object.entries(legacy);
  if (entries.length === 0) return { action: "skipped", count: 0, reason: "no legacy groups" };

  const knownUserIds = await listExistingUserIds(
    tenantId,
    [...new Set(entries.flatMap(([, group]) => normalizeIds(group.memberIds)))],
  );
  const now = new Date();
  let imported = 0;
  for (const [id, group] of entries) {
    const name = String(group.name ?? "").trim();
    if (!name) continue;
    const row = {
      id,
      tenantId,
      name: name.slice(0, 64),
      description: String(group.description ?? "").slice(0, 240),
      createdAt: now,
      updatedAt: now,
    };
    if (isMysql()) await mysqlInsertUserGroup(row);
    else await getIamDb().insert(pgGroups).values(row).onConflictDoNothing();
    await replaceMembers(id, normalizeIds(group.memberIds).filter((uid) => knownUserIds.has(uid)));
    imported += 1;
  }
  return { action: "imported", count: imported };
}

type LegacyGroup = { name?: string; description?: string; memberIds?: string[] };

async function readLegacyGroups(tenantId: string): Promise<Record<string, LegacyGroup>> {
  const rows = isMysql()
    ? await mysqlReadQuotaConfig(tenantId)
    : await getIamDb()
        .select({ config: pgQuotas.config })
        .from(pgQuotas)
        .where(eq(pgQuotas.tenantId, tenantId))
        .limit(1);
  const config = rows[0]?.config as Record<string, unknown> | undefined;
  const groups = config?.groups;
  return groups && typeof groups === "object" && !Array.isArray(groups)
    ? (groups as Record<string, LegacyGroup>)
    : {};
}

async function listExistingUserIds(
  tenantId: string,
  candidateIds: readonly string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const rows = isMysql()
    ? await mysqlListExistingUserIds(tenantId, candidateIds)
    : await getIamDb()
        .select({ id: pgUsers.id })
        .from(pgUsers)
        .where(and(eq(pgUsers.tenantId, tenantId), inArray(pgUsers.id, [...candidateIds])));
  return new Set(rows.map((row) => row.id));
}
