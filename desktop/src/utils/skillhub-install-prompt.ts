/** Official SkillHub install doc (Tencent COS) — reference only; do not tell agent to install the store first. */
const SKILLHUB_INSTALL_DOC =
  "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/skillhub.md";

/**
 * Substrings that must never appear in the Meta-agent fallback prompt.
 * Matches the old Settings→Meta dead path (Studio registry install + store-first).
 */
export const SKILLHUB_AGENT_PROMPT_FORBIDDEN: readonly string[] = [
  "POST /api/registry/install",
  "/api/registry/install",
  "请先检查是否已安装 SkillHub 商店",
  "优先调用本机 Studio API",
  "根据 https://skillhub-", // old: fetch install doc then install the store
];

/**
 * Fail-fast: refuse any agent prompt that still steers into the old dead path.
 * `/api/registry/skillhub/install` is allowed (deterministic path); plain
 * `/api/registry/install` is not.
 */
export function assertSafeSkillHubAgentInstallPrompt(text: string): void {
  const body = String(text || "");
  for (const needle of SKILLHUB_AGENT_PROMPT_FORBIDDEN) {
    if (needle === "/api/registry/install" || needle === "POST /api/registry/install") {
      // Allow .../skillhub/install; forbid the bare Studio registry install route.
      const stripped = body.replace(/\/api\/registry\/skillhub\/install/g, "");
      if (stripped.includes(needle)) {
        throw new Error(
          `SkillHub agent install prompt contains forbidden instruction: ${needle}`,
        );
      }
      continue;
    }
    if (body.includes(needle)) {
      throw new Error(
        `SkillHub agent install prompt contains forbidden instruction: ${needle}`,
      );
    }
  }
}

/**
 * Agent fallback prompt for SkillHub installs when the deterministic Desktop
 * IPC path fails (CLI missing, network error, etc.).
 *
 * Prefer Desktop `installFromSkillHub` / Studio
 * `POST /api/registry/skillhub/install` — this prompt is only the fallback.
 *
 * Shortest path only: CLI download into taskspace → skill_manage create → view.
 * Does NOT ask the agent to install the SkillHub store or curl Studio registry APIs.
 */
export function buildSkillHubAgentInstallPrompt(skillSlug: string): string {
  const name = skillSlug.trim();
  if (!name) {
    return "";
  }
  const prompt = [
    `请安装 SkillHub 第三方技能「${name}」（这是确定性安装失败后的 agent 回退路径）。`,
    "",
    "安装要求（必须遵守，以便设置页正确归类为「第三方技能」）：",
    "1. 禁止先检查或部署 SkillHub store；禁止在 Studio 里盲目扫描；禁止 curl/wget 本机 localhost 的旧 Studio registry install API（非 skillhub 专用接口；沙箱内无 desktop token）。",
    "2. 禁止读写 ~/.skillhub 或系统 /tmp（沙箱会 EPERM）。若 CLI 需要 HOME，把 HOME 重定向到当前 taskspace 内目录。",
    `3. 最短路径：skills_store_cli.py --skip-self-upgrade install ${name} --dir <taskspace>/skillhub-dl（下载到当前 taskspace，勿写 ~/.skillhub）。`,
    `4. 再用 skill_manage create：name=registry/${name}，source=skillhub，from_dir=<下载目录>（会带上 references/）。`,
    "5. 创建成功后用 skill_manage action=view 核对 on-disk 内容与 source=skillhub。",
    "6. 禁止把第三方技能直接放到 ~/.agenticx/skills/<name>/ 且不带 source: skillhub。",
    "",
    `确定性安装应走 Desktop IPC installFromSkillHub / POST /api/registry/skillhub/install；本提示仅在其失败后使用。文档备查（不要先装 store）：${SKILLHUB_INSTALL_DOC}`,
  ].join("\n");
  assertSafeSkillHubAgentInstallPrompt(prompt);
  return prompt;
}
