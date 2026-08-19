import {
  ALL_MEMBERS_ASSIGNMENT_KEY,
  deptAssignmentKey,
  groupAssignmentKey,
  isFeatureAllowedByAssignments,
  listAdminUsers,
  listDepartmentsFlat,
  listTenantOptOuts,
  type AdminUserDto,
} from "@agenticx/iam-core";
import { featureCapabilityId, modelIdsFromSubjects } from "@agenticx/config";
import { queryMetering } from "./metering-service";
import { getQuotaConfig, type QuotaRule } from "./token-quota-store";
import {
  groupModelIdsForUser,
  groupModelSourcesForUser,
  listUserGroups,
  type UserGroupRecord,
} from "./user-groups-store";
import { listCapabilityPacks } from "./capability-packs-store";
import { collectUserAssignmentKeys, listAllAssignments, mergeUserStoredSet } from "./user-models-store";
import {
  computeEffectiveDeptAllowed,
  computeEffectiveUserAllowed,
  mergeAssignedModelIds,
} from "./effective-models";
import { listAllEnabledModelIds } from "./model-providers-store";

export type OverviewMember = Pick<AdminUserDto, "id" | "displayName" | "email" | "deptId"> & {
  usedTokens: number;
};

export type GroupMemberOverview = OverviewMember & {
  monthlyTokens: number;
  unlimited: boolean;
  hasIndividualQuotaOverride: boolean;
  individualExtraModelIds: string[];
  excludedGroupModelIds: string[];
  hasIndividualOverride: boolean;
};

/**
 * 一项能力是「从哪来的」。卡片上要把继承和特批分开显示，靠的就是这个。
 *
 * 这个字段之所以存在得起，是因为个人的、组的、部门的分配是分开存、读时才合并的。
 * 如果改成「把组的配置批量写进每个人的记录」，写进去的那一刻就再也分不出来了。
 */
export type GrantSource = "personal" | "group" | "department" | "all";

export type GrantOrigin = { source: GrantSource; sourceLabel?: string };

export type UserModelSummary = {
  model: string;
  tokens: number;
  currentlyAllowed: boolean;
  /** 只有当前可用的模型才有来源；历史用量那几行是「用过但现在没有」，无来源可言。 */
} & Partial<GrantOrigin>;

export type UserPackSummary = { id: string; name: string } & GrantOrigin;

export type UserFeatureSummary = { enabled: boolean } & GrantOrigin;

export type GroupQuotaOverview = UserGroupRecord & {
  memberCount: number;
  members: GroupMemberOverview[];
};

