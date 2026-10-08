/** Official SkillHub install doc (Tencent COS). */
const SKILLHUB_INSTALL_DOC =
  "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/skillhub.md";

/**
 * Agent fallback prompt for SkillHub installs when the deterministic Desktop
 * IPC path fails (CLI missing, network error, etc.).
 *
 * Prefer Desktop `installFromSkillHub` / Studio
 * `POST /api/registry/skillhub/install` — this prompt is only the fallback.
 */
export function buildSkillHubAgentInstallPrompt(skillSlug: string): string {
  const name = skillSlug.trim();
  if (!name) {
    return "";
  }
  return [
    `请安装 SkillHub 第三方技能「${name}」（这是确定性安装失败后的 agent 回退路径）。`,
    "",
    "安装要求（必须遵守，以便设置页正确归类为「第三方技能」）：",
    "1. 不要尝试调用本机 Studio API（agent 沙箱内通常没有可用的 base URL / desktop token）。",
    `2. 若本机有 SkillHub CLI：用 skills_store_cli.py --skip-self-upgrade install ${name} --dir <taskspace>/skillhub-dl 下载到当前 taskspace（勿写 ~/.skillhub）。`,
    `3. 再用 skill_manage create：name=registry/${name}，source=skillhub，from_dir=<下载目录>（会带上 references/）。`,
    "4. 创建成功后用 skill_manage action=view 核对 on-disk 内容与 source。",
    "5. 禁止把第三方技能直接放到 ~/.agenticx/skills/<name>/ 且不带 source: skillhub。",
    "",
    `若尚未安装 SkillHub 商店，请参考 ${SKILLHUB_INSTALL_DOC}；安装 CLI 时优先使用 --skip-self-upgrade，避免读 ~/.skillhub/config.json。`,
  ].join("\n");
}
