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

/**
 * 组不再带月额度。
 *
 * 那个字段从来不是继承：网关的额度解析只看 users / departments / defaults，从没读过
 * groups；管理端的 applyUserGroupPolicy 只是在保存时把数字盖到每个成员的个人额度上，
 * 而「来源：用户组」那个标签是靠「个人值恰好等于组值」猜出来的——两个组填了同一个
 * 数字就会猜错。留着一个看起来像继承、实际只是上次盖章值的字段，比没有更糟。
 */
export type UserGroupRecord = Omit<UserGroup, "monthlyTokens"> & { id: string };

export type UserGroupInput = {
  name: string;
  description?: string | null;
  memberIds?: string[];
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
function recordFrom(row: UserGroupRow, modelIds: string[]): UserGroupRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    memberIds: row.memberIds,
    modelIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureMigrated(tenantId: string): Promise<void> {
  await migrateLegacyUserGroupsIfNeeded(tenantId);
  await migrateLegacyGroupModelsIfNeeded(tenantId);
}

export async function listUserGroups(tenantId: string): Promise<UserGroupRecord[]> {
  await ensureMigrated(tenantId);
  const rows = await listGroupRows(tenantId);
  const models = await listGroupModelIds(tenantId, rows.map((row) => row.id));
  return rows.map((row) => recordFrom(row, models.get(row.id) ?? []));
}

export async function getUserGroup(tenantId: string, id: string): Promise<UserGroupRecord | null> {
  await ensureMigrated(tenantId);
  const row = await getGroupRow(tenantId, id);
  if (!row) return null;
  const models = await listGroupModelIds(tenantId, [id]);
  return recordFrom(row, models.get(id) ?? []);
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


export async function createUserGroup(tenantId: string, input: UserGroupInput): Promise<UserGroupRecord> {
  await ensureMigrated(tenantId);
  const row = await createGroupRow(tenantId, {
    name: normalizeName(input.name),
    description: normalizeDescription(input.description) ?? null,
    memberIds: normalizeIds(input.memberIds),
  });
  const modelIds = await setGroupModelIds(tenantId, row.id, normalizeIds(input.modelIds));
  return recordFrom(row, modelIds);
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
  return recordFrom(row, modelIds);
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

/** 删组。顺手清掉配额 JSON 里可能还留着的旧条目——新建/更新已经不再往那里写了。 */
export async function deleteUserGroup(tenantId: string, id: string): Promise<boolean> {
  const removed = await deleteGroupRow(tenantId, id);
  if (!removed) return false;
  const config = await getQuotaConfig(tenantId);
  const groups = groupsOf(config);
  delete groups[id];
  await setQuotaConfig({ groups, updatedAt: config.updatedAt }, tenantId);
  return true;
}
