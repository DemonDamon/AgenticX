/**
 * 插件市场数据源:并行拉取本地技能 / registry 技能 / MCP 市场列表 / 本机 MCP 名册,
 * 全部在前端拼装(零后端改动),requestSeq 做竞态防护。
 *
 * 性能:模块级会话缓存 + stale-while-revalidate —— 切走再回来立即展示上次数据;
 * MCP 详情补全在首屏之后后台进行,不阻塞「加载中」解除;本机连接器目录与缓存命中时
 * 不因探活/远端刷新而整页空白。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  extractMcpServerNames,
  normalizeSkillName,
  type MarketAgentInput,
  type MarketCommandInput,
  type MarketLocalSkill,
  type MarketMcpEntry,
  type MarketRegistrySkill,
} from "./model";
import {
  configuredMcpEntriesFromDocument,
  configuredMcpEntriesFromStatus,
  mergeConfiguredMcpEntries,
  type ConfiguredMcpEntry,
} from "../settings/connectors/my-connections-model";
import { parseMcpJsonDocument } from "../../utils/mcp-remote-config";
import { useAppStore } from "../../store";
import { fetchCommands } from "../../services/commandsApi";

export type MarketplaceData = {
  loading: boolean;
  /** registry 与 MCP 市场双双失败时才置为错误(单路失败降级为空列表)。 */
  loadError: string | null;
  /** 本地已装技能名(归一化小写),用于卡片「已安装」判定。 */
  localSkillNames: ReadonlySet<string>;
  /** 本地技能全量列表(供管理视图复用,避免二次请求)。 */
  skillItems: Array<{ name: string; description: string; source?: string; globally_disabled?: boolean }>;
  /** 本地已装的市场技能(source=registry/bundle),目录外的装完技能靠它可见。 */
  localMarketSkills: MarketLocalSkill[];
  registryItems: MarketRegistrySkill[];
  /** 富化后的 MCP 市场条目(托管目录;serverNames 可后台补全)。 */
  mcpEntries: MarketMcpEntry[];
  /** 本机已配置的 MCP server 名,用于连接器「已安装」判定。 */
  configuredMcpNames: ReadonlySet<string>;
  /** 本机 MCP 元数据（url/command/source），供「我的连接」过滤自定义远程。 */
  configuredMcpEntries: readonly ConfiguredMcpEntry[];
  /** 本地数字专家(listAvatars 投影,市场专家 Tab 数据源)。 */
  agents: MarketAgentInput[];
  /** 指令(启用中的内置 + 自定义 global 指令,市场指令 Tab 数据源)。 */
  commands: MarketCommandInput[];
};

const INITIAL: MarketplaceData = {
  loading: true,
  loadError: null,
  localSkillNames: new Set<string>(),
  skillItems: [],
  localMarketSkills: [],
  registryItems: [],
  mcpEntries: [],
  configuredMcpNames: new Set<string>(),
  configuredMcpEntries: [],
  agents: [],
  commands: [],
};

/** 会话级缓存:MarketplaceView 随 mainView 卸载/重挂时保留上次目录,二次打开近乎瞬时。 */
let sessionCache: MarketplaceData | null = null;

/** 视为"从市场安装"的本地技能来源(与 model.ts 的 MARKET_LOCAL_SOURCES 一致)。 */
const MARKET_LOCAL_SOURCES = new Set(["registry", "bundle"]);

function toLocalSkillProjection(items: Array<{ name: string; description: string; source?: string }>) {
  return items
    .filter((s) => MARKET_LOCAL_SOURCES.has(String(s.source ?? "")))
    .map((s) => ({
      name: String(s.name ?? ""),
      description: String(s.description ?? ""),
      source: String(s.source ?? ""),
    }));
}

