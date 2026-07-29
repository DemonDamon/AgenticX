import { listAdminUsers, listDepartmentsFlat, type AdminUserDto } from "@agenticx/iam-core";
import { queryMetering } from "./metering-service";
import { getQuotaConfig, type QuotaRule } from "./token-quota-store";
import {
  groupModelExclusionsForUser,
  groupModelIdsForUser,
  groupQuotaSourceForUser,
  listUserGroups,
  type UserGroupRecord,
} from "./user-groups-store";
import { collectUserAssignmentKeys, listAllAssignments, mergeUserStoredSet } from "./user-models-store";
import {
  computeEffectiveDeptAllowed,
  computeEffectiveUserAllowed,
  isUsageModelCurrentlyAllowed,
} from "./effective-models";
import { listAllEnabledModelIds } from "./model-providers-store";

export type OverviewMember = Pick<AdminUserDto, "id" | "displayName" | "email" | "deptId"> & {
  usedTokens: number;
};

export type GroupMemberOverview = OverviewMember & {
  hasIndividualQuotaOverride: boolean;
  individualExtraModelIds: string[];
  excludedGroupModelIds: string[];
  hasIndividualOverride: boolean;
};

export type ModelUsage = { model: string; tokens: number; currentlyAllowed: boolean };

export type GroupQuotaOverview = UserGroupRecord & {
  unlimited: boolean;
  memberCount: number;
  members: GroupMemberOverview[];
};

export type UserQuotaOverview = OverviewMember & Pick<AdminUserDto, "status" | "phone" | "employeeNo" | "jobTitle"> & {
  departmentName?: string;
  departmentPath?: string;
  monthlyTokens: number;
  unlimited: boolean;
  inherited: boolean;
  quotaSource: "group" | "personal" | "default";
  quotaSourceLabel?: string;
  groupNames: string[];
  topModels: ModelUsage[];
};

export type OrganizationNode = {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  memberCount: number;
};

type UsageIndex = {
  byUser: Map<string, number>;
  byUserModel: Map<string, Map<string, number>>;
};

function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function listAllUsers(tenantId: string): Promise<AdminUserDto[]> {
  const items: AdminUserDto[] = [];
  let offset = 0;
  while (true) {
    const page = await listAdminUsers(tenantId, { limit: 200, offset });
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) return items;
  }
}

async function buildUsageIndex(userIds: string[]): Promise<UsageIndex> {
  const byUser = new Map<string, number>();
  const byUserModel = new Map<string, Map<string, number>>();
  if (userIds.length === 0) return { byUser, byUserModel };

  const result = await queryMetering({
    user_id: userIds,
    start: monthStart(),
    end: new Date().toISOString(),
    group_by: ["user", "model"],
  });
  for (const row of result.data.rows) {
    const userId = row.dims.user;
    if (!userId) continue;
    const tokens = Math.max(0, Number(row.total_tokens) || 0);
    byUser.set(userId, (byUser.get(userId) ?? 0) + tokens);
    const model = row.dims.model || "未标注模型";
    const models = byUserModel.get(userId) ?? new Map<string, number>();
    models.set(model, (models.get(model) ?? 0) + tokens);
    byUserModel.set(userId, models);
  }
  return { byUser, byUserModel };
}

function membersFor(ids: string[], usersById: Map<string, AdminUserDto>, usage: UsageIndex): OverviewMember[] {
  return ids
    .map((id) => usersById.get(id))
    .filter((user): user is AdminUserDto => Boolean(user))
    .map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      deptId: user.deptId,
      usedTokens: usage.byUser.get(user.id) ?? 0,
    }))
    .sort((a, b) => b.usedTokens - a.usedTokens || a.displayName.localeCompare(b.displayName));
}

