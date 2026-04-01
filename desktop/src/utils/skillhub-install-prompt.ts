/** Official SkillHub install doc (Tencent COS). */
const SKILLHUB_INSTALL_DOC =
  "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/skillhub.md";

/**
 * Agent prompt aligned with SkillHub "我是 Agent" install flow (accelerated path).
 */
export function buildSkillHubAgentInstallPrompt(skillSlug: string): string {
  const name = skillSlug.trim();
  if (!name) {
    return "";
  }
  return [
    `请先检查是否已安装 SkillHub 商店，若未安装，请根据 ${SKILLHUB_INSTALL_DOC} 安装 Skillhub商店，并且优先采用 SkillHub 加速安装技能，然后安装${name}技能。`,
    "",
    `若已安装，则直接安装${name}技能。`,
  ].join("\n");
}