/** 与 MCPMarketplacePanel 的 cleanDescription 同逻辑:去 HTML 标签 + 压缩空白。 */
function cleanDescription(input: unknown): string {
  const raw = String(input ?? "");
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCatalogData(data: MarketplaceData): boolean {
  return (
    data.registryItems.length > 0 ||
    data.mcpEntries.length > 0 ||
    data.agents.length > 0 ||
    data.commands.length > 0 ||
    data.skillItems.length > 0 ||
    data.localMarketSkills.length > 0
  );
}

function cloneData(data: MarketplaceData): MarketplaceData {
  return {
    ...data,
    localSkillNames: new Set(data.localSkillNames),
    configuredMcpNames: new Set(data.configuredMcpNames),
    configuredMcpEntries: [...data.configuredMcpEntries],
    skillItems: [...data.skillItems],
    localMarketSkills: [...data.localMarketSkills],
    registryItems: [...data.registryItems],
    mcpEntries: [...data.mcpEntries],
    agents: [...data.agents],
    commands: [...data.commands],
  };
}

function remember(data: MarketplaceData) {
  sessionCache = cloneData({ ...data, loading: false });
}

function readInitial(): MarketplaceData {
  if (sessionCache && hasCatalogData(sessionCache)) {
    return cloneData({ ...sessionCache, loading: false, loadError: null });
  }
  return { ...INITIAL };
}

/**
 * 投影上游 MCP 条目。ModelScope 列表接口已不再返回 is_verified / is_hosted /
 * server_config，因此：
 * - 列表项：缺省字段时不过滤（由请求侧 isHosted=true 限定托管目录）；
 * - 详情项：显式 is_hosted===false 仍丢弃；不再因未认证或缺少 server 名而隐藏卡片
 *   （serverNames 可后台补全，已装判定随之更新）。
 */
function projectMcpEntry(raw: Record<string, unknown>, names: string[]): MarketMcpEntry | null {
  if (raw.is_hosted === false) return null;
  const serverId = String((raw as { id?: unknown }).id ?? "").trim();
  if (!serverId) return null;
  return {
    serverId,
    name: String(raw.chinese_name || raw.name || serverId || "").trim(),
    description: cleanDescription(raw.description),
    serverNames: names,
    logoUrl: String(raw.logo_url ?? "").trim() || undefined,
    categories: Array.isArray((raw as { categories?: unknown }).categories)
      ? ((raw as { categories: unknown[] }).categories.filter((c): c is string => typeof c === "string"))
      : undefined,
  };
}

function mcpEntriesFromList(rawItems: unknown[]): MarketMcpEntry[] {
  const deduped = new Map<string, Record<string, unknown>>();
  for (const raw of rawItems) {
    const id = String((raw as { id?: unknown }).id ?? "").trim();
    if (id && !deduped.has(id)) deduped.set(id, raw as Record<string, unknown>);
  }
  const out: MarketMcpEntry[] = [];
  for (const raw of deduped.values()) {
    const entry = projectMcpEntry(raw, extractMcpServerNames(raw));
    if (entry) out.push(entry);
  }
  return out;
}

/** 单次刷新最多拉多少条详情补 serverNames（列表已无 server_config）。 */
const MCP_DETAIL_ENRICH_LIMIT = 48;
const MCP_DETAIL_ENRICH_CONCURRENCY = 6;

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

async function enrichMcpEntries(rawItems: unknown[]): Promise<MarketMcpEntry[]> {
  const deduped = new Map<string, Record<string, unknown>>();
  for (const raw of rawItems) {
    const id = String((raw as { id?: unknown }).id ?? "").trim();
    if (id && !deduped.has(id)) deduped.set(id, raw as Record<string, unknown>);
  }
  const list = Array.from(deduped.values());
  // 先用列表字段投影；缺 server_config 的条目按上限+并发补详情，避免一次打爆上游。
  let detailBudget = MCP_DETAIL_ENRICH_LIMIT;
  const enriched = await mapPool(list, MCP_DETAIL_ENRICH_CONCURRENCY, async (raw) => {
    const id = String((raw as { id?: unknown }).id ?? "").trim();
    const listNames = extractMcpServerNames(raw);
    if (!id || listNames.length > 0) {
      return { raw, names: listNames };
    }
    if (detailBudget <= 0) {
      return { raw, names: [] as string[] };
    }
    detailBudget -= 1;
    try {
      const detail = await window.agenticxDesktop.mcpMarketplaceDetail({ serverId: id });
      const detailItem = (detail?.item as Record<string, unknown> | undefined) ?? undefined;
      return {
        raw: { ...raw, ...(detailItem ?? {}) } as Record<string, unknown>,
        names: extractMcpServerNames(detailItem),
      };
    } catch {
      return { raw, names: [] as string[] };
    }
  });
  const mcpEntries: MarketMcpEntry[] = [];
  for (const { raw, names } of enriched) {
    // 详情若显式非托管则丢弃；其余保留（含尚未解析出 server 名的列表项）。
    const entry = projectMcpEntry(raw, names);
    if (entry) mcpEntries.push(entry);
  }
  return mcpEntries;
}


/** 单页上限与上游 API le=100 对齐；再翻页直到凑够浏览量或无更多。 */
const MCP_CATALOG_PAGE_SIZE = 100;
/** 市场「全部」浏览页数上限，避免一次拉全量数千条。 */
const MCP_CATALOG_MAX_PAGES = 3;

type McpListResult = {
  ok?: boolean;
  items?: unknown[];
  total_count?: number;
  error?: string;
};

/**
 * 拉取托管 MCP 目录（多页）。列表接口不再带 is_verified/server_config，
 * 故用 isHosted 服务端过滤 + 分页，避免旧逻辑「首屏 20 条再客户端筛到 4 张」。
 */
async function fetchHostedMcpCatalog(): Promise<McpListResult> {
  const first = await window.agenticxDesktop.mcpMarketplaceList({
    page: 1,
    pageSize: MCP_CATALOG_PAGE_SIZE,
    isHosted: true,
  });
  if (!first?.ok || !Array.isArray(first.items)) {
    return first ?? { ok: false, error: "marketplace list failed", items: [] };
  }
  let items = [...first.items];
  const totalCount = Number(first.total_count ?? items.length);
  const totalPages = Math.min(
    MCP_CATALOG_MAX_PAGES,
    Math.max(1, Math.ceil(totalCount / MCP_CATALOG_PAGE_SIZE)),
  );
  if (totalPages > 1) {
    const pageResults = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        window.agenticxDesktop.mcpMarketplaceList({
          page: i + 2,
          pageSize: MCP_CATALOG_PAGE_SIZE,
          isHosted: true,
        }),
      ),
    );
    for (const pageRes of pageResults) {
      if (pageRes?.ok && Array.isArray(pageRes.items)) {
        items = items.concat(pageRes.items);
      }
    }
  }
  const deduped = new Map<string, unknown>();
  for (const raw of items) {
    const id = String((raw as { id?: unknown }).id ?? "").trim();
    if (id && !deduped.has(id)) deduped.set(id, raw);
  }
  return {
    ok: true,
    items: Array.from(deduped.values()),
    total_count: totalCount,
  };
}