function modelsFor(memberIds: string[], usage: UsageIndex, allowedModelIds: readonly string[]): ModelUsage[] {
  const totals = new Map<string, number>();
  for (const memberId of memberIds) {
    for (const [model, tokens] of usage.byUserModel.get(memberId) ?? []) {
      totals.set(model, (totals.get(model) ?? 0) + tokens);
    }
  }
  return [...totals.entries()]
    .map(([model, tokens]) => ({
      model,
      tokens,
      currentlyAllowed: isUsageModelCurrentlyAllowed(model, allowedModelIds),
    }))
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .slice(0, 4);
}

function departmentAncestorChain(
  deptId: string,
  departmentsById: ReadonlyMap<string, Awaited<ReturnType<typeof listDepartmentsFlat>>[number]>,
): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current = departmentsById.get(deptId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.push(current.id);
    current = current.parentId ? departmentsById.get(current.parentId) : undefined;
  }
  return chain;
}

function isAdministrator(user: AdminUserDto): boolean {
  return user.roleCodes.some((code) => {
    const normalized = code.toLowerCase();
    return [
      "super_admin",
      "owner",
      "admin",
      "dept_admin",
      "auditor",
      "sso_admin",
      "policy_admin",
      "policy_publisher",
      "policy_auditor",
    ].includes(normalized);
  });
}

function roleRule(config: Awaited<ReturnType<typeof getQuotaConfig>>, code: "admin" | "staff"): QuotaRule | undefined {
  return config.defaults.role[code] as QuotaRule | undefined;
}

function ruleForUser(
  config: Awaited<ReturnType<typeof getQuotaConfig>>,
  groups: readonly UserGroupRecord[],
  user: AdminUserDto,
): {
  rule?: QuotaRule;
  inherited: boolean;
  quotaSource: UserQuotaOverview["quotaSource"];
  quotaSourceLabel?: string;
} {
  const personal = config.users[user.id] as QuotaRule | undefined;
  const group = groupQuotaSourceForUser(groups, user.id);
  if (group && personal && Number(personal.monthlyTokens) === group.monthlyTokens) {
    return { rule: personal, inherited: true, quotaSource: "group", quotaSourceLabel: group.name };
  }
  if (personal) return { rule: personal, inherited: false, quotaSource: "personal" };
  return {
    rule: roleRule(config, isAdministrator(user) ? "admin" : "staff"),
    inherited: true,
    quotaSource: "default",
  };
}

function organizationFrom(users: AdminUserDto[], departments: Awaited<ReturnType<typeof listDepartmentsFlat>>): OrganizationNode[] {
  const memberCount = new Map<string, number>();
  for (const user of users) {
    if (user.deptId) memberCount.set(user.deptId, (memberCount.get(user.deptId) ?? 0) + 1);
  }
  return departments.map((department) => ({
    id: department.id,
    name: department.name,
    parentId: department.parentId,
    path: department.path,
    memberCount: memberCount.get(department.id) ?? 0,
  }));
}

function groupMemberOverview(
  user: OverviewMember,
  config: Awaited<ReturnType<typeof getQuotaConfig>>,
  groups: readonly UserGroupRecord[],
  assignments: Record<string, string[]>,
): GroupMemberOverview {
  const quotaSource = groupQuotaSourceForUser(groups, user.id);
  const personalQuota = config.users[user.id] as QuotaRule | undefined;
  const hasIndividualQuotaOverride = Boolean(
    personalQuota && (!quotaSource || Number(personalQuota.monthlyTokens) !== quotaSource.monthlyTokens),
  );
  const inheritedModelIds = new Set(groupModelIdsForUser(groups, user.id));
  const directModelIds = mergeUserStoredSet(assignments, collectUserAssignmentKeys(user.id, user.email)) ?? [];
  const individualExtraModelIds = directModelIds.filter((modelId) => !inheritedModelIds.has(modelId));
  const excludedGroupModelIds = groupModelExclusionsForUser(config, user.id).filter((modelId) => inheritedModelIds.has(modelId));
  return {
    ...user,
    hasIndividualQuotaOverride,
    individualExtraModelIds,
    excludedGroupModelIds,
    hasIndividualOverride: hasIndividualQuotaOverride || individualExtraModelIds.length > 0 || excludedGroupModelIds.length > 0,
  };
}

