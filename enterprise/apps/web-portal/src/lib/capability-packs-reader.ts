/**
 * web-portal · 只读：当前用户实际可用的企业能力（Skill / MCP）。
 *
 * 分配范围沿用可见模型那套 key（`all` / `dept:<id>` / 用户 ulid），部门链从直属
 * 取到根 —— 上级分配的包，下级成员同样拿得到。
 *
 * 企业停用的包与能力**不会出现在结果里**，而不是带 disabled 标记下发：下发出去
 * 就等于让撤销依赖客户端守规矩，而桌面端把企业配置连同 token 缓存在本机明文
 * 配置文件里，被撤销的客户端手上握着上次拿到的全部东西。
 */

import {
  type CapabilitySurface,
  featureCapabilityId,
  groupCapabilityIdsByKind,
  isPlatformFeature,
  type PlatformFeature,
  parseCapabilityId,
  platformFeatureSurfaces,
  resolveCapabilityState,
  resolveEffectiveCapabilities,
  type CapabilityAssignment,
  type CapabilityState,
} from "@agenticx/config";
import {
  listUserOptOuts,
  resolveAssignmentKeysForUser as resolveKeysForUser,
} from "@agenticx/iam-core";
import { and, eq, inArray } from "drizzle-orm";

import {
  dialectCapabilityTables,
  requiredCapabilityTenant,
  type DialectQuery,
} from "./capability-tables";

/** 分配给全员的固定 key。 */
export const ALL_MEMBERS_ASSIGNMENT_KEY = "all";

export type PortalCapability = {
  /** `mcp:<ulid>` / `skill:<ulid>` */
  id: string;
  kind: "mcp" | "skill";
  name: string;
  displayName: string;
  /** Skill 声明的依赖能力；MCP 恒为空。 */
  requires: string[];
  version?: string;
  bundleUri?: string;
  bundleDigest?: string;
  /** MCP 专有：网关反代入口，由 desktop-capability-endpoints 在下发前补上。 */
  endpointUrl?: string;
  /** 这条能力在哪些客户端生效。 */
  surfaces: readonly CapabilitySurface[];
};

/**
 * 租户自建的 Skill/MCP 暂时两端通用。
 *
 * 真要区分得在 enterprise_skills / mcp_servers 上加列并配管理端 UI；在出现第一个
 * 单端 Skill 之前，加列只是给迁移和表单添负担。字段先立起来，调用方按 surface 过滤
 * 的路径也就通了，将来换成读列即可，过滤那一侧不用改。
 */
export const DEFAULT_CAPABILITY_SURFACES: readonly CapabilitySurface[] = ["web", "desktop"];

/** 企业已启用并分配给该用户的能力，附上用户自己那一位开关。 */
export type UserCapabilityState = PortalCapability & { state: CapabilityState };

/**
 * 一次查询的结果快照：企业侧认可的全部能力，外加用户关掉了其中哪些。
 *
 * 下发（bootstrap）只要过滤后的结果，而「我的能力」页面还要看见被自己关掉的那些，
 * 否则关掉之后就再也找不到地方打开。两者共用这一份，避免各查一遍各判一套。
 */
export type UserCapabilityView = {
  /** 企业启用且已分配、需要下发到客户端的 Skill/MCP（含被用户关闭的）。 */
  assigned: PortalCapability[];
  /** 平台功能只参与服务端授权，不伪装成 Skill/MCP 下发给 Desktop。 */
  assignedPlatformFeatures: Set<PlatformFeature>;
  /** 其中被用户自己关闭的能力 id。 */
  optOuts: Set<string>;
};

type SkillRow = {
  id: string;
  slug: string;
  displayName: string | null;
  version: string;
  bundleUri: string | null;
  bundleDigest: string | null;
  requiredCapabilities: unknown;
};
type McpRow = { id: string; name: string; displayName: string | null };

/**
 * 该用户名下所有生效的分配 key。
 *
 * 解析规则只有 iam-core 那一份：可见模型、能力包、功能开关、网关撤销判定四处必须
 * 拼出同一组 key，各拼各的就会出现「后台说他有、真去用被拒」这种最难查的不一致。
 */
export const resolveAssignmentKeysForUser = resolveKeysForUser;

