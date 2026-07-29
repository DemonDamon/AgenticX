import { ulid } from "ulid";
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

function asRecord(id: string, group: UserGroup): UserGroupRecord {
  return { id, ...group };
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

export async function listUserGroups(): Promise<UserGroupRecord[]> {
  const config = await getQuotaConfig();
  return Object.entries(groupsOf(config))
    .map(([id, group]) => asRecord(id, group))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getUserGroup(id: string): Promise<UserGroupRecord | null> {
  const config = await getQuotaConfig();
  const group = groupsOf(config)[id];
  return group ? asRecord(id, group) : null;
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

export async function setUserGroupModelExclusions(userId: string, modelIds: unknown): Promise<string[]> {
  const config = await getQuotaConfig();
  const exclusions = { ...(config.modelExclusions ?? {}) };
  const normalized = normalizeIds(modelIds);
  if (normalized.length > 0) exclusions[userId] = normalized;
  else delete exclusions[userId];
  await setQuotaConfig({ ...config, modelExclusions: exclusions });
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

export async function createUserGroup(input: UserGroupInput): Promise<UserGroupRecord> {
  const config = await getQuotaConfig();
  const id = ulid();
  const now = new Date().toISOString();
  const description = normalizeDescription(input.description);
  const group: UserGroup = {
    name: normalizeName(input.name),
    ...(description ? { description } : {}),
    memberIds: normalizeIds(input.memberIds),
    monthlyTokens: normalizeMonthlyTokens(input.monthlyTokens, 0),
    modelIds: normalizeIds(input.modelIds),
    createdAt: now,
    updatedAt: now,
  };
  const groups = groupsOf(config);
  groups[id] = group;
  await setQuotaConfig({ ...config, groups });
  return asRecord(id, group);
}

export async function updateUserGroup(id: string, input: Partial<UserGroupInput>): Promise<UserGroupRecord> {
  const config = await getQuotaConfig();
  const groups = groupsOf(config);
  const current = groups[id];
  if (!current) throw new Error("user group not found");

  const description = input.description === undefined ? current.description : normalizeDescription(input.description);
  const next: UserGroup = {
    ...current,
    name: input.name === undefined ? current.name : normalizeName(input.name),
    memberIds: input.memberIds === undefined ? current.memberIds : normalizeIds(input.memberIds),
    monthlyTokens: normalizeMonthlyTokens(input.monthlyTokens, current.monthlyTokens),
    modelIds: input.modelIds === undefined ? current.modelIds : normalizeIds(input.modelIds),
    updatedAt: new Date().toISOString(),
  };
  if (description) next.description = description;
  else delete next.description;
  groups[id] = next;
  await setQuotaConfig({ ...config, groups });
  return asRecord(id, next);
}

/** 保存用户组的每人额度；模型范围始终在运行时由用户组派生。 */
export async function applyUserGroupPolicy(
  group: UserGroupRecord,
  members: UserGroupPolicyMember[],
): Promise<void> {
  if (members.length === 0) return;

  const config = await getQuotaConfig();
  const users = { ...config.users };
  for (const member of members) {
    users[member.id] = {
      ...users[member.id],
      monthlyTokens: group.monthlyTokens,
      poolScope: "",
      action: "block",
    };
  }
  await setQuotaConfig({ ...config, users });
}

export async function deleteUserGroup(id: string): Promise<boolean> {
  const config = await getQuotaConfig();
  const groups = groupsOf(config);
  if (!groups[id]) return false;
  delete groups[id];
  await setQuotaConfig({ ...config, groups });
  return true;
}
