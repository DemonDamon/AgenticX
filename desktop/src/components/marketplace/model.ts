/**
 * 插件市场纯函数层：列表拼装、去重、已装判定与筛选。
 * 不依赖 React / bridge,便于单测;数据拉取与安装状态机见 hooks。
 */

import type {
  RecommendedSkill,
  RecommendedSkillCta,
  RecommendedSkillTier,
} from "../../data/recommended-skills";

/** 与 preload `searchRegistry` 返回条目结构一致(文件内局部声明,参考 SettingsPanel 同款做法)。 */
export type MarketRegistrySkill = {
  name: string;
  description: string;
  version: string;
  author: string;
  source: string;
  source_type?: string;
  install_hint?: string;
};

export type MarketSkillOrigin = "recommended" | "registry";

/**
 * 本地已装的市场技能最小投影(来自 /api/skills,source 为 registry/bundle)。
 * registry 目录只返回前 N 项,市场安装过的技能可能不在目录里——
 * 这些技能由本地列表补一张恒为已装态的卡片,保证装完可见、可搜。
 */
export type MarketLocalSkill = {
  name: string;
  description: string;
  source: string;
};

/** 视为"从市场安装"的本地技能来源。 */
const MARKET_LOCAL_SOURCES = new Set(["registry", "bundle"]);

/** 技能 Tab 的卡片条目:官方推荐位与 registry 检索结果统一为一套渲染模型。 */
export type MarketSkillItem = {
  key: string;
  /** 推荐位技能 id(如 officecli/archscribe),用于选择安装提示词。 */
  id?: string;
  name: string;
  description: string;
  provider: string;
  /** 官方推荐位自带图标与外链;registry 条目没有。 */
  iconSrc?: string;
  officialUrl?: string;
  category?: string;
  tier?: RecommendedSkillTier;
  origin: MarketSkillOrigin;
  /** registry 安装来源(如 clawhub);推荐位走 Meta-Agent 安装提示词。 */
  source?: string;
  version?: string;
  cta?: RecommendedSkillCta;
  installed: boolean;
};

/** 插件 Tab 的 MCP 条目(由列表 + 详情富化后的精简投影)。 */
export type MarketMcpEntry = {
  serverId: string;
  name: string;
  description: string;
  /** 详情里 server_config 声明的 mcpServers 键,用于已装判定。 */
  serverNames: string[];
  /** 上游 logo 地址,卡片图标优先用它。 */
  logoUrl?: string;
};

/**
 * 市场统一条目 kind:MCP 连接器 / 技能(含精选工具位) / 数字专家 / 指令。
 * 「精选工具」是推荐位技能里 cta=install 的子集,在统一模型下归入 skill,
 * 由技能 Tab 的 installable 筛选 chip 提供原「专业工具集」入口。
 */
export type MarketItemKind = "mcp" | "skill" | "agent" | "command";

/** 市场页顶栏 Tab:全部 + 四类能力扩展(全部页混排统一卡片)。 */
export type MarketTab = "all" | "mcp" | "skills" | "agents" | "commands";

/** MarketTab → 统一条目 kind 筛选值(Tab 用复数标签,kind 用单数)。 */
export function tabToKindFilter(tab: MarketTab): "all" | MarketItemKind {
  if (tab === "skills") return "skill";
  if (tab === "agents") return "agent";
  if (tab === "commands") return "command";
  if (tab === "mcp") return "mcp";
  return "all";
}

/** 全部 Tab 及专家/指令 Tab 的统一卡片条目:各 kind 的展示与安装链路字段并集。 */
export type MarketplaceItem = {
  key: string;
  kind: MarketItemKind;
  name: string;
  description: string;
  installed: boolean;
  /** 提供方/作者(技能与推荐位);连接器场景缺省回退 serverId。 */
  provider?: string;
  /** 图标链入参(优先级:iconSrc → 品牌 → logoUrl,见 MarketIcon)。 */
  iconSrc?: string;
  logoUrl?: string;
  /** kind=mcp:市场条目 id,详情浮层入口。 */
  serverId?: string;
  /** kind=skill:推荐位 id(Meta-Agent 安装提示词)。 */
  id?: string;
  /** kind=skill:registry 安装来源(扫描安装链路)。 */
  source?: string;
  origin?: MarketSkillOrigin;
  cta?: RecommendedSkillCta;
  officialUrl?: string;
  category?: string;
  tier?: RecommendedSkillTier;
  version?: string;
  /** kind=agent:专家头像地址。 */
  avatarUrl?: string;
  /** kind=command:内置(true)或自定义(false)。 */
  builtin?: boolean;
  /** kind=command:作用域标识(builtin/global/…)。 */
  commandScope?: string;
};

