import { listAdminUsers, listDepartmentsFlat, type AdminUserDto } from "@agenticx/iam-core";
import { queryMetering } from "./metering-service";
import { getQuotaConfig, type QuotaRule } from "./token-quota-store";
import { listUserGroups, type UserGroupRecord } from "./user-groups-store";

export type OverviewMember = Pick<AdminUserDto, "id" | "displayName" | "email" | "deptId"> & {
  usedTokens: number;
};

export type ModelUsage = { model: string; tokens: number };

export type GroupQuotaOverview = UserGroupRecord & {
  usedTokens: number;
  unlimited: boolean;
  memberCount: number;
  members: OverviewMember[];
  topModels: ModelUsage[];
};

export type UserQuotaOverview = OverviewMember & {
  monthlyTokens: number;
  unlimited: boolean;
  inherited: boolean;
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

function modelsFor(memberIds: string[], usage: UsageIndex): ModelUsage[] {
  const totals = new Map<string, number>();
  for (const memberId of memberIds) {
    for (const [model, tokens] of usage.byUserModel.get(memberId) ?? []) {
      totals.set(model, (totals.get(model) ?? 0) + tokens);
    }
  }
  return [...totals.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .slice(0, 4);
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

function ruleForUser(config: Awaited<ReturnType<typeof getQuotaConfig>>, user: AdminUserDto): { rule?: QuotaRule; inherited: boolean } {
  const personal = config.users[user.id] as QuotaRule | undefined;
  if (personal) return { rule: personal, inherited: false };
  return { rule: roleRule(config, isAdministrator(user) ? "admin" : "staff"), inherited: true };
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

export async function loadGroupQuotaOverview(tenantId: string): Promise<{
  groups: GroupQuotaOverview[];
  organization: OrganizationNode[];
  users: OverviewMember[];
}> {
  const [groups, users, departments] = await Promise.all([
    listUserGroups(),
    listAllUsers(tenantId),
    listDepartmentsFlat(tenantId),
  ]);
  const usage = await buildUsageIndex(users.map((user) => user.id));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const userDirectory = membersFor(users.map((user) => user.id), usersById, usage);
  const groupsWithUsage = groups.map((group) => {
    const members = membersFor(group.memberIds, usersById, usage);
    return {
      ...group,
      usedTokens: members.reduce((total, member) => total + member.usedTokens, 0),
      unlimited: group.monthlyTokens <= 0,
      memberCount: members.length,
      members,
      topModels: modelsFor(group.memberIds, usage),
    } satisfies GroupQuotaOverview;
  });

  return { groups: groupsWithUsage, organization: organizationFrom(users, departments), users: userDirectory };
}

export async function loadUserQuotaOverview(tenantId: string): Promise<UserQuotaOverview[]> {
  const [users, config, groups] = await Promise.all([listAllUsers(tenantId), getQuotaConfig(), listUserGroups()]);
  const usage = await buildUsageIndex(users.map((user) => user.id));
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
      const selected = ruleForUser(config, user);
      const monthlyTokens = Math.max(0, Number(selected.rule?.monthlyTokens ?? 0));
      return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        deptId: user.deptId,
        usedTokens: usage.byUser.get(user.id) ?? 0,
        monthlyTokens,
        unlimited: monthlyTokens <= 0,
        inherited: selected.inherited,
        groupNames: groupNamesByUser.get(user.id) ?? [],
        topModels: modelsFor([user.id], usage),
      } satisfies UserQuotaOverview;
    })
    .sort((a, b) => b.usedTokens - a.usedTokens || a.displayName.localeCompare(b.displayName));
}
