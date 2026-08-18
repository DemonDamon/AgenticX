import {
  createUserGroup as createGroupRow,
  deleteUserGroup as deleteGroupRow,
  getUserGroup as getGroupRow,
  listUserGroups as listGroupRows,
  migrateLegacyUserGroupsIfNeeded,
  updateUserGroup as updateGroupRow,
  type UserGroupRow,
} from "@agenticx/iam-core";
import {
  getQuotaConfig,
  setQuotaConfig,
  type QuotaConfig,
  type UserGroup,
} from "./token-quota-store";

export type UserGroupRecord = UserGroup & { id: string };

export type UserGroupInput = {
  name: string;
  description?: string | null;
  memberIds?: string[];
  monthlyTokens?: number;
  modelIds?: string[];
};

export type UserGroupPolicyMember = {
  id: string;
};

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id).trim()).filter(Boolean))];
}

function groupsOf(config: QuotaConfig): Record<string, UserGroup> {
  return { ...(config.groups ?? {}) };
}

function normalizeMonthlyTokens(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("monthlyTokens must be a non-negative number");
  }
  return Math.floor(parsed);
}

function normalizeName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("name is required");
  if (name.length > 64) throw new Error("name must be at most 64 characters");
  return name;
}

function normalizeDescription(value: unknown): string | undefined {
  if (value == null) return undefined;
  const description = String(value).trim();
  if (description.length > 240) throw new Error("description must be at most 240 characters");
  return description || undefined;
}

/**
 * 组的身份与成员来自 enterprise_user_groups / _members 两张表；额度与模型范围这一轮
 * 仍留在配额 JSON 里，按同一个 id 拼回来。
 *
 * 写入时把成员投影回 JSON，是因为可见模型那条路径（web-portal 的
 * groupModelPolicyFromQuotaConfig）目前还直接读 JSON 的 memberIds。投影不同步会让
 * 「组里有这个人」和「这个人能看到组里的模型」对不上，所以两处必须一起写。
 */
function recordFrom(row: UserGroupRow, legacy: UserGroup | undefined): UserGroupRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    memberIds: row.memberIds,
    monthlyTokens: legacy?.monthlyTokens ?? 0,
    modelIds: legacy?.modelIds ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listUserGroups(tenantId: string): Promise<UserGroupRecord[]> {
  await migrateLegacyUserGroupsIfNeeded(tenantId);
  const [rows, config] = await Promise.all([listGroupRows(tenantId), getQuotaConfig(tenantId)]);
  const legacy = groupsOf(config);
  return rows.map((row) => recordFrom(row, legacy[row.id]));
}

export async function getUserGroup(tenantId: string, id: string): Promise<UserGroupRecord | null> {
  await migrateLegacyUserGroupsIfNeeded(tenantId);
  const [row, config] = await Promise.all([getGroupRow(tenantId, id), getQuotaConfig(tenantId)]);
  return row ? recordFrom(row, groupsOf(config)[id]) : null;
}

/** 把一个组的当前形态写回配额 JSON，供尚未迁移的可见模型/额度路径继续读。 */
async function projectToQuotaConfig(
  tenantId: string,
  id: string,
  next: Omit<UserGroupRecord, "id">,
): Promise<void> {
  const config = await getQuotaConfig(tenantId);
  const groups = groupsOf(config);
  const { description, ...rest } = next;
  groups[id] = { ...rest, ...(description ? { description } : {}) };
  await setQuotaConfig({ groups, updatedAt: config.updatedAt }, tenantId);
}

export type UserGroupModelSource = Pick<UserGroupRecord, "id" | "name"> & {
  modelIds: string[];
};

