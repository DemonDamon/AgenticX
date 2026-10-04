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
};

export type MarketPluginKind = "mcp" | "tool";

/** 插件 Tab 的卡片条目:MCP 连接器与精选可安装工具(cta=install)混合。 */
export type MarketPluginItem = {
  key: string;
  kind: MarketPluginKind;
  name: string;
  description: string;
  installed: boolean;
  /** kind=mcp */
  serverId?: string;
  serverNames?: string[];
  /** kind=tool(来自官方推荐技能) */
  id?: string;
  provider?: string;
  iconSrc?: string;
  officialUrl?: string;
  category?: string;
  tier?: RecommendedSkillTier;
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

/** 技能列表拼装:推荐位在前,registry 结果去重(与推荐位重名的丢弃)后追加。 */
export function buildSkillItems(
  recommended: readonly RecommendedSkill[],
  registryItems: readonly MarketRegistrySkill[],
  localNames: ReadonlySet<string>,
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
  return [...recommendedItems, ...registrySkillItems];
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
 * - "all" 全部;"recommended" 仅推荐位;
 * - "enterprise" / "third_party" 按来源档;
 * - 其余值按类目精确匹配。
 * query 对名称/描述/提供方做大小写不敏感的包含匹配。
 */
export function filterSkills(items: readonly MarketSkillItem[], tag: string, query: string): MarketSkillItem[] {
  return items.filter((it) => {
    if (tag === "all") return matchesSkillQuery(it, query);
    if (tag === "recommended") {
      if (it.origin !== "recommended") return false;
    } else if (tag === "enterprise" || tag === "third_party") {
      if (it.tier !== tag) return false;
    } else if (it.category !== tag) {
      return false;
    }
    return matchesSkillQuery(it, query);
  });
}

/** 筛选 chips:all + recommended + 出现过的来源档 + 出现过的类目(保持 encounter 顺序)。 */
export function skillFilterTags(items: readonly MarketSkillItem[]): string[] {
  const tiers: string[] = [];
  const categories: string[] = [];
  for (const it of items) {
    if (it.tier && !tiers.includes(it.tier)) tiers.push(it.tier);
    if (it.category && !categories.includes(it.category)) categories.push(it.category);
  }
  return ["all", "recommended", ...tiers, ...categories];
}

/** 插件列表拼装:MCP 连接器在前,后接 cta=install 的精选工具(外链指引类不进插件网格)。 */
export function buildPluginItems(
  mcpEntries: readonly MarketMcpEntry[],
  tools: readonly RecommendedSkill[],
  configuredMcp: ReadonlySet<string>,
  localSkillNames: ReadonlySet<string>,
): MarketPluginItem[] {
  const mcpItems: MarketPluginItem[] = mcpEntries.map((entry) => ({
    key: `mcp:${entry.serverId}`,
    kind: "mcp",
    name: entry.name,
    description: entry.description,
    installed: isMcpInstalled(entry.serverNames, configuredMcp),
    serverId: entry.serverId,
    serverNames: entry.serverNames,
  }));
  const toolItems: MarketPluginItem[] = tools
    .filter((tool) => tool.cta === "install")
    .map((tool) => ({
      key: `tool:${tool.id}`,
      kind: "tool",
      name: tool.name,
      description: tool.description,
      installed: isSkillInstalled(tool.name, localSkillNames),
      id: tool.id,
      provider: tool.provider,
      iconSrc: tool.icon_src,
      officialUrl: tool.official_url,
      category: tool.category,
      tier: tool.tier,
    }));
  return [...mcpItems, ...toolItems];
}

function matchesPluginQuery(item: MarketPluginItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
}

/** 插件筛选:tag 为 "all" | "mcp" | "tool";query 对名称/描述做包含匹配。 */
export function filterPlugins(
  items: readonly MarketPluginItem[],
  tag: "all" | MarketPluginKind,
  query: string,
): MarketPluginItem[] {
  return items.filter((it) => {
    if (tag !== "all" && it.kind !== tag) return false;
    return matchesPluginQuery(it, query);
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