export function useMarketplaceData() {
  const [data, setData] = useState<MarketplaceData>(readInitial);
  const seqRef = useRef(0);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);

  /** 全量刷新:六路(+ mcp.json)并行;有缓存时不置 loading,MCP 详情后台补全。 */
  const reload = useCallback(async () => {
    const seq = ++seqRef.current;
    setData((prev) => ({
      ...prev,
      loadError: null,
      // 有会话缓存/已有目录时保持 SWR:不空白整页。
      loading: hasCatalogData(prev) ? false : true,
    }));

    const [skillsRes, registryRes, mcpListBundle, mcpStatusRes, avatarsRes, commandsRes, mcpRawRes] =
      await Promise.all([
        window.agenticxDesktop.loadSkills().catch(() => null),
        window.agenticxDesktop.searchRegistry({ q: "" }).catch(() => null),
        fetchHostedMcpCatalog().catch(() => null),
        window.agenticxDesktop.loadMcpStatus("").catch(() => null),
        window.agenticxDesktop.listAvatars().catch(() => null),
        apiBase
          ? fetchCommands(apiBase, apiToken, "global").catch(() => null)
          : Promise.resolve(null),
        window.agenticxDesktop.mcpGetRaw({}).catch(() => null),
      ]);
    if (seq !== seqRef.current) return;

    const localSkills = skillsRes?.ok ? skillsRes.items ?? [] : [];
    const localSkillNames = new Set<string>(localSkills.map((s) => normalizeSkillName(s.name)));
    const localMarketSkills = toLocalSkillProjection(localSkills);
    const registryItems: MarketRegistrySkill[] = registryRes?.ok ? (registryRes.items ?? []) : [];

    const mcpListRes = mcpListBundle;
    const rawItems = Array.isArray(mcpListRes?.items) ? mcpListRes.items : [];
    // 首屏:仅用列表字段投影(有 server_config 则立刻可见);详情补全放到后面。
    const mcpEntriesQuick = mcpEntriesFromList(rawItems);

    const statusServers =
      mcpStatusRes?.ok && Array.isArray(mcpStatusRes.servers) ? mcpStatusRes.servers : [];
    const configuredMcpNames = new Set<string>(statusServers.map((s) => s.name).filter(Boolean));
    let docEntries: ConfiguredMcpEntry[] = [];
    try {
      if (mcpRawRes?.ok && mcpRawRes.text) {
        docEntries = configuredMcpEntriesFromDocument(parseMcpJsonDocument(mcpRawRes.text));
      }
    } catch {
      /* ignore mcp.json enrich */
    }
    const configuredMcpEntries = mergeConfiguredMcpEntries(
      configuredMcpEntriesFromStatus(statusServers),
      docEntries,
    );

    const agents: MarketAgentInput[] = avatarsRes?.ok
      ? (avatarsRes.avatars ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          description: a.description,
          avatar_url: a.avatar_url,
        }))
      : [];
    // 指令:启用中的内置指令 + 自定义 global 指令(停用的内置指令不出现在市场)。
    const commands: MarketCommandInput[] = commandsRes
      ? [
          ...(commandsRes.builtins ?? [])
            .filter((b) => b.enabled !== false)
            .map((b) => ({ name: b.name, description: b.description, builtin: true })),
          ...(commandsRes.commands ?? []).map((c) => ({
            name: c.name,
            description: c.description,
            builtin: false,
            scope: "global",
          })),
        ]
      : [];

    const firstPaint: MarketplaceData = {
      loading: false,
      localSkillNames,
      skillItems: localSkills.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.source,
        globally_disabled: s.globally_disabled,
      })),
      localMarketSkills,
      registryItems,
      // 若列表无 server_config 且尚无缓存条目,暂保留旧 mcpEntries,避免首屏闪空。
      mcpEntries: mcpEntriesQuick.length > 0 ? mcpEntriesQuick : (sessionCache?.mcpEntries ?? []),
      configuredMcpNames,
      configuredMcpEntries,
      agents,
      commands,
      loadError:
        !registryRes?.ok && !mcpListRes?.ok
          ? String(registryRes?.error ?? mcpListRes?.error ?? "load failed")
          : null,
    };
    if (seq !== seqRef.current) return;
    remember(firstPaint);
    setData(firstPaint);

    // 后台补全 MCP 详情(不阻塞 loading);列表缺 server_config 时按需拉详情填 serverNames。
    if (rawItems.length === 0) {
      // 列表成功但为空时清掉陈旧 MCP;列表失败则保留会话缓存条目。
      if (mcpListRes?.ok) {
        setData((prev) => {
          const next = { ...prev, mcpEntries: [] };
          remember(next);
          return next;
        });
      }
      return;
    }
    const mcpEntries = await enrichMcpEntries(rawItems);
    if (seq !== seqRef.current) return;
    setData((prev) => {
      const next = { ...prev, mcpEntries };
      remember(next);
      return next;
    });
  }, [apiBase, apiToken]);

  /** 技能安装成功后的轻量刷新:更新本地技能名集合与已装市场技能卡片。 */
  const reloadSkills = useCallback(async () => {
    try {
      await window.agenticxDesktop.refreshSkills();
    } catch {
      /* still try load */
    }
    const res = await window.agenticxDesktop.loadSkills().catch(() => null);
    if (!res?.ok) return;
    const items = res.items ?? [];
    setData((prev) => {
      const next = {
        ...prev,
        localSkillNames: new Set(items.map((s) => normalizeSkillName(s.name))),
        localMarketSkills: toLocalSkillProjection(items),
        skillItems: items.map((s) => ({
          name: s.name,
          description: s.description,
          source: s.source,
          globally_disabled: s.globally_disabled,
        })),
      };
      remember(next);
      return next;
    });
  }, []);

  /** MCP 安装成功后刷新本机名册,让连接器卡片切换「已安装」态。 */
  const reloadMcpStatus = useCallback(async () => {
    const res = await window.agenticxDesktop.loadMcpStatus("").catch(() => null);
    if (!res?.ok || !Array.isArray(res.servers)) return;
    let docEntries: ConfiguredMcpEntry[] = [];
    try {
      const raw = await window.agenticxDesktop.mcpGetRaw({}).catch(() => null);
      if (raw?.ok && raw.text) {
        docEntries = configuredMcpEntriesFromDocument(parseMcpJsonDocument(raw.text));
      }
    } catch {
      /* ignore */
    }
    const configuredMcpEntries = mergeConfiguredMcpEntries(
      configuredMcpEntriesFromStatus(res.servers),
      docEntries,
    );
    setData((prev) => {
      const next = {
        ...prev,
        configuredMcpNames: new Set(res.servers.map((s) => s.name).filter(Boolean)),
        configuredMcpEntries,
      };
      remember(next);
      return next;
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...data, reload, reloadSkills, reloadMcpStatus };
}

/** 测试/调试用:清空会话缓存(不导出到业务 UI)。 */
export function __resetMarketplaceSessionCacheForTests() {
  sessionCache = null;
}
