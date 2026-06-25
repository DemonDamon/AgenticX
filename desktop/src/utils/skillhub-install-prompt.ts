/** Official SkillHub install doc (Tencent COS). */
const SKILLHUB_INSTALL_DOC =
  "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/skillhub.md";

/**
 * Agent prompt aligned with SkillHub "我是 Agent" install flow (accelerated path).
 *
 * Third-party skills must land under registry/ or carry explicit `source` in
 * SKILL.md so the Desktop settings UI labels them as third-party, not self-built.
 */
export function buildSkillHubAgentInstallPrompt(skillSlug: string): string {
  const name = skillSlug.trim();
  if (!name) {
    return "";
  }
  return [
    `请安装 SkillHub 第三方技能「${name}」。`,
    "",
    "安装要求（必须遵守，以便设置页正确归类为「第三方技能」）：",
    `1. 优先调用本机 Studio API：POST /api/registry/install，body 含 source（已配置的 ClawHub registry 名）与 name: "${name}"。`,
    `2. 若 API 不可用，可将 SKILL.md 安装到 ~/.agenticx/skills/registry/${name}/，并在 frontmatter 写入 source: skillhub。`,
    "3. 禁止把第三方技能直接放到 ~/.agenticx/skills/<name>/ 且不带 source 标记。",
    "",
    `请先检查是否已安装 SkillHub 商店；若未安装，请根据 ${SKILLHUB_INSTALL_DOC} 安装 SkillHub 商店，并优先采用 SkillHub 加速安装，然后安装 ${name} 技能。`,
    "",
    `若已安装 SkillHub 商店，则直接安装 ${name} 技能。`,
  ].join("\n");
}