export type UserQuotaOverview = OverviewMember & Pick<AdminUserDto, "status" | "phone" | "employeeNo" | "jobTitle"> & {
  departmentName?: string;
  departmentPath?: string;
  monthlyTokens: number;
  unlimited: boolean;
  inherited: boolean;
  quotaSource: "personal" | "default";
  quotaSourceLabel?: string;
  groupNames: string[];
  models: UserModelSummary[];
  packs: UserPackSummary[];
  features: { webSearch: UserFeatureSummary; deepResearch: UserFeatureSummary };
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

async function buildUsageIndex(userIds: string[], tenantId: string): Promise<UsageIndex> {
  const byUser = new Map<string, number>();
  const byUserModel = new Map<string, Map<string, number>>();
  if (userIds.length === 0) return { byUser, byUserModel };

  const result = await queryMetering(
    {
      user_id: userIds,
      start: monthStart(),
      end: new Date().toISOString(),
      group_by: ["user", "model"],
    },
    tenantId,
  );
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

function modelLabel(modelId: string): string {
  const normalized = modelId.trim();
  const separator = normalized.indexOf("/");
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

function usageMatchesModelId(usageModel: string, modelId: string): boolean {
  const normalizedUsage = usageModel.trim().toLowerCase();
  const normalizedModelId = modelId.trim().toLowerCase();
  return normalizedModelId === normalizedUsage || normalizedModelId.endsWith(`/${normalizedUsage}`);
}

/** 最具体的来源优先：个人特批 > 组授予 > 部门继承 > 全员。 */
const SOURCE_RANK: Record<GrantSource, number> = {
  personal: 0,
  group: 1,
  department: 2,
  all: 3,
};

export type OriginContext = {
  userKeys: Set<string>;
  groupNameByKey: Map<string, string>;
  deptNameByKey: Map<string, string>;
};

/**
 * 一条分配命中了这个人身上的哪个键，就按那个键报来源。
 *
 * 命中多个时报最具体的：既在「全员」里又被单独特批过，卡片该显示「特批」，因为把他
 * 移出全员范围也不会收回这一项。
 */
export function originForKeys(matched: readonly string[], ctx: OriginContext): GrantOrigin | null {
  let best: GrantOrigin | null = null;
  for (const key of matched) {
    if (!ctx.userKeys.has(key)) continue;
    const groupName = ctx.groupNameByKey.get(key);
    const deptName = ctx.deptNameByKey.get(key);
    const candidate: GrantOrigin =
      key === ALL_MEMBERS_ASSIGNMENT_KEY
        ? { source: "all" }
        : groupName !== undefined
          ? { source: "group", sourceLabel: groupName }
          : deptName !== undefined
            ? { source: "department", sourceLabel: deptName }
            : { source: "personal" };
    if (!best || SOURCE_RANK[candidate.source] < SOURCE_RANK[best.source]) best = candidate;
  }
  return best;
}

/** 模型的来源：本人自己那份 > 某个组给的 > 剩下的都是部门天花板放下来的。 */
export function modelOrigin(
  modelId: string,
  personalModelIds: ReadonlySet<string>,
  groupSources: readonly { name: string; modelIds: string[] }[],
): GrantOrigin {
  if (personalModelIds.has(modelId)) return { source: "personal" };
  const granting = groupSources.find((group) => group.modelIds.includes(modelId));
  if (granting) return { source: "group", sourceLabel: granting.name };
  return { source: "department" };
}

/** 判定平台功能所需的那部分包信息。 */
export type PackFeatureView = {
  capabilityIds: readonly string[];
  assignmentKeys: readonly string[];
  active: boolean;
};

/**
 * 这个人能不能用某项平台功能，以及是谁给的。
 *
 * 判定必须和运行时逐条对齐（web-portal 的 isPlatformFeatureAllowedForUser）：
 * 后台显示「已开通」而实际调用被拒，是最难查的一类问题。所以这里也是
 * 「没有任何包引用过 = 还没纳管 = 全员可用」，引用过之后只认 active 包的分配，
 * 本人关掉的最后减。
 *
 * 原先这一列读的是 enterprise_feature_assignments。那张表在功能并入能力包之后
 * 就没有任何运行时再查了 —— 它显示的是一套早已不生效的配置。
 */
export function featureSummary(
  capabilityId: string,
  packs: readonly PackFeatureView[],
  ctx: OriginContext,
  optOutSubjects: readonly string[] = [],
): UserFeatureSummary {
  const governed = packs.some((pack) => pack.capabilityIds.includes(capabilityId));
  if (!governed) return { enabled: true, source: "all" };
  if (optOutSubjects.includes(capabilityId)) return { enabled: false, source: "all" };
  let best: GrantOrigin | null = null;
  for (const pack of packs) {
    if (!pack.active || !pack.capabilityIds.includes(capabilityId)) continue;
    const origin = originForKeys(pack.assignmentKeys, ctx);
    if (!origin) continue;
    if (!best || SOURCE_RANK[origin.source] < SOURCE_RANK[best.source]) best = origin;
  }
  return best ? { enabled: true, ...best } : { enabled: false, source: "all" };
}

function modelsFor(
  memberIds: string[],
  usage: UsageIndex,
  allowedModelIds: readonly string[],
  originOf: (modelId: string) => GrantOrigin,
): UserModelSummary[] {
  const totals = new Map<string, number>();
  for (const memberId of memberIds) {
    for (const [model, tokens] of usage.byUserModel.get(memberId) ?? []) {
      totals.set(model, (totals.get(model) ?? 0) + tokens);
    }
  }
  const unmatchedUsage = new Map(totals);
  const availableModels = [...new Set(allowedModelIds)]
    .map((modelId) => {
      let tokens = 0;
      for (const [usageModel, usageTokens] of unmatchedUsage) {
        if (!usageMatchesModelId(usageModel, modelId)) continue;
        tokens += usageTokens;
        unmatchedUsage.delete(usageModel);
      }
      return {
        model: modelLabel(modelId),
        tokens,
        currentlyAllowed: true,
        ...originOf(modelId),
      } satisfies UserModelSummary;
    })
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
  const unavailableHistory = [...unmatchedUsage.entries()]
    .map(([model, tokens]) => ({
      model,
      tokens,
      currentlyAllowed: false,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .slice(0, 4);
  return [...availableModels, ...unavailableHistory];
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

/**
 * 额度只有两个来源：个人规则，或角色默认。
 *
 * 原来还有第三种「用户组」，但它是猜的——判据是「个人值恰好等于组值」，两个组填了
 * 同一个数字、或管理员手工填了同一个数字，都会被标成来自用户组。组本身也从没参与过
 * 网关的额度解析，所以这个来源一并去掉。
 */
function ruleForUser(
  config: Awaited<ReturnType<typeof getQuotaConfig>>,
  user: AdminUserDto,
): {
  rule?: QuotaRule;
  inherited: boolean;
  quotaSource: UserQuotaOverview["quotaSource"];
  quotaSourceLabel?: string;
} {
  const personal = config.users[user.id] as QuotaRule | undefined;
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
  optOutsByUser: Map<string, string[]>,
): GroupMemberOverview {
  const personalQuota = config.users[user.id] as QuotaRule | undefined;
  const monthlyTokens = Math.max(0, Number(personalQuota?.monthlyTokens ?? 0));
  // 组不再带额度，所以「个人额度覆盖」就是「他有个人规则」，不用再和组值比。
  const hasIndividualQuotaOverride = Boolean(personalQuota);
  const inheritedModelIds = new Set(groupModelIdsForUser(groups, user.id));
  const directModelIds = mergeUserStoredSet(assignments, collectUserAssignmentKeys(user.id, user.email)) ?? [];
  const individualExtraModelIds = directModelIds.filter((modelId) => !inheritedModelIds.has(modelId));
  const excludedGroupModelIds = modelIdsFromSubjects(optOutsByUser.get(user.id) ?? []).filter(
    (modelId: string) => inheritedModelIds.has(modelId),
  );
  return {
    ...user,
    monthlyTokens,
    unlimited: monthlyTokens <= 0,
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
  const [groups, users, departments, config, assignments, optOutsByUser] = await Promise.all([
    listUserGroups(tenantId),
    listAllUsers(tenantId),
    listDepartmentsFlat(tenantId),
    getQuotaConfig(tenantId),
    listAllAssignments(tenantId),
    listTenantOptOuts(tenantId),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const noUsage: UsageIndex = { byUser: new Map(), byUserModel: new Map() };
  const userDirectory = membersFor(users.map((user) => user.id), usersById, noUsage);
  const groupCards = groups.map((group) => {
    const members = membersFor(group.memberIds, usersById, noUsage).map((member) =>
      groupMemberOverview(member, config, groups, assignments, optOutsByUser),
    );
    return {
      ...group,
      // Do not send legacy references to deleted IAM users back into the edit
      // form. Saving this sanitized list also repairs the persisted group.
      memberIds: members.map((member) => member.id),
      memberCount: members.length,
      members,
    } satisfies GroupQuotaOverview;
  });

  return { groups: groupCards, organization: organizationFrom(users, departments), users: userDirectory };
}

/**
 * 成员总览连同组织树一起给出。
 *
 * 树是成员列表的左栏筛选器，不是另一个页面——分开取就得让页面发两次请求，而这两份
 * 数据本来就来自同一批 users/departments。
 */
export async function loadUserQuotaOverview(
  tenantId: string,
): Promise<{ items: UserQuotaOverview[]; organization: OrganizationNode[] }> {
  const [
    users,
    config,
    groups,
    departments,
    assignments,
    allEnabledModelIds,
    optOutsByUser,
    packs,
  ] = await Promise.all([
    listAllUsers(tenantId),
    getQuotaConfig(tenantId),
    listUserGroups(tenantId),
    listDepartmentsFlat(tenantId),
    listAllAssignments(tenantId),
    listAllEnabledModelIds(),
    listTenantOptOuts(tenantId),
    listCapabilityPacks(),
  ]);
  const usage = await buildUsageIndex(users.map((user) => user.id), tenantId);
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
  // 分配表里存的是 group:<id> / dept:<id>，卡片要显示的是名字。
  const groupNameByKey = new Map(groups.map((group) => [groupAssignmentKey(group.id), group.name]));
  const deptNameByKey = new Map(
    departments.map((department) => [deptAssignmentKey(department.id), department.name]),
  );
  // capability-packs-store 内部按 process.env.DEFAULT_TENANT_ID 取租户，而这里拿的是
  // 会话租户。单租户部署下两者相同，多租户下不是——按记录自带的 tenantId 再筛一道，
  // 这段代码就不依赖那个假设了。
  const tenantPacks = packs.filter((pack) => pack.tenantId === tenantId);
  const activePacks = tenantPacks.filter((pack) => pack.status === "active");
  // 功能是否「已纳管」要连停用的包一起看，和运行时同一条规则；分配只认 active 的。
  const packFeatureViews: PackFeatureView[] = tenantPacks.map((pack) => ({
    capabilityIds: pack.capabilityIds,
    assignmentKeys: pack.assignmentKeys,
    active: pack.status === "active",
  }));
  const webSearchCapabilityId = featureCapabilityId("web_search");
  const deepResearchCapabilityId = featureCapabilityId("deep_research");

  const groupNamesByUser = new Map<string, string[]>();
  for (const group of groups) {
    for (const userId of group.memberIds) {
      const names = groupNamesByUser.get(userId) ?? [];
      names.push(group.name);
      groupNamesByUser.set(userId, names);
    }
  }

  const items = users
    .map((user) => {
      const selected = ruleForUser(config, user);
      const monthlyTokens = Math.max(0, Number(selected.rule?.monthlyTokens ?? 0));
      const department = user.deptId ? departmentsById.get(user.deptId) : undefined;
      const parentAllowedModelIds = user.deptId
        ? effectiveModelsByDepartment.get(user.deptId) ?? allEnabledModelIds
        : allEnabledModelIds;
      const storedModelIds = mergeUserStoredSet(assignments, collectUserAssignmentKeys(user.id, user.email));
      const groupSources = groupModelSourcesForUser(groups, user.id);
      const personalModelIds = new Set(storedModelIds ?? []);
      // 这个人身上所有能被分配命中的键：全员 + 本人/邮箱 + 所属组 + 部门链。
      const originContext: OriginContext = {
        userKeys: new Set([
          ALL_MEMBERS_ASSIGNMENT_KEY,
          ...collectUserAssignmentKeys(user.id, user.email),
          ...groupSources.map((group) => groupAssignmentKey(group.id)),
          ...departmentAncestorChain(user.deptId ?? "", departmentsById).map(deptAssignmentKey),
        ]),
        groupNameByKey,
        deptNameByKey,
      };
      // 个人与所属组是同一个并集；部门夹住它，个人关闭最后减。
      const assignedModelIds = mergeAssignedModelIds(
        storedModelIds,
        groupModelIdsForUser(groups, user.id),
      );
      const effectiveModelIds = computeEffectiveUserAllowed(
        parentAllowedModelIds,
        assignedModelIds,
        modelIdsFromSubjects(optOutsByUser.get(user.id) ?? []),
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
        models: modelsFor([user.id], usage, effectiveModelIds, (modelId) =>
          modelOrigin(modelId, personalModelIds, groupSources),
        ),
        packs: activePacks.flatMap((pack) => {
          const origin = originForKeys(pack.assignmentKeys, originContext);
          return origin ? [{ id: pack.id, name: pack.displayName, ...origin }] : [];
        }),
        features: {
          webSearch: featureSummary(
            webSearchCapabilityId,
            packFeatureViews,
            originContext,
            optOutsByUser.get(user.id) ?? [],
          ),
          deepResearch: featureSummary(
            deepResearchCapabilityId,
            packFeatureViews,
            originContext,
            optOutsByUser.get(user.id) ?? [],
          ),
        },
      } satisfies UserQuotaOverview;
    })
    .sort((a, b) => b.usedTokens - a.usedTokens || a.displayName.localeCompare(b.displayName));
  return { items, organization: organizationFrom(users, departments) };
}
