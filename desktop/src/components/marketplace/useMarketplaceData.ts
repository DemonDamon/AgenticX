/**
 * 插件市场数据源:并行拉取本地技能 / registry 技能 / MCP 市场列表 / 本机 MCP 名册,
 * 全部在前端拼装(零后端改动),requestSeq 做竞态防护。
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
  /** 富化后的 MCP 市场条目(仅官方认证 + 托管 + 可解析 server 名)。 */
  mcpEntries: MarketMcpEntry[];
  /** 本机已配置的 MCP server 名,用于连接器「已安装」判定。 */
  configuredMcpNames: ReadonlySet<string>;
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
  agents: [],
  commands: [],
};

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

export function useMarketplaceData() {
  const [data, setData] = useState<MarketplaceData>(INITIAL);
  const seqRef = useRef(0);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);

  const patch = useCallback((partial: Partial<MarketplaceData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  /** 全量刷新:六路并行,失败的分支单独降级。 */
  const reload = useCallback(async () => {
    const seq = ++seqRef.current;
    patch({ loading: true, loadError: null });
    const [skillsRes, registryRes, mcpListRes, mcpStatusRes, avatarsRes, commandsRes] =
      await Promise.all([
        window.agenticxDesktop.loadSkills().catch(() => null),
        window.agenticxDesktop.searchRegistry({ q: "" }).catch(() => null),
        window.agenticxDesktop.mcpMarketplaceList({ page: 1, pageSize: 20 }).catch(() => null),
        window.agenticxDesktop.loadMcpStatus("").catch(() => null),
        window.agenticxDesktop.listAvatars().catch(() => null),
        apiBase
          ? fetchCommands(apiBase, apiToken, "global").catch(() => null)
          : Promise.resolve(null),
      ]);
    if (seq !== seqRef.current) return;

    const localSkills = skillsRes?.ok ? skillsRes.items ?? [] : [];
    const localSkillNames = new Set<string>(localSkills.map((s) => normalizeSkillName(s.name)));
    const localMarketSkills = toLocalSkillProjection(localSkills);
    const registryItems: MarketRegistrySkill[] = registryRes?.ok ? (registryRes.items ?? []) : [];

    // MCP 市场:按 id 去重 → 逐条拉详情提取 server 名 → 过滤官方认证 + 托管 + 有 server 名。
    const rawItems = Array.isArray(mcpListRes?.items) ? mcpListRes.items : [];
    const deduped = new Map<string, Record<string, unknown>>();
    for (const raw of rawItems) {
      const id = String((raw as { id?: unknown }).id ?? "").trim();
      if (id && !deduped.has(id)) deduped.set(id, raw);
    }
    const enriched = await Promise.all(
      Array.from(deduped.values()).map(async (raw) => {
        const id = String((raw as { id?: unknown }).id ?? "").trim();
        if (!id) return { raw, names: [] as string[] };
        try {
          const detail = await window.agenticxDesktop.mcpMarketplaceDetail({ serverId: id });
          const detailItem = (detail?.item as Record<string, unknown> | undefined) ?? undefined;
          return { raw: { ...raw, ...(detailItem ?? {}) } as Record<string, unknown>, names: extractMcpServerNames(detailItem) };
        } catch {
          return { raw, names: [] as string[] };
        }
      }),
    );
    if (seq !== seqRef.current) return;
    const mcpEntries: MarketMcpEntry[] = [];
    for (const { raw, names } of enriched) {
      if (!Boolean(raw.is_verified) || !Boolean(raw.is_hosted) || names.length === 0) continue;
      const serverId = String((raw as { id?: unknown }).id ?? "").trim();
      if (!serverId) continue;
      mcpEntries.push({
        serverId,
        name: String(raw.chinese_name || raw.name || serverId || "").trim(),
        description: cleanDescription(raw.description),
        serverNames: names,
        logoUrl: String(raw.logo_url ?? "").trim() || undefined,
      });
    }

    const configuredMcpNames = new Set<string>(
      (mcpStatusRes?.ok && Array.isArray(mcpStatusRes.servers) ? mcpStatusRes.servers : []).map(
        (s) => s.name,
      ),
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

    patch({
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
      mcpEntries,
      configuredMcpNames,
      agents,
      commands,
      loadError:
        !registryRes?.ok && !mcpListRes?.ok
          ? String(registryRes?.error ?? mcpListRes?.error ?? "load failed")
          : null,
    });
  }, [patch, apiBase, apiToken]);

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
    setData((prev) => ({
      ...prev,
      localSkillNames: new Set(items.map((s) => normalizeSkillName(s.name))),
      localMarketSkills: toLocalSkillProjection(items),
    }));
  }, []);

  /** MCP 安装成功后刷新本机名册,让连接器卡片切换「已安装」态。 */
  const reloadMcpStatus = useCallback(async () => {
    const res = await window.agenticxDesktop.loadMcpStatus("").catch(() => null);
    if (!res?.ok || !Array.isArray(res.servers)) return;
    setData((prev) => ({
      ...prev,
      configuredMcpNames: new Set(res.servers.map((s) => s.name)),
    }));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...data, reload, reloadSkills, reloadMcpStatus };
}
