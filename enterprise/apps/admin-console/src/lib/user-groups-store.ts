import {
  isModelOptOutSubject,
  modelIdsFromSubjects,
  modelOptOutSubject,
} from "@agenticx/config";
import {
  createUserGroup as createGroupRow,
  deleteUserGroup as deleteGroupRow,
  getUserGroup as getGroupRow,
  listGroupModelIds,
  listUserGroups as listGroupRows,
  migrateLegacyGroupModelsIfNeeded,
  migrateLegacyUserGroupsIfNeeded,
  listUserOptOuts,
  replaceUserOptOutSubjects,
  setGroupModelIds,
  updateUserGroup as updateGroupRow,
  type UserGroupRow,
} from "@agenticx/iam-core";

export type UserGroupRecord = {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  modelIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type UserGroupInput = {
  name: string;
  description?: string | null;
  memberIds?: string[];
  modelIds?: string[];
};

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id).trim()).filter(Boolean))];
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

export async function userModelOptOuts(tenantId: string, userId: string): Promise<string[]> {
  return modelIdsFromSubjects(await listUserOptOuts(tenantId, userId));
}

export async function setUserModelOptOuts(
  tenantId: string,
  userId: string,
  modelIds: unknown,
): Promise<string[]> {
  const subjects = normalizeIds(modelIds).map(modelOptOutSubject);
  const saved = await replaceUserOptOutSubjects(tenantId, userId, subjects, isModelOptOutSubject);
  return modelIdsFromSubjects(saved);
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

export async function deleteUserGroup(tenantId: string, id: string): Promise<boolean> {
  return deleteGroupRow(tenantId, id);
}