export function groupModelSourcesForUser(
  groups: readonly UserGroupRecord[],
  userId: string,
): UserGroupModelSource[] {
  return groups
    .filter((group) => group.memberIds.includes(userId) && group.modelIds.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((group) => ({ id: group.id, name: group.name, modelIds: [...group.modelIds] }));
}

export function groupModelIdsForUser(groups: readonly UserGroupRecord[], userId: string): string[] {
  return [...new Set(groupModelSourcesForUser(groups, userId).flatMap((group) => group.modelIds))];
}

export function groupModelExclusionsForUser(config: QuotaConfig, userId: string): string[] {
  return normalizeIds(config.modelExclusions?.[userId]);
}

export async function setUserGroupModelExclusions(
  tenantId: string,
  userId: string,
  modelIds: unknown,
): Promise<string[]> {
  const config = await getQuotaConfig(tenantId);
  const exclusions = { ...(config.modelExclusions ?? {}) };
  const normalized = normalizeIds(modelIds);
  if (normalized.length > 0) exclusions[userId] = normalized;
  else delete exclusions[userId];
  await setQuotaConfig({ modelExclusions: exclusions, updatedAt: config.updatedAt }, tenantId);
  return normalized;
}

export function groupQuotaSourceForUser(
  groups: readonly UserGroupRecord[],
  userId: string,
): UserGroupRecord | null {
  return (
    groups
      .filter((group) => group.memberIds.includes(userId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export async function createUserGroup(tenantId: string, input: UserGroupInput): Promise<UserGroupRecord> {
  await migrateLegacyUserGroupsIfNeeded(tenantId);
  const row = await createGroupRow(tenantId, {
    name: normalizeName(input.name),
    description: normalizeDescription(input.description) ?? null,
    memberIds: normalizeIds(input.memberIds),
  });
  const record = recordFrom(row, {
    name: row.name,
    memberIds: row.memberIds,
    monthlyTokens: normalizeMonthlyTokens(input.monthlyTokens, 0),
    modelIds: normalizeIds(input.modelIds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  const { id, ...rest } = record;
  await projectToQuotaConfig(tenantId, id, rest);
  return record;
}

export async function updateUserGroup(
  tenantId: string,
  id: string,
  input: Partial<UserGroupInput>,
): Promise<UserGroupRecord> {
  const current = await getUserGroup(tenantId, id);
  if (!current) throw new Error("user group not found");

  const row = await updateGroupRow(tenantId, id, {
    ...(input.name === undefined ? {} : { name: normalizeName(input.name) }),
    ...(input.description === undefined
      ? {}
      : { description: normalizeDescription(input.description) ?? null }),
    ...(input.memberIds === undefined ? {} : { memberIds: normalizeIds(input.memberIds) }),
  });
  const record = recordFrom(row, {
    name: row.name,
    memberIds: row.memberIds,
    monthlyTokens: normalizeMonthlyTokens(input.monthlyTokens, current.monthlyTokens),
    modelIds: input.modelIds === undefined ? current.modelIds : normalizeIds(input.modelIds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  const { id: _id, ...rest } = record;
  await projectToQuotaConfig(tenantId, id, rest);
  return record;
}

/** 保存用户组的每人额度；模型范围始终在运行时由用户组派生。 */
export async function applyUserGroupPolicy(
  tenantId: string,
  group: UserGroupRecord,
  members: UserGroupPolicyMember[],
): Promise<void> {
  if (members.length === 0) return;

  const config = await getQuotaConfig(tenantId);
  const users = { ...config.users };
  for (const member of members) {
    users[member.id] = {
      ...users[member.id],
      monthlyTokens: group.monthlyTokens,
      poolScope: "",
      action: "block",
    };
  }
  await setQuotaConfig({ users, updatedAt: config.updatedAt }, tenantId);
}

/**
 * 删用户后同步投影。
 *
 * 表那边由外键级联删掉了成员行，这里只需要把配额 JSON 里的残留成员刷掉——JSON 没有
 * 外键，删 IAM 行级联不到它。
 */
export async function removeUserFromAllGroups(tenantId: string, userId: string): Promise<number> {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return 0;

  const config = await getQuotaConfig(tenantId);
  const groups = groupsOf(config);
  const updatedAt = new Date().toISOString();
  let changedGroups = 0;
  for (const [id, group] of Object.entries(groups)) {
    if (!group.memberIds.includes(normalizedUserId)) continue;
    groups[id] = {
      ...group,
      memberIds: group.memberIds.filter((memberId) => memberId !== normalizedUserId),
      updatedAt,
    };
    changedGroups += 1;
  }

  if (changedGroups > 0) {
    await setQuotaConfig({ groups, updatedAt: config.updatedAt }, tenantId);
  }
  return changedGroups;
}

export async function deleteUserGroup(tenantId: string, id: string): Promise<boolean> {
  const removed = await deleteGroupRow(tenantId, id);
  if (!removed) return false;
  const config = await getQuotaConfig(tenantId);
  const groups = groupsOf(config);
  delete groups[id];
  await setQuotaConfig({ groups, updatedAt: config.updatedAt }, tenantId);
  return true;
}