export async function loadGroupQuotaOverview(tenantId: string): Promise<{
  groups: GroupQuotaOverview[];
  organization: OrganizationNode[];
  users: OverviewMember[];
}> {
  const [groups, users, departments, config, assignments] = await Promise.all([
    listUserGroups(),
    listAllUsers(tenantId),
    listDepartmentsFlat(tenantId),
    getQuotaConfig(),
    listAllAssignments(),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const noUsage: UsageIndex = { byUser: new Map(), byUserModel: new Map() };
  const userDirectory = membersFor(users.map((user) => user.id), usersById, noUsage);
  const groupCards = groups.map((group) => {
    const members = membersFor(group.memberIds, usersById, noUsage).map((member) =>
      groupMemberOverview(member, config, groups, assignments),
    );
    return {
      ...group,
      unlimited: group.monthlyTokens <= 0,
      memberCount: members.length,
      members,
    } satisfies GroupQuotaOverview;
  });

  return { groups: groupCards, organization: organizationFrom(users, departments), users: userDirectory };
}

export async function loadUserQuotaOverview(tenantId: string): Promise<UserQuotaOverview[]> {
  const [users, config, groups, departments, assignments, allEnabledModelIds] = await Promise.all([
    listAllUsers(tenantId),
    getQuotaConfig(),
    listUserGroups(),
    listDepartmentsFlat(tenantId),
    listAllAssignments(),
    listAllEnabledModelIds(),
  ]);
  const usage = await buildUsageIndex(users.map((user) => user.id));
  const departmentsById = new Map(departments.map((department) => [department.id, department]));
  const effectiveModelsByDepartment = new Map<string, string[]>();
  for (const department of departments) {
    effectiveModelsByDepartment.set(
      department.id,
      computeEffectiveDeptAllowed({
        allEnabledIds: allEnabledModelIds,
        userVisibleMap: assignments,
        ancestorChain: departmentAncestorChain(department.id, departmentsById),
      }),
    );
  }
  const groupNamesByUser = new Map<string, string[]>();
  for (const group of groups) {
    for (const userId of group.memberIds) {
      const names = groupNamesByUser.get(userId) ?? [];
      names.push(group.name);
      groupNamesByUser.set(userId, names);
    }
  }

  return users
    .map((user) => {
      const selected = ruleForUser(config, groups, user);
      const monthlyTokens = Math.max(0, Number(selected.rule?.monthlyTokens ?? 0));
      const department = user.deptId ? departmentsById.get(user.deptId) : undefined;
      const parentAllowedModelIds = user.deptId
        ? effectiveModelsByDepartment.get(user.deptId) ?? allEnabledModelIds
        : allEnabledModelIds;
      const storedModelIds = mergeUserStoredSet(assignments, collectUserAssignmentKeys(user.id, user.email));
      const groupModelIds = groupModelIdsForUser(groups, user.id);
      const effectiveModelIds = computeEffectiveUserAllowed(
        parentAllowedModelIds,
        storedModelIds,
        groupModelIds,
        groupModelExclusionsForUser(config, user.id),
      );
      return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        deptId: user.deptId,
        ...(department ? { departmentName: department.name, departmentPath: department.path } : {}),
        status: user.status,
        phone: user.phone,
        employeeNo: user.employeeNo,
        jobTitle: user.jobTitle,
        usedTokens: usage.byUser.get(user.id) ?? 0,
        monthlyTokens,
        unlimited: monthlyTokens <= 0,
        inherited: selected.inherited,
        quotaSource: selected.quotaSource,
        ...(selected.quotaSourceLabel ? { quotaSourceLabel: selected.quotaSourceLabel } : {}),
        groupNames: groupNamesByUser.get(user.id) ?? [],
        topModels: modelsFor([user.id], usage, effectiveModelIds),
      } satisfies UserQuotaOverview;
    })
    .sort((a, b) => b.usedTokens - a.usedTokens || a.displayName.localeCompare(b.displayName));
}
