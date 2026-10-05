/**
 * 插件与技能的关联映射:当用户从市场安装某个 MCP 插件时,可同时提示/安装
 * 该插件配套的技能(若技能尚未安装)。
 *
 * 键为 MCP server 名(与 mcp.json / loadMcpStatus 返回的 name 一致),
 * 值为技能标识数组。技能标识分两类:
 *  - registry: 走 installFromRegistry,需 source + name
 *  - recommended: 走 Meta-Agent 安装提示词,只需 id(对应 recommended-skills 的 id)
 *
 * 此表为前端静态配置,后续可迁移到后端按 pluginId 下发。
 */

export type PluginBundledSkill =
  | { kind: "registry"; source: string; name: string; label: string }
  | { kind: "recommended"; id: string; label: string };

export type PluginSkillBundle = {
  /** MCP server 名。 */
  serverName: string;
  /** 该插件配套的技能列表。 */
  skills: PluginBundledSkill[];
};

/**
 * 插件 → 技能包映射表。
 * 仅列出已知存在配套技能的插件;未列出的插件视为无配套技能。
 */
export const PLUGIN_SKILL_BUNDLES: readonly PluginSkillBundle[] = [
  {
    serverName: "feishu",
    skills: [
      { kind: "recommended", id: "tencent-docs", label: "腾讯文档" },
      { kind: "recommended", id: "tencent-ima", label: "ima 知识库" },
    ],
  },
  {
    serverName: "lark",
    skills: [
      { kind: "recommended", id: "tencent-docs", label: "腾讯文档" },
      { kind: "recommended", id: "tencent-ima", label: "ima 知识库" },
    ],
  },
  {
    serverName: "github",
    skills: [
      { kind: "registry", source: "clawhub", name: "github-pr-review", label: "GitHub PR Review" },
    ],
  },
  {
    serverName: "gitlab",
    skills: [
      { kind: "registry", source: "clawhub", name: "gitlab-mr-review", label: "GitLab MR Review" },
    ],
  },
  {
    serverName: "jenkins",
    skills: [
      { kind: "registry", source: "clawhub", name: "jenkins-pipeline-helper", label: "Jenkins Pipeline Helper" },
    ],
  },
];

/**
 * 按 MCP server 名查询配套技能。
 * @param serverName MCP server 名
 * @returns 配套技能列表;无则返回空数组
 */
export function getSkillsForPlugin(serverName: string): readonly PluginBundledSkill[] {
  return PLUGIN_SKILL_BUNDLES.find((b) => b.serverName === serverName)?.skills ?? [];
}

/**
 * 判断某个插件是否存在配套技能。
 */
export function hasBundledSkills(serverName: string): boolean {
  return getSkillsForPlugin(serverName).length > 0;
}
