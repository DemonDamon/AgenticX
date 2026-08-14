# Archscribe 官方推荐一键安装

Planned-with: Grok 4.6

Suggested-Impl-Model: Composer 2.5

> 纯 Desktop 推荐位接线，复用 OfficeCLI 的 Meta-Agent 安装 prompt 模式。Composer 2.5 可独立落地。

## 背景与根因

用户希望把开源技能 [Archscribe](https://github.com/lazypay/Archscribe)（MIT）出现在 Desktop 设置 → 技能市场 → **官方推荐**，并支持卡片右上角 `+` 一键安装。

现有推荐位清单在 `desktop/src/data/recommended-skills.ts`。唯一已接 `cta: "install"` 的是 OfficeCLI：`SettingsPanel.onRecommendedSkillInstall` 仅当 `skillId === "officecli"` 时调用 `buildOfficeCliInstallPrompt()`，再经 `runInstallPromptInMetaAgent` 开 Meta 会话自动发送安装指令。

**不把 Archscribe 整仓 vendoring 进 `agenticx/skills/`：** 上游含渲染脚本、内置字体、Tabler 图标、Playwright/Chromium 依赖，体积与同步成本高；且 SKILL.md 依赖同目录 `scripts/`、`assets/`、`references/`，只拷一份 SKILL.md 无法渲染。正确做法与 OfficeCLI 一致：仓库只内置**推荐卡片 + 安装 prompt**，运行时 `git clone` 到 `~/.agenticx/skills/registry/archscribe/`，由 `infer_skill_source` 识别为 `registry`（第三方）。

## In scope

- 官方推荐新增 Archscribe 卡片（`tier: third_party`，`cta: install`）
- `+` 触发 Meta-Agent 安装 prompt：浅克隆完整仓库到 registry 路径、装 Python 依赖、可选浏览器渲染器
- 推荐区图标 SVG

## Out of scope

- 不把 Archscribe 源码/字体/脚本拷进本仓库
- 不改 ClawHub / SkillHub 搜索
- 不改技能扫描、source 推断、内置 skill 包
- 不做「已安装」态（OfficeCLI 卡片也没有）

## 子规划 → 推荐模型

| 子规划 | 推荐模型 | 理由 |
| --- | --- | --- |
| 推荐卡片 + 安装 prompt + Settings 接线 | Composer 2.5 | 复用 OfficeCLI 样板 |

## FR / AC

- **FR-1:** 官方推荐网格出现 Archscribe 卡片（第三方 · 架构可视化），`+` 为一键安装而非打开官网。
- **AC-1:** `RECOMMENDED_SKILLS` 含 `id: "archscribe"`，`cta: "install"`，`tier: "third_party"`，`official_url` 为 `https://github.com/lazypay/Archscribe`。
- **AC-2:** 点 `+` 关闭设置并打开 Meta 窗格，自动发送的 prompt 含 clone 目标 `~/.agenticx/skills/registry/archscribe`、禁止写入内置 skill 包。
- **AC-3:** 筛选「第三方」可见，「企业官方」不可见。
- **AC-4:** 卡片有本地 SVG 图标，加载失败回落首字母。

## 落点

### 1. 图标

Create: `desktop/src/assets/recommended/archscribe.svg`
风格对齐现有 128×128、`rx=28` 圆角方标；深色底 + 节点/连线，暗示架构图，无文字。

### 2. 安装 prompt

Create: `desktop/src/utils/archscribe-install-prompt.ts`
对齐 `desktop/src/utils/officecli-install-prompt.ts`：

- 目标目录：`~/.agenticx/skills/registry/archscribe`（须含 `SKILL.md` + `scripts/` + `assets/` + `references/`）
- 已存在则 `git pull --ff-only`，否则 `git clone --depth 1 https://github.com/lazypay/Archscribe.git <dir>`
- `python3 -m pip install -r requirements.txt`；可选 `requirements-browser.txt` + `python -m playwright install chromium`（失败则说明可 `--renderer pillow`）
- 禁止写入 `agenticx/skills/` 内置包，禁止只装 SKILL.md 不装脚本资产
- 汇报：路径、source=registry、依赖是否就绪

### 3. 推荐清单

Modify: `desktop/src/data/recommended-skills.ts`

- import `archscribe.svg`
- 在 OfficeCLI 之后插入一条（第三方区靠前，与 OfficeCLI 同档）

```ts
{
  id: "archscribe",
  name: "Archscribe",
  provider: "lazypay",
  description:
    "手绘风动态架构/流程图（深色霓虹或浅色纸面）；输出可编辑 Excalidraw、PNG 与动画 GIF。点安装后由 Meta-Agent 克隆仓库并安装 Python 依赖。",
  icon_src: archscribeIcon,
  official_url: "https://github.com/lazypay/Archscribe",
  category: "架构可视化",
  tier: "third_party",
  cta: "install",
}
```

### 4. Settings 接线

Modify: `desktop/src/components/SettingsPanel.tsx`

- import `buildArchscribeInstallPrompt`
- `onRecommendedSkillInstall` 现仅处理 `officecli`（约 L3379–3386）。改为按 id 分发：

```ts
const onRecommendedSkillInstall = (skillId: string) => {
  const prompt =
    skillId === "officecli"
      ? buildOfficeCliInstallPrompt()
      : skillId === "archscribe"
        ? buildArchscribeInstallPrompt()
        : "";
  if (!prompt.trim()) return;
  void runInstallPromptInMetaAgent(prompt);
};
```

不改卡片渲染：`cta === "install"` 已走 `onRecommendedSkillInstall`，不展示「官网」链。

## 验证

- Desktop 设置 → 技能 → 技能市场 → 官方推荐：出现 Archscribe；筛「第三方」可见，筛「企业官方」不可见。
- 点 `+`：设置关闭，Meta 新会话发出安装 prompt（含 registry 路径与 clone URL）。
- 不启动 agx serve 也可静态确认：`recommended-skills.ts` 条目与 `onRecommendedSkillInstall` 分支存在。
