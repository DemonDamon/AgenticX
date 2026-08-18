import {
  createUserGroup as createGroupRow,
  deleteUserGroup as deleteGroupRow,
  getUserGroup as getGroupRow,
  listGroupModelIds,
  listUserGroups as listGroupRows,
  migrateLegacyGroupModelsIfNeeded,
  migrateLegacyUserGroupsIfNeeded,
  setGroupModelIds,
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
 * 组的身份与成员来自 enterprise_user_groups / _members，可见模型来自
 * enterprise_runtime_user_visible_models 里 key 为 `group:<id>` 的行——和个人、部门
 * 同一张表。只有月额度还留在配额 JSON 里，那属于计费，不是可见性。
 */
function recordFrom(
  row: UserGroupRow,
  modelIds: string[],
  monthlyTokens: number,
): UserGroupRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    memberIds: row.memberIds,
    monthlyTokens,
    modelIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureMigrated(tenantId: string): Promise<void> {
  await migrateLegacyUserGroupsIfNeeded(tenantId);
  await migrateLegacyGroupModelsIfNeeded(tenantId);
}

function monthlyTokensOf(config: QuotaConfig, id: string): number {
  return groupsOf(config)[id]?.monthlyTokens ?? 0;
}

export async function listUserGroups(tenantId: string): Promise<UserGroupRecord[]> {
  await ensureMigrated(tenantId);
  const [rows, config] = await Promise.all([listGroupRows(tenantId), getQuotaConfig(tenantId)]);
  const models = await listGroupModelIds(tenantId, rows.map((row) => row.id));
  return rows.map((row) => recordFrom(row, models.get(row.id) ?? [], monthlyTokensOf(config, row.id)));
}

export async function getUserGroup(tenantId: string, id: string): Promise<UserGroupRecord | null> {
  await ensureMigrated(tenantId);
  const [row, config] = await Promise.all([getGroupRow(tenantId, id), getQuotaConfig(tenantId)]);
  if (!row) return null;
  const models = await listGroupModelIds(tenantId, [id]);
  return recordFrom(row, models.get(id) ?? [], monthlyTokensOf(config, id));
}

/** 只写月额度。可见模型与成员都已在各自的表里，不再往配额 JSON 投影。 */
async function writeGroupMonthlyTokens(
  tenantId: string,
  id: string,
  name: string,
  monthlyTokens: number,
  timestamps: { createdAt: string; updatedAt: string },
): Promise<void> {
  const config = await getQuotaConfig(tenantId);
  const groups = groupsOf(config);
  groups[id] = {
    name,
    memberIds: [],
    modelIds: [],
    monthlyTokens,
    createdAt: groups[id]?.createdAt ?? timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  };
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
  await ensureMigrated(tenantId);
  const row = await createGroupRow(tenantId, {
    name: normalizeName(input.name),
    description: normalizeDescription(input.description) ?? null,
    memberIds: normalizeIds(input.memberIds),
  });
  const modelIds = await setGroupModelIds(tenantId, row.id, normalizeIds(input.modelIds));
  const monthlyTokens = normalizeMonthlyTokens(input.monthlyTokens, 0);
  await writeGroupMonthlyTokens(tenantId, row.id, row.name, monthlyTokens, row);
  return recordFrom(row, modelIds, monthlyTokens);
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
  const modelIds =
    input.modelIds === undefined
      ? current.modelIds
      : await setGroupModelIds(tenantId, id, normalizeIds(input.modelIds));
  const monthlyTokens = normalizeMonthlyTokens(input.monthlyTokens, current.monthlyTokens);
  await writeGroupMonthlyTokens(tenantId, id, row.name, monthlyTokens, row);
  return recordFrom(row, modelIds, monthlyTokens);
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
 * 删用户后清理组成员身份。
 *
 * 成员行外键到 users，数据库已经级联删掉了；这里只需要把配额 JSON 里可能残留的旧
 * memberIds 抹掉——那份数据已经不再被任何地方读取，留着只会误导下一个来看的人。
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
