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
  /** 上游返回的原始分类标签(如 ["browser-automation"]),用于映射场景分类。 */
  categories?: string[];
};

/**
 * 场景分类:按用户使用场景组织市场条目(研发工具/内容创作/数据分析等)。
 * MCP 上游 categories(英文标签)与技能 category(中文)都映射到这套枚举。
 */
export type MarketCategory =
  | "dev_tools"
  | "content_creation"
  | "data_analysis"
  | "ecommerce"
  | "finance"
  | "legal"
  | "efficiency"
  | "ui_design"
  | "research"
  | "other";

/** 分类元数据:中文名 + lucide 图标名 + 一句话描述,供精选大卡与筛选 chip 共用。 */
export const CATEGORY_META: Record<MarketCategory, { label: string; icon: string; desc: string }> = {
  dev_tools: { label: "研发工具", icon: "Code2", desc: "代码托管、原型开发、浏览器自动化等研发提效扩展" },
  content_creation: { label: "内容创作", icon: "PenLine", desc: "文档、表格、演示、图文与图片视频创作" },
  data_analysis: { label: "数据分析", icon: "BarChart3", desc: "数据清洗、统计分析、报表与可视化" },
  ecommerce: { label: "电商营销", icon: "ShoppingBag", desc: "选品、图片生成、SEO 与营销内容" },
  finance: { label: "金融投资", icon: "TrendingUp", desc: "行情、财报、个股分析与投研辅助" },
  legal: { label: "法务合规", icon: "Scale", desc: "合同审查、合规检查与法律文书辅助" },
  efficiency: { label: "效率提升", icon: "Zap", desc: "自动化、日程、会议与知识管理" },
  ui_design: { label: "界面设计", icon: "Palette", desc: "UI 设计、前端设计工具集与设计系统" },
  research: { label: "调研分析", icon: "Search", desc: "网页抓取、搜索、知识库与行业研究" },
  other: { label: "其他", icon: "Boxes", desc: "未归类的扩展能力" },
};

/** 全部分类枚举顺序(精选大卡与筛选 chip 按此顺序展示)。 */
export const ALL_CATEGORIES: MarketCategory[] = [
  "dev_tools",
  "content_creation",
  "data_analysis",
  "ecommerce",
  "finance",
  "legal",
  "efficiency",
  "ui_design",
  "research",
];

/** MCP 上游英文分类标签 → 场景分类的关键词映射(命中即归类)。 */
const MCP_CATEGORY_KEYWORDS: { category: MarketCategory; keywords: string[] }[] = [
  { category: "dev_tools", keywords: ["browser", "automation", "develop", "devops", "code", "git", "github", "gitlab", "ci", "deploy"] },
  { category: "content_creation", keywords: ["content", "writing", "document", "image", "video", "ppt", "slide", "office", "doc"] },
  { category: "data_analysis", keywords: ["data", "analytic", "database", "sql", "chart", "visualiz", "statistic"] },
  { category: "ecommerce", keywords: ["e-commerce", "ecommerce", "shop", "commerce", "marketing", "seo"] },
  { category: "finance", keywords: ["finance", "trading", "stock", "market", "invest", "quant"] },
  { category: "legal", keywords: ["legal", "law", "compliance", "contract"] },
  { category: "efficiency", keywords: ["productivity", "efficiency", "automation", "calendar", "meeting", "note", "task"] },
  { category: "ui_design", keywords: ["ui", "design", "frontend", "figma", "mockup", "prototype"] },
  { category: "research", keywords: ["research", "search", "web", "crawl", "scrape", "knowledge"] },
];

/**
 * 将 MCP 上游 categories(英文标签数组)映射到场景分类。
 * 取第一个命中关键词的分类;全未命中返回 other。
 */
export function mapMcpCategories(rawCategories: readonly string[] | undefined): MarketCategory {
  if (!rawCategories || rawCategories.length === 0) return "other";
  for (const raw of rawCategories) {
    const tag = String(raw).toLowerCase();
    for (const { category, keywords } of MCP_CATEGORY_KEYWORDS) {
      if (keywords.some((k) => tag.includes(k))) return category;
    }
  }
  return "other";
}