/** 专家条目输入(listAvatars 返回的最小投影)。 */
export type MarketAgentInput = {
  id: string;
  name: string;
  role?: string;
  description?: string;
  avatar_url?: string;
};

/** 指令条目输入(builtin 开关与自定义指令的最小投影)。 */
export type MarketCommandInput = {
  name: string;
  description?: string;
  builtin?: boolean;
  scope?: string;
};

/** 统一名称归一:去首尾空白 + 小写,作为已装匹配的键。 */
export function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

/** localNames 需为已归一化的本地技能名集合(由 loadSkills 结果映射而来)。 */
export function isSkillInstalled(name: string, localNames: ReadonlySet<string>): boolean {
  return localNames.has(normalizeSkillName(name));
}

/** MCP 已装判定:任一 server 名命中本机名册即视为已配置(两侧都做归一化)。 */
export function isMcpInstalled(
  serverNames: readonly string[],
  configured: ReadonlySet<string>,
): boolean {
  if (serverNames.length === 0) return false;
  const normalizedConfigured = new Set(Array.from(configured, normalizeSkillName));
  return serverNames.some((n) => normalizedConfigured.has(normalizeSkillName(n)));
}

/**
 * 技能列表拼装:推荐位在前,registry 结果去重(与推荐位重名的丢弃)后追加;
 * 最后补上本地已装但不在推荐位/目录里的市场技能(恒为已装态)。
 */
export function buildSkillItems(
  recommended: readonly RecommendedSkill[],
  registryItems: readonly MarketRegistrySkill[],
  localNames: ReadonlySet<string>,
  localMarketSkills: readonly MarketLocalSkill[] = [],
): MarketSkillItem[] {
  const recommendedNames = new Set(recommended.map((r) => normalizeSkillName(r.name)));
  const recommendedItems: MarketSkillItem[] = recommended.map((r) => ({
    key: `rec:${r.id}`,
    id: r.id,
    name: r.name,
    description: r.description,
    provider: r.provider,
    iconSrc: r.icon_src,
    officialUrl: r.official_url,
    category: r.category,
    tier: r.tier,
    origin: "recommended",
    cta: r.cta,
    installed: isSkillInstalled(r.name, localNames),
  }));
  const registrySkillItems: MarketSkillItem[] = registryItems
    .filter((r) => r.name && !recommendedNames.has(normalizeSkillName(r.name)))
    .map((r) => ({
      key: `reg:${r.source}:${r.name}`,
      name: r.name,
      description: r.description,
      provider: r.author,
      origin: "registry",
      source: r.source,
      version: r.version,
      tier: "third_party",
      cta: "install",
      installed: isSkillInstalled(r.name, localNames),
    }));
  const coveredNames = new Set(recommendedNames);
  for (const r of registryItems) {
    if (r.name) coveredNames.add(normalizeSkillName(r.name));
  }
  const localSkillItems: MarketSkillItem[] = localMarketSkills
    .filter(
      (s) =>
        MARKET_LOCAL_SOURCES.has(s.source) &&
        s.name &&
        !coveredNames.has(normalizeSkillName(s.name)),
    )
    .map((s) => ({
      key: `local:${s.name}`,
      name: s.name,
      description: s.description,
      provider: s.source,
      origin: "registry",
      tier: "third_party",
      installed: true,
    }));
  return [...recommendedItems, ...registrySkillItems, ...localSkillItems];
}

function matchesSkillQuery(item: MarketSkillItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.provider.toLowerCase().includes(q)
  );
}

/**
 * 技能筛选:
 * - "all" 全部;"recommended" 仅推荐位;"installable" 可安装位(registry 条目 + cta=install 推荐位);
 * - "enterprise" / "third_party" 按来源档;
 * - 其余值按类目精确匹配。
 * query 对名称/描述/提供方做大小写不敏感的包含匹配。
 */
export function filterSkills(items: readonly MarketSkillItem[], tag: string, query: string): MarketSkillItem[] {
  return items.filter((it) => {
    if (tag === "all") return matchesSkillQuery(it, query);
    if (tag === "recommended") {
      if (it.origin !== "recommended") return false;
    } else if (tag === "installable") {
      if (it.origin !== "registry" && it.cta !== "install") return false;
    } else if (tag === "enterprise" || tag === "third_party") {
      if (it.tier !== tag) return false;
    } else if (it.category !== tag) {
      return false;
    }
    return matchesSkillQuery(it, query);
  });
}

/**
 * 筛选 chips:all + recommended + installable(存在可安装条目时) + 出现过的来源档 + 出现过的类目
 * (保持 encounter 顺序)。
 */
