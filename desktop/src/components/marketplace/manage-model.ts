/**
 * 管理视图纯函数层:已装插件(MCP)与本地技能的行拼装 + 搜索过滤。
 * 不依赖 React/bridge,便于单测;数据拉取与交互见 ManageView。
 */

import type { MarketMcpEntry } from "./model";

/** 技能 Tab 行输入(/api/skills items 的最小投影)。 */
export type ManageSkillRowInput = {
  name: string;
  description: string;
  source?: string;
  globally_disabled?: boolean;
};

export type ManageSkillRow = {
  key: string;
  name: string;
  description: string;
  source: string;
  disabled: boolean;
};

/** 插件 Tab 行输入(loadMcpStatus servers 的最小投影)。 */
export type ManageMcpServerInput = {
  name: string;
  connected?: boolean;
  tool_count?: number;
};

export type ManageMcpRow = {
  key: string;
  name: string;
  connected: boolean;
  toolCount: number;
  /** 从市场条目按 server 名匹配到的 logo(匹配不到由图标组件回退渐变)。 */
  logoUrl?: string;
};

function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/** 技能行拼装:按名称/描述/来源过滤,保留禁用态。 */
export function buildManageSkillRows(
  skills: readonly ManageSkillRowInput[],
  query: string,
): ManageSkillRow[] {
  return skills
    .filter((s) => matchesQuery(query, s.name, s.description, s.source))
    .map((s) => ({
      key: `skill:${s.name}`,
      name: s.name,
      description: String(s.description ?? ""),
      source: String(s.source ?? ""),
      disabled: Boolean(s.globally_disabled),
    }));
}

/** 插件行拼装:server 名与市场条目的 serverNames 匹配拿 logo,按名称过滤。 */
export function buildManageMcpRows(
  servers: readonly ManageMcpServerInput[],
  mcpEntries: readonly MarketMcpEntry[],
  query: string,
): ManageMcpRow[] {
  return servers
    .filter((s) => matchesQuery(query, s.name))
    .map((s) => {
      const entry = mcpEntries.find((e) => e.serverNames.includes(s.name));
      return {
        key: `mcp:${s.name}`,
        name: s.name,
        connected: Boolean(s.connected),
        toolCount: Number(s.tool_count ?? 0),
        logoUrl: entry?.logoUrl,
      };
    });
}