/** 技能中文 category → 场景分类的关键词映射。 */
const SKILL_CATEGORY_KEYWORDS: { category: MarketCategory; keywords: string[] }[] = [
  { category: "content_creation", keywords: ["office", "文档", "创作", "ppt", "演示", "图文", "图片", "视频"] },
  { category: "dev_tools", keywords: ["架构", "代码", "开发", "cli", "工具集"] },
  { category: "research", keywords: ["知识库", "笔记", "检索", "搜索", "研究"] },
  { category: "efficiency", keywords: ["会议", "日程", "协作"] },
];

/** 将技能的中文 category 字符串映射到场景分类;未命中或为空返回 other。 */
export function mapSkillCategory(rawCategory: string | undefined): MarketCategory {
  if (!rawCategory) return "other";
  const tag = rawCategory.toLowerCase();
  for (const { category, keywords } of SKILL_CATEGORY_KEYWORDS) {
    if (keywords.some((k) => tag.includes(k.toLowerCase()))) return category;
  }
  return "other";
}

/**
 * 市场统一条目 kind:MCP / 技能 / 专家 / 指令 / 连接器(原生+网关供给)。
 * 「精选工具」是推荐位技能里 cta=install 的子集,在统一模型下归入 skill,
 * 由技能 Tab 的 installable 筛选 chip 提供原「专业工具集」入口。
 */
export type MarketItemKind = "mcp" | "skill" | "agent" | "command" | "connector";

/** 市场页顶栏 Tab:全部 + 连接器 + MCP/技能/专家/指令(全部页混排统一卡片)。 */
export type MarketTab = "all" | "connectors" | "mcp" | "skills" | "agents" | "commands";

