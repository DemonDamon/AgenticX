/**
 * 企业对桌面端「能装什么」的管控开关。
 *
 * 客户要求员工不能自行部署 Skill/MCP，也不要本机自动扫描——货架由管理员决定，桌面端
 * 只消费下发的能力包。这三项跟着 bootstrap 一起下发，桌面端据此隐藏对应入口。
 */
export type DesktopCapabilityPolicy = {
  /** 允许员工在本机自行安装 Skill。 */
  allowLocalSkillInstall: boolean;
  /** 允许员工在本机自行添加 MCP Server。 */
  allowLocalMcpInstall: boolean;
  /** 允许扫描本机其它 AI 工具的 MCP 配置路径并导入。 */
  allowMcpAutoDiscovery: boolean;
};

/**
 * 默认全开。
 *
 * 这三个开关是后加的，默认值必须是「和加它们之前一样」——否则老租户升上来会突然发现
 * 员工装不了东西，而管理员根本没配过这一项。要锁的客户自己关。
 */
export const DEFAULT_DESKTOP_CAPABILITY_POLICY: DesktopCapabilityPolicy = {
  allowLocalSkillInstall: true,
  allowLocalMcpInstall: true,
  allowMcpAutoDiscovery: true,
};

function readFlag(source: Record<string, unknown>, key: keyof DesktopCapabilityPolicy): boolean {
  const value = source[key];
  // 只认真正的布尔 false。字符串 "false"、0、null 这些都当成「没配」，
  // 因为把「配歪了」解读成「关闭」会静默锁死一个租户。
  return value === false ? false : DEFAULT_DESKTOP_CAPABILITY_POLICY[key];
}

export function normalizeDesktopCapabilityPolicy(raw: unknown): DesktopCapabilityPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_DESKTOP_CAPABILITY_POLICY };
  }
  const source = raw as Record<string, unknown>;
  return {
    allowLocalSkillInstall: readFlag(source, "allowLocalSkillInstall"),
    allowLocalMcpInstall: readFlag(source, "allowLocalMcpInstall"),
    allowMcpAutoDiscovery: readFlag(source, "allowMcpAutoDiscovery"),
  };
}

/** 三项全关时桌面端整个「自助添加」区域都该消失，而不是留一堆灰按钮。 */
export function isFullyManagedDesktop(policy: DesktopCapabilityPolicy): boolean {
  return (
    !policy.allowLocalSkillInstall &&
    !policy.allowLocalMcpInstall &&
    !policy.allowMcpAutoDiscovery
  );
}