function toSkillCapability(row: SkillRow): PortalCapability {
  return {
    surfaces: DEFAULT_CAPABILITY_SURFACES,
    id: `skill:${row.id}`,
    kind: "skill",
    name: row.slug,
    displayName: row.displayName || row.slug,
    requires: Array.isArray(row.requiredCapabilities)
      ? (row.requiredCapabilities as unknown[]).map(String)
      : [],
    version: row.version,
    bundleUri: row.bundleUri ?? "",
    bundleDigest: row.bundleDigest ?? "",
  };
}

function toMcpCapability(row: McpRow): PortalCapability {
  return {
    surfaces: DEFAULT_CAPABILITY_SURFACES,
    id: `mcp:${row.id}`,
    kind: "mcp",
    name: row.name,
    displayName: row.displayName || row.name,
    requires: [],
  };
}

/** 企业侧认可的能力 + 用户关闭记录，一次查完。 */
export async function loadUserCapabilityView(
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<UserCapabilityView> {
  const tenantId = requiredCapabilityTenant();
  const t = await dialectCapabilityTables();
  const query = t.db as unknown as DialectQuery;
  const assignmentKeys = await resolveAssignmentKeysForUser(tenantId, userId, email, deptId);

  // 只取 active 的包：停用的包在这一步就消失，不进入后续任何环节。
  const packRows = (await query
    .select({ id: t.packs.id })
    .from(t.packs)
    .innerJoin(t.assignments, eq(t.assignments.packId, t.packs.id))
    .where(
      and(
        eq(t.packs.tenantId, tenantId),
        eq(t.packs.status, "active"),
        inArray(t.assignments.assignmentKey, assignmentKeys),
      ),
    )) as Array<{ id: string }>;
  const packIds = [...new Set(packRows.map((row) => row.id))];
  if (packIds.length === 0) {
    return { assigned: [], assignedPlatformFeatures: new Set(), optOuts: new Set() };
  }

  const memberRows = (await query
    .select({ capabilityId: t.members.capabilityId })
    .from(t.members)
    .where(inArray(t.members.packId, packIds))) as Array<{ capabilityId: string }>;
  const candidateIds = [...new Set(memberRows.map((row) => row.capabilityId))];
  if (candidateIds.length === 0) {
    return { assigned: [], assignedPlatformFeatures: new Set(), optOuts: new Set() };
  }

  const grouped = groupCapabilityIdsByKind(candidateIds);
  // feature 没有租户行可查；能进入 grouped.feature 已经说明 id 通过了平台枚举校验。
  // 单独保留授权结果，避免既把它丢掉，又把它误下发成 Desktop 的 MCP/Skill。
  const assignedPlatformFeatures = new Set(grouped.feature.filter(isPlatformFeature));

  // 成员行只是引用；被引用的那一行自身也可能已停用，两层都要过。
  const skillRows = grouped.skill.length
    ? ((await query
        .select()
        .from(t.skills)
        .where(
          and(
            eq(t.skills.tenantId, tenantId),
            eq(t.skills.status, "active"),
            inArray(t.skills.id, grouped.skill),
          ),
        )) as SkillRow[])
    : [];
  const mcpRows = grouped.mcp.length
    ? ((await query
        .select()
        .from(t.mcp)
        .where(
          and(
            eq(t.mcp.tenantId, tenantId),
            eq(t.mcp.status, "active"),
            inArray(t.mcp.id, grouped.mcp),
          ),
        )) as McpRow[])
    : [];

  // 个人关闭记录与模型的关闭记录同在一张表；这里只取能力那部分。
  const optOuts = new Set(await listUserOptOuts(tenantId, userId));

  const assigned = [
    ...skillRows.map(toSkillCapability),
    ...mcpRows.map(toMcpCapability),
  ].sort((left, right) => left.id.localeCompare(right.id));

  return { assigned, assignedPlatformFeatures, optOuts };
}

/**
 * 这项功能有没有被任何能力包引用过。
 *
 * 只看引用，不看包的状态或分配——停用的包同样说明「管理员已经开始用能力包管这项功能了」，
 * 此时谁都拿不到是正确结果；而一个引用都没有才意味着还没纳管，该保持原样。
 */
async function isFeatureGovernedByAnyPack(capabilityId: string): Promise<boolean> {
  const tenantId = requiredCapabilityTenant();
  const t = await dialectCapabilityTables();
  const query = t.db as unknown as DialectQuery;
  const rows = (await query
    .select({ packId: t.members.packId })
    .from(t.members)
    .innerJoin(t.packs, eq(t.packs.id, t.members.packId))
    .where(
      and(eq(t.packs.tenantId, tenantId), eq(t.members.capabilityId, capabilityId)),
    )) as Array<{ packId: string }>;
  return rows.length > 0;
}

/**
 * 这个人能不能用某项平台功能（联网搜索、深度研究）。
 *
 * 判定和 MCP/Skill 走同一条路：功能是能力包的成员，包分给谁谁就有。原本它有自己的
 * enterprise_feature_assignments 表和自己的分配 UI，等于两套并行的授权系统——管理员想的
 * 只是「这个人能用什么」，不该因为这一项是「平台功能」就换一个地方配。
 *
 * 迁移安全：**没有任何包引用这项功能时，视为还没纳入能力包管理，保持全员可用。**
 * 直接改成「不在包里就不能用」会让所有现存租户的搜索在升级当天静默失效，而现场看到的
 * 现象是「搜索突然不工作了」，查不到是权限在拦。这和网关那边 governed 的处理是同一条：
 * 不被任何包引用的东西保持原有行为。
 */
export async function isPlatformFeatureAllowedForUser(
  feature: PlatformFeature,
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<boolean> {
  const capabilityId = featureCapabilityId(feature);
  const governed = await isFeatureGovernedByAnyPack(capabilityId);
  if (!governed) return true;
  const view = await loadUserCapabilityView(userId, email, deptId);
  if (view.optOuts.has(capabilityId)) return false;
  return view.assignedPlatformFeatures.has(feature);
}

/** 供下发：用户当下真正能调用的能力。 */
export async function listAvailableCapabilitiesForUser(
  userId: string,
  email?: string,
  deptId?: string | null,
  surface?: CapabilitySurface,
): Promise<PortalCapability[]> {
  const view = await loadUserCapabilityView(userId, email, deptId);
  return effectiveFromView(view, surface);
}

/**
 * @param surface 只返回在该客户端生效的能力；不传表示不过滤（管理端「我的能力」
 *   要看到全部，下发路径才需要收窄）。
 */
export function effectiveFromView(
  view: UserCapabilityView,
  surface?: CapabilitySurface,
): PortalCapability[] {
  const byId = new Map(view.assigned.map((item) => [item.id, item] as const));
  // 走同一个策略函数，避免这里与管理端对「生效」有两套判断。
  const assignments: CapabilityAssignment[] = view.assigned.map((item) => ({
    capabilityId: item.id,
    enterpriseEnabled: true,
  }));
  const effective = resolveEffectiveCapabilities(assignments, view.optOuts)
    .map((id) => byId.get(id))
    .filter((item): item is PortalCapability => Boolean(item));
  if (!surface) return effective;
  return effective.filter((item) => item.surfaces.includes(surface));
}

/**
 * 这个人在指定客户端上能不能用某项平台功能。
 *
 * 平台功能的 surface 由平台定义（platformFeatureSurfaces），管理员分配的是「能不能
 * 用」，不是「在哪能用」。附件自动路由两端都要，但比如将来出现只在 Desktop 成立的
 * 功能，portal 侧就该直接判 false 而不是下发一个点不动的开关。
 */
export async function isPlatformFeatureAllowedOnSurface(
  feature: PlatformFeature,
  surface: CapabilitySurface,
  userId: string,
  email?: string,
  deptId?: string | null,
): Promise<boolean> {
  if (!platformFeatureSurfaces(feature).includes(surface)) return false;
  return isPlatformFeatureAllowedForUser(feature, userId, email, deptId);
}

/** 供「我的能力」页面：连被自己关掉的一起列出来，否则关掉之后就找不回来了。 */
export function capabilityStatesFromView(view: UserCapabilityView): UserCapabilityState[] {
  return view.assigned.map((item) => ({
    ...item,
    state: resolveCapabilityState(true, view.optOuts.has(item.id)),
  }));
}

/** Skill 声明的依赖若没随包下发，Desktop 装了也调不通；标出来供前端提示。 */
export function findUnmetSkillDependencies(capabilities: readonly PortalCapability[]): string[] {
  const present = new Set(capabilities.map((item) => item.id));
  const missing = new Set<string>();
  for (const item of capabilities) {
    for (const dependency of item.requires) {
      if (!parseCapabilityId(dependency)) continue;
      if (!present.has(dependency)) missing.add(dependency);
    }
  }
  return [...missing].sort();
}
