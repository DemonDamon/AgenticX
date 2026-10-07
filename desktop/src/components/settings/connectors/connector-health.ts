/**
 * 连接器健康态（SSOT）：native 登录绿 ≠ agent MCP 可用。
 * 纯函数便于单测；主进程探活结果映射到同一套枚举。
 */

export type ConnectorHealth =
  | "connected"
  /** 已登记（native 和/或 MCP 配置存在）但探活失败（如 MCP PAT 401）。 */
  | "degraded"
  | "disconnected"
  | "unwired";

export type GithubHealthInput = {
  /** 设置墙是否接线（AVAILABLE）。 */
  wired?: boolean;
  /** `gh auth status` 等原生会话是否登录。 */
  nativeConnected: boolean;
  /** mcp.json 是否配置了 github 且带有 token 槽位。 */
  mcpConfigured: boolean;
  /**
   * MCP 凭据探活：true=API OK；false=401/403 等；
   * null=未配置或未探活。
   */
  mcpAuthOk: boolean | null;
};

/**
 * GitHub（native CLI + MCP docker PAT）健康合并规则：
 * - 未接线 → unwired
 * - MCP 已配置且探活失败 → degraded（即使 native 仍绿，聊天工具不可用）
 * - native 已连或 MCP 探活成功 → connected
 * - 其余 → disconnected
 */
export function resolveGithubHealth(input: GithubHealthInput): ConnectorHealth {
  if (input.wired === false) return "unwired";
  if (input.mcpConfigured && input.mcpAuthOk === false) return "degraded";
  if (input.nativeConnected || input.mcpAuthOk === true) return "connected";
  return "disconnected";
}

/** 市场「已安装」绿标：仅 fully connected。 */
export function healthShowsInstalled(health: ConnectorHealth | undefined): boolean {
  return health === "connected";
}

/** 市场/设置主 CTA：degraded → 重新授权；connected → 管理；否则连接。 */
export function healthPrimaryAction(
  health: ConnectorHealth | undefined,
): "connect" | "manage" | "reauth" {
  if (health === "degraded") return "reauth";
  if (health === "connected") return "manage";
  return "connect";
}
