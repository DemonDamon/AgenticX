/**
 * 能力 id 的唯一构造与解析入口：`mcp:<ulid>` / `skill:<ulid>`。
 *
 * 用不可变的 ULID 而不是 name/slug，因为后者是管理员起的可变标签：改一次名，
 * 分配记录、用户关闭偏好、用量与审计就会全部指空，用量归属错乱对按能力计费
 * 尤其致命。前缀用来判断该去哪张表查（enterprise_skills / mcp_servers）。
 *
 * 各处手拼字符串迟早会拼出 `mcp:` 与 `mcp/` 两种写法，所以只留这一个入口。
 */

export const CAPABILITY_KINDS = ["mcp", "skill", "feature"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/**
 * 平台功能不是租户建的行，没有 ULID，用固定标识。
 *
 * 上面那条「必须用 ULID」的理由是「name 是管理员起的可变标签，改名会让分配记录指空」。
 * 这些标识由平台定义，管理员改不了，也不会有第二个租户的同名冲突——所以那条理由在这里
 * 不成立，硬塞一个 ULID 反而要为两个常量建表。
 *
 * 之所以让它们成为能力而不是另一套开关：「谁能用联网搜索」和「谁能用某个 MCP」是同一个
 * 问题。分成两套授权系统的结果是两处分配 UI、两张表、两套判定，而管理员想的只是
 * 「这个人能用什么」。
 */
export const PLATFORM_FEATURES = [
  "web_search",
  "deep_research",
  "attachment_routing",
] as const;
export type PlatformFeature = (typeof PLATFORM_FEATURES)[number];

/**
 * 能力生效在哪个客户端。
 *
 * 同一个人在 web portal 和 Desktop 上能用的东西并不一样：附件自动路由要锁 Desktop
 * 的模型选择器，而 portal 的会话模型是另一套；某些 Skill 依赖本机文件系统，下发到
 * portal 只会是一个点不动的条目。以前不分是因为只有 Skill/MCP，两边行为恰好一致。
 *
 * 平台功能的 surface 写死在代码里：它们由平台定义，管理员改不了——和
 * PLATFORM_FEATURES 用固定标识而不是 ULID 是同一条理由。租户自己建的 Skill/MCP 行
 * 暂时视为两端通用（见 capability-packs-reader 的 DEFAULT_CAPABILITY_SURFACES），
 * 等真的出现单端 Skill 时再加列。
 */
export const CAPABILITY_SURFACES = ["web", "desktop"] as const;
export type CapabilitySurface = (typeof CAPABILITY_SURFACES)[number];

const PLATFORM_FEATURE_SURFACES: Record<PlatformFeature, readonly CapabilitySurface[]> = {
  web_search: ["web", "desktop"],
  deep_research: ["web", "desktop"],
  // 路由要锁住会话模型并把选择器灰掉，两端都要做，但表现形式各自实现。
  attachment_routing: ["web", "desktop"],
};

export function platformFeatureSurfaces(
  feature: PlatformFeature,
): readonly CapabilitySurface[] {
  return PLATFORM_FEATURE_SURFACES[feature];
}

export function isCapabilitySurface(value: unknown): value is CapabilitySurface {
  return (
    typeof value === "string" && (CAPABILITY_SURFACES as readonly string[]).includes(value)
  );
}

export function isPlatformFeature(value: unknown): value is PlatformFeature {
  return typeof value === "string" && (PLATFORM_FEATURES as readonly string[]).includes(value);
}

/** `feature:web_search` / `feature:deep_research`。 */
export function featureCapabilityId(feature: PlatformFeature): string {
  if (!isPlatformFeature(feature)) throw new Error(`unknown platform feature: ${String(feature)}`);
  return `feature:${feature}`;
}

export function parseFeatureCapabilityId(capabilityId: string): PlatformFeature | null {
  const raw = String(capabilityId ?? "").trim();
  if (!raw.startsWith("feature:")) return null;
  const feature = raw.slice("feature:".length);
  return isPlatformFeature(feature) ? feature : null;
}

export type ParsedCapabilityId = {
  kind: CapabilityKind;
  /** 被引用行的主键（ULID）。 */
  rowId: string;
};

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isCapabilityKind(value: unknown): value is CapabilityKind {
  return typeof value === "string" && (CAPABILITY_KINDS as readonly string[]).includes(value);
}

/** ULID 的规范形态是大写 Crockford base32；小写输入统一抬成大写。 */
export function normalizeRowId(rowId: string): string {
  return String(rowId ?? "").trim().toUpperCase();
}

export function formatCapabilityId(kind: CapabilityKind, rowId: string): string {
  if (!isCapabilityKind(kind)) throw new Error(`unknown capability kind: ${String(kind)}`);
  // feature 走固定标识，不是 ULID：见 PLATFORM_FEATURES 上的说明。
  if (kind === "feature") return featureCapabilityId(rowId as PlatformFeature);
  const normalized = normalizeRowId(rowId);
  if (!ULID_RE.test(normalized)) throw new Error(`capability id requires a ULID, got: ${rowId}`);
  return `${kind}:${normalized}`;
}

/** 解析失败返回 null——脏数据不应该冒充一个能力。 */
export function parseCapabilityId(capabilityId: string): ParsedCapabilityId | null {
  const raw = String(capabilityId ?? "").trim();
  const separator = raw.indexOf(":");
  if (separator <= 0) return null;
  const kind = raw.slice(0, separator);
  if (!isCapabilityKind(kind)) return null;
  if (kind === "feature") {
    const feature = parseFeatureCapabilityId(raw);
    return feature ? { kind, rowId: feature } : null;
  }
  const rowId = normalizeRowId(raw.slice(separator + 1));
  if (!ULID_RE.test(rowId)) return null;
  return { kind, rowId };
}

export function isCapabilityId(value: unknown): value is string {
  return typeof value === "string" && parseCapabilityId(value) !== null;
}

/** 按类型分组，便于一次性去各自的表里批量取行。 */
export function groupCapabilityIdsByKind(
  capabilityIds: readonly string[],
): Record<CapabilityKind, string[]> {
  const out: Record<CapabilityKind, string[]> = { mcp: [], skill: [], feature: [] };
  for (const id of capabilityIds) {
    const parsed = parseCapabilityId(id);
    if (!parsed) continue;
    if (!out[parsed.kind].includes(parsed.rowId)) out[parsed.kind].push(parsed.rowId);
  }
  return out;
}