export function skillFilterTags(items: readonly MarketSkillItem[]): string[] {
  const tiers: string[] = [];
  const categories: string[] = [];
  let installable = false;
  for (const it of items) {
    if (it.tier && !tiers.includes(it.tier)) tiers.push(it.tier);
    if (it.category && !categories.includes(it.category)) categories.push(it.category);
    if (it.origin === "registry" || it.cta === "install") installable = true;
  }
  return [
    "all",
    "recommended",
    ...(installable ? ["installable"] : []),
    ...tiers,
    ...categories,
  ];
}

/** MCP 连接器 → 统一条目(已装判定走本机名册)。 */
export function buildMcpItems(
  mcpEntries: readonly MarketMcpEntry[],
  configuredMcp: ReadonlySet<string>,
): MarketplaceItem[] {
  return mcpEntries.map((entry) => ({
    key: `mcp:${entry.serverId}`,
    kind: "mcp",
    name: entry.name,
    description: entry.description,
    installed: isMcpInstalled(entry.serverNames, configuredMcp),
    provider: entry.serverId,
    serverId: entry.serverId,
    logoUrl: entry.logoUrl,
  }));
}

/** 本地专家 → 统一条目(本地资产,恒为已装态)。 */
export function buildAgentItems(avatars: readonly MarketAgentInput[]): MarketplaceItem[] {
  return avatars
    .filter((a) => a.id && a.name)
    .map((a) => ({
      key: `agent:${a.id}`,
      kind: "agent",
      name: a.name,
      description: String(a.description ?? a.role ?? ""),
      installed: true,
      avatarUrl: a.avatar_url,
    }));
}

/** 指令(builtin + 自定义) → 统一条目(本机能力,恒为已装态)。 */
export function buildCommandItems(commands: readonly MarketCommandInput[]): MarketplaceItem[] {
  return commands
    .filter((c) => c.name)
    .map((c) => ({
      key: `command:${c.builtin ? "builtin" : (c.scope ?? "global")}:${c.name}`,
      kind: "command",
      name: c.name,
      description: String(c.description ?? ""),
      installed: true,
      builtin: Boolean(c.builtin),
      commandScope: c.builtin ? "builtin" : (c.scope ?? "global"),
    }));
}

/** 技能卡片条目 → 统一条目投影(保留 registry/推荐位安装链路字段)。 */
function toUnifiedSkillItem(item: MarketSkillItem): MarketplaceItem {
  return {
    key: item.key,
    kind: "skill",
    name: item.name,
    description: item.description,
    installed: item.installed,
    provider: item.provider,
    iconSrc: item.iconSrc,
    id: item.id,
    source: item.source,
    origin: item.origin,
    cta: item.cta,
    officialUrl: item.officialUrl,
    category: item.category,
    tier: item.tier,
    version: item.version,
  };
}

/**
 * 全部 Tab 混排:MCP 连接器 → 技能(推荐位在前,由 skillItems 顺序保证) → 专家 → 指令。
 * 「精选工具」不再单列:推荐位技能统一归 skill,由 installable chip 提供筛选入口。
 */
export function buildUnifiedItems(
  mcpEntries: readonly MarketMcpEntry[],
  skillItems: readonly MarketSkillItem[],
  agents: readonly MarketAgentInput[],
  commands: readonly MarketCommandInput[],
  configuredMcp: ReadonlySet<string>,
): MarketplaceItem[] {
  return [
    ...buildMcpItems(mcpEntries, configuredMcp),
    ...skillItems.map(toUnifiedSkillItem),
    ...buildAgentItems(agents),
    ...buildCommandItems(commands),
  ];
}

function matchesUnifiedQuery(item: MarketplaceItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
}

/** 统一条目筛选:kind 为 "all" 或具体 kind;query 对名称/描述做包含匹配。 */
export function filterUnifiedItems(
  items: readonly MarketplaceItem[],
  kind: "all" | MarketItemKind,
  query: string,
): MarketplaceItem[] {
  return items.filter((it) => {
    if (kind !== "all" && it.kind !== kind) return false;
    return matchesUnifiedQuery(it, query);
  });
}

/**
 * 从市场详情条目里提取 server_config 声明的 mcpServers 键
 * (与 SettingsPanel 的 extractMarketplaceMcpServerNames 同逻辑,抽为纯函数复用)。
 */
export function extractMcpServerNames(item: Record<string, unknown> | undefined): string[] {
  const serverConfig = item?.server_config as unknown;
  if (!Array.isArray(serverConfig) || serverConfig.length === 0) return [];
  const names: string[] = [];
  for (const cfg of serverConfig) {
    if (!cfg || typeof cfg !== "object") continue;
    const mcpServers = (cfg as { mcpServers?: unknown }).mcpServers;
    if (!mcpServers || typeof mcpServers !== "object") continue;
    for (const key of Object.keys(mcpServers as Record<string, unknown>)) {
      if (key.trim()) names.push(key.trim());
    }
  }
  return Array.from(new Set(names));
}
