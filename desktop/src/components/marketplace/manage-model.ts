/**
 * 管理视图纯函数层:已装插件(MCP)与本地技能的行拼装 + 搜索过滤。
 * 不依赖 React/bridge,便于单测;数据拉取与交互见 ManageView。
 */

import { normalizeSkillName, type MarketMcpEntry } from "./model";

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

/** 专家 Tab 行输入(listAvatars 返回的最小投影)。 */
export type ManageAgentRowInput = {
  id: string;
  name: string;
  role?: string;
  description?: string;
  avatar_url?: string;
};

export type ManageAgentRow = {
  key: string;
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
};

/** 指令 Tab 行输入(builtin 开关态 + 自定义指令存储行的最小投影)。 */
export type ManageCommandRowInput = {
  name: string;
  description?: string;
  builtin?: boolean;
  scope?: string;
  /** builtin 指令启停态;自定义指令忽略。 */
  enabled?: boolean;
  /** 自定义指令存储 id(删除用;builtin 行忽略)。 */
  id?: string;
};

export type ManageCommandRow = {
  key: string;
  name: string;
  description: string;
  builtin: boolean;
  /** builtin 启停态;自定义指令恒视为可用。 */
  enabled: boolean;
  /** 自定义指令存储 id(builtin 行为空)。 */
  commandId?: string;
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

/** 插件行拼装:server 名与市场条目的 serverNames 归一化匹配拿 logo,按名称过滤。 */
export function buildManageMcpRows(
  servers: readonly ManageMcpServerInput[],
  mcpEntries: readonly MarketMcpEntry[],
  query: string,
): ManageMcpRow[] {
  return servers
    .filter((s) => matchesQuery(query, s.name))
    .map((s) => {
      const target = normalizeSkillName(s.name);
      const entry = mcpEntries.find((e) =>
        e.serverNames.some((n) => normalizeSkillName(n) === target),
      );
      return {
        key: `mcp:${s.name}`,
        name: s.name,
        connected: Boolean(s.connected),
        toolCount: Number(s.tool_count ?? 0),
        logoUrl: entry?.logoUrl,
      };
    });
}

/** 专家行拼装:按名称/描述过滤;描述取 description → role 回退。 */
export function buildManageAgentRows(
  agents: readonly ManageAgentRowInput[],
  query: string,
): ManageAgentRow[] {
  return agents
    .filter((a) => a.id && a.name)
    .filter((a) => matchesQuery(query, a.name, a.description, a.role))
    .map((a) => ({
      key: `agent:${a.id}`,
      id: a.id,
      name: a.name,
      description: String(a.description ?? a.role ?? ""),
      avatarUrl: a.avatar_url,
    }));
}

/** 指令行拼装:builtin 行带启停态,自定义行带存储 id(编辑/删除用)。 */
export function buildManageCommandRows(
  commands: readonly ManageCommandRowInput[],
  query: string,
): ManageCommandRow[] {
  return commands
    .filter((c) => c.name)
    .filter((c) => matchesQuery(query, c.name, c.description))
    .map((c) => ({
      key: `command:${c.builtin ? "builtin" : (c.scope ?? "global")}:${c.name}`,
      name: c.name,
      description: String(c.description ?? ""),
      builtin: Boolean(c.builtin),
      enabled: c.builtin ? c.enabled !== false : true,
      commandId: c.builtin ? undefined : c.id,
    }));
}

/**
 * 筛出在市场条目里没有 logo 匹配的本机 server 名(去重、保持出现顺序)。
 * ManageView 用它驱动后台按名搜索市场、补齐上游 logo。
 */
export function findUnmatchedServerNames(
  servers: readonly ManageMcpServerInput[],
  mcpEntries: readonly MarketMcpEntry[],
): string[] {
  const matched = new Set<string>();
  for (const e of mcpEntries) {
    if (!e.logoUrl) continue;
    for (const n of e.serverNames) matched.add(normalizeSkillName(n));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of servers) {
    const key = normalizeSkillName(s.name);
    if (key && !matched.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(s.name);
    }
  }
  return out;
}

/**
 * 从「按名搜索 + 详情富化」得到的候选里,挑出 server 名匹配且带 logo 的市场条目
 * (归一化比较;找不到返回 undefined,由图标组件走品牌/渐变兜底)。
 */
export function matchServerLogoEntry(
  serverName: string,
  candidates: readonly MarketMcpEntry[],
): MarketMcpEntry | undefined {
  const target = normalizeSkillName(serverName);
  return candidates.find(
    (e) => Boolean(e.logoUrl) && e.serverNames.some((n) => normalizeSkillName(n) === target),
  );
}