/** MarketTab → 统一条目 kind 筛选值(Tab 用复数标签,kind 用单数)。 */
export function tabToKindFilter(tab: MarketTab): "all" | MarketItemKind {
  if (tab === "skills") return "skill";
  if (tab === "agents") return "agent";
  if (tab === "commands") return "command";
  if (tab === "mcp") return "mcp";
  if (tab === "connectors") return "connector";
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
  /** kind=mcp:连接器网关精选条目特例标记,安装走网关弹层而非上游详情浮层。 */
  gateway?: boolean;
  /** kind=connector:供给类型 native|mcp|gateway。 */
  supplyKind?: "native" | "mcp" | "gateway";
  /** kind=connector:握手类型。 */
  authType?: "none" | "api_key" | "custom_credential" | "oauth2";
  /** 未接线说明：将需的表单形态。 */
  authFormHint?: "name_only" | "api_key" | "token" | "oauth_device" | "url_token";
  /** kind=connector:原生目录 id（设置页定位）。 */
  connectorId?: string;
  /** kind=connector:是否已有真实接线路径；false 时仅展示说明、不走安装。 */
  wired?: boolean;
  /** kind=connector:对应 CONNECTOR_SUPPLY.id。 */
  supplyId?: string;
  /** kind=connector:探活健康态（connected|degraded|…）；绿标仅 connected。 */
  health?: "connected" | "degraded" | "disconnected" | "unwired";
  /** kind=skill:推荐位 id(Meta-Agent 安装提示词)。 */
  id?: string;
  /** kind=skill:registry 安装来源(扫描安装链路)。 */
  source?: string;
  origin?: MarketSkillOrigin;
  cta?: RecommendedSkillCta;
  officialUrl?: string;
  /** 场景分类(MCP 由上游 categories 映射;技能由中文 category 映射)。 */
  category?: MarketCategory;
  tier?: RecommendedSkillTier;
  version?: string;
  /** kind=agent:专家头像地址。 */
  avatarUrl?: string;
  /** kind=agent:专家头像 id(「使用」直达其专属对话)。 */
  avatarId?: string;
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
    category: mapMcpCategories(entry.categories),
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
      avatarId: a.id,
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
    category: mapSkillCategory(item.category),
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

/** 统一条目筛选:kind 为 "all" 或具体 kind;category 为可选场景分类;query 对名称/描述做包含匹配。 */
export function filterUnifiedItems(
  items: readonly MarketplaceItem[],
  kind: "all" | MarketItemKind,
  query: string,
  category?: MarketCategory | "all",
): MarketplaceItem[] {
  return items.filter((it) => {
    if (kind === "connector") {
      // 连接器 Tab：原生/网关供给；网关精选卡仍是 kind=mcp + gateway 标记。
      if (!(it.kind === "connector" || it.gateway === true)) return false;
    } else if (kind === "mcp") {
      // MCP Tab 不重复展示已归入连接器的原生卡片；网关精选仍可在 MCP 看见。
      if (it.kind === "connector") return false;
      if (it.kind !== "mcp") return false;
    } else if (kind !== "all" && it.kind !== kind) {
      return false;
    }
    if (category && category !== "all" && it.category !== category) return false;
    return matchesUnifiedQuery(it, query);
  });
}

/**
 * 从供给表构建市场「连接器」条目。
 * 市场默认传入全量目录（wiredOnly=false）；未接线项 health=unwired，CTA「暂未接线」，不伪造已连接。
 */
export function buildConnectorSupplyItems(
  entries: readonly {
    id: string;
    kind: "native" | "mcp" | "gateway";
    connectorId?: string;
    auth: "none" | "api_key" | "custom_credential" | "oauth2";
    wired: boolean;
    fallbackName: string;
    fallbackDescription: string;
    iconSrc?: string;
    authFormHint?: "name_only" | "api_key" | "token" | "oauth_device" | "url_token";
  }[],
  opts?: {
    wiredOnly?: boolean;
    /** 覆盖展示名/描述（i18n）。key=entry.id */
    display?: Record<string, { name?: string; description?: string; provider?: string }>;
    /** 网关已装态。 */
    gatewayInstalled?: boolean;
    /** @deprecated prefer healthByConnectorId */
    connectedByConnectorId?: Readonly<Record<string, boolean>>;
    /** 原生/MCP 合并健康态（设置页同源探活）。key=connectorId */
    healthByConnectorId?: Readonly<Record<string, "connected" | "degraded" | "disconnected" | "unwired">>;
  },
): MarketplaceItem[] {
  const wiredOnly = opts?.wiredOnly !== false;
  const display = opts?.display ?? {};
  const connectedMap = opts?.connectedByConnectorId ?? {};
  const healthMap = opts?.healthByConnectorId ?? {};
  const out: MarketplaceItem[] = [];
  for (const e of entries) {
    if (wiredOnly && !e.wired) continue;
    const d = display[e.id] ?? {};
    if (e.kind === "gateway") {
      const gwInstalled = Boolean(opts?.gatewayInstalled);
      out.push({
        key: `connector:${e.id}`,
        kind: "connector",
        name: d.name ?? e.fallbackName,
        description: d.description ?? e.fallbackDescription,
        installed: gwInstalled,
        provider: d.provider ?? "Near",
        gateway: true,
        supplyKind: "gateway",
        authType: e.auth,
        authFormHint: e.authFormHint,
        wired: e.wired,
        supplyId: e.id,
        serverId: "connector-runtime-gateway",
        iconSrc: e.iconSrc,
        health: gwInstalled ? "connected" : "disconnected",
      });
      continue;
    }
    // 未接线 mcp stub（无 connectorId）：目录骨架，永不标已安装。
    if (!e.connectorId) {
      out.push({
        key: `connector:${e.id}`,
        kind: "connector",
        name: d.name ?? e.fallbackName,
        description: d.description ?? e.fallbackDescription,
        installed: false,
        provider: e.kind,
        iconSrc: e.iconSrc,
        supplyKind: e.kind,
        authType: e.auth,
        authFormHint: e.authFormHint,
        wired: false,
        supplyId: e.id,
        health: "unwired",
      });
      continue;
    }
    const health =
      healthMap[e.connectorId] ||
      (connectedMap[e.connectorId] ? "connected" : e.wired ? "disconnected" : "unwired");
    const installed = health === "connected";
    out.push({
      key: `connector:${e.id}`,
      kind: "connector",
      name: d.name ?? e.fallbackName,
      description: d.description ?? e.fallbackDescription,
      installed,
      provider: e.kind,
      iconSrc: e.iconSrc,
      supplyKind: e.kind,
      authType: e.auth,
      authFormHint: e.authFormHint,
      connectorId: e.connectorId,
      wired: e.wired,
      supplyId: e.id,
      health,
    });
  }
  return out;
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
