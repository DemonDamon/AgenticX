/**
 * Agent prompt for installing the Archscribe skill (full repo, not SKILL.md only).
 * Must land under registry/ so Settings labels it as third-party.
 */

import { META_AGENT_DISPLAY_NAME } from "../constants/branding";

const ARCHSCRIBE_REPO = "https://github.com/lazypay/Archscribe.git";
const ARCHSCRIBE_DIR = "~/.agenticx/skills/registry/archscribe";

/**
 * Build a Meta-Agent install prompt for Archscribe (clone + Python deps).
 */
export function buildArchscribeInstallPrompt(): string {
  return [
    `请为本机 ${META_AGENT_DISPLAY_NAME} / Meta-Agent 安装第三方技能「Archscribe」（手绘风动态架构 / 流程图，输出 Excalidraw、PNG、动画 GIF）。`,
    "",
    "安装要求（必须遵守，以便设置页正确归类为「第三方技能」）：",
    `1. 将完整仓库安装到：${ARCHSCRIBE_DIR}`,
    "   该目录必须同时包含 SKILL.md、scripts/、assets/、references/。",
    "   禁止只下载 SKILL.md：渲染脚本与字体/图标资产缺一不可。",
    `2. 若目标目录已存在且是 git 仓库：在该目录执行 git pull --ff-only。`,
    `   若不存在：git clone --depth 1 ${ARCHSCRIBE_REPO} 到上述路径（把 ~ 展开为用户主目录）。`,
    "3. 安装 Python 依赖（在技能目录内）：",
    "   python3 -m pip install -r requirements.txt",
    "   可选（浏览器主渲染器，手绘观感更好）：",
    "   python3 -m pip install -r requirements-browser.txt && python3 -m playwright install chromium",
    "   若 Playwright/Chromium 安装失败，向用户说明仍可用 --renderer pillow 兜底（PNG/GIF/Excalidraw）。",
    "4. 不要改 SKILL.md 的 name；路径落在 registry/ 即可被识别为第三方，无需标成内置。",
    "5. 安装结束后简要汇报：技能路径、是否含 scripts/render_animated_diagram.py、Pillow 是否可 import、Playwright/Chromium 是否可用。",
    "",
    `不要把 Archscribe 标成内置技能，也不要修改 ${META_AGENT_DISPLAY_NAME} 内置 skill 包，不要写入仓库 agenticx/skills/ 目录。`,
  ].join("\n");
}
