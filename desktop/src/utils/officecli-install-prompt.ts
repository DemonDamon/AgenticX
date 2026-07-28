/**
 * Agent prompt for installing OfficeCLI skill + optional host binary.
 * Skill must land under registry/ (or carry source) so Settings labels it as third-party.
 */

const OFFICECLI_SKILL_URL = "https://officecli.ai/SKILL.md";
const OFFICECLI_INSTALL_SH =
  "https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.sh";

/**
 * Build a Meta-Agent install prompt for OfficeCLI (skill files + binary check).
 */
export function buildOfficeCliInstallPrompt(): string {
  return [
    "请为本机 Near / Meta-Agent 安装第三方技能「OfficeCLI」（Word / Excel / PowerPoint 创作与编辑）。",
    "",
    "安装要求（必须遵守，以便设置页正确归类为「第三方技能」）：",
    "1. 将官方 SKILL.md（及若有的子技能 pptx/docx/xlsx）安装到：",
    "   ~/.agenticx/skills/registry/officecli/SKILL.md",
    "   （如官方拆成多个 skill，可分别装到 registry/officecli-pptx、officecli-docx、officecli-xlsx）。",
    "2. 在 SKILL.md frontmatter 中写入 source: registry（或保留上游 source），禁止直接放到 ~/.agenticx/skills/<name>/ 且不带 source。",
    `3. 技能内容优先从 ${OFFICECLI_SKILL_URL} 获取；若不可达再试 GitHub 上 iOfficeAI/OfficeCLI 仓库的 SKILL.md。`,
    "4. 安装完成后用 which officecli 或 officecli --version 检查本机二进制：",
    "   - 若未安装：优先 brew install officecli；否则按官方脚本安装",
    `     curl -fsSL ${OFFICECLI_INSTALL_SH} | bash`,
    "   - 向用户说明二进制为可选运行时依赖，未安装时 skill 仍可见但无法真正改文档。",
    "5. 安装结束后简要汇报：技能路径、source 标记、officecli 是否在 PATH。",
    "",
    "不要把 OfficeCLI 标成内置技能，也不要修改 Near 内置 skill 包。",
  ].join("\n");
}
