/**
 * 企业对本机「能不能自己装东西」的管控。
 *
 * 客户的要求是：Skill 和 MCP 的货架由管理员决定，员工不能自行部署，也不要扫描本机
 * 其它 AI 工具的配置往里导。桌面端据此隐藏对应入口——注意是隐藏而不是禁用：留一排
 * 灰按钮只会让员工反复点，然后来问为什么。
 */
export type DesktopCapabilityLocks = {
  allowLocalSkillInstall: boolean;
  allowLocalMcpInstall: boolean;
  allowMcpAutoDiscovery: boolean;
};

/** 默认全开。没登录企业、或企业没下发这一项时，本机装什么是用户自己的事。 */
export const UNRESTRICTED_CAPABILITY_LOCKS: DesktopCapabilityLocks = {
  allowLocalSkillInstall: true,
  allowLocalMcpInstall: true,
  allowMcpAutoDiscovery: true,
};

/**
 * 主进程下发的是 snake_case 快照字段，这里只认真正的 false。
 *
 * 配歪了当「没配过」：把无法识别的值读成「关闭」，会让一次字段改名变成全公司装不了
 * 东西，而且现场看不出是策略在拦。
 */
export function readCapabilityLocks(raw: unknown): DesktopCapabilityLocks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...UNRESTRICTED_CAPABILITY_LOCKS };
  }
  const src = raw as Record<string, unknown>;
  return {
    allowLocalSkillInstall: src.allowLocalSkillInstall !== false,
    allowLocalMcpInstall: src.allowLocalMcpInstall !== false,
    allowMcpAutoDiscovery: src.allowMcpAutoDiscovery !== false,
  };
}

/** 三项全关时整个「自助添加」区域都该消失，而不是剩一堆点不动的东西。 */
export function isCapabilitySelfServiceOff(locks: DesktopCapabilityLocks): boolean {
  return (
    !locks.allowLocalSkillInstall &&
    !locks.allowLocalMcpInstall &&
    !locks.allowMcpAutoDiscovery
  );
}
