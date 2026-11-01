---
title: Desktop token UX · AI 创建专家 · 可配置 .agenticx 根目录
date: 2026-10-31
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
baseline: origin/main@3ead16b1
author: Damon Li
---

# Desktop token UX · AI 创建专家 · 可配置 .agenticx 根目录

> **For agentic workers:** 按 Implementation Units 顺序落地；优先铜管 E2E；作者仅 DemonDamon。拆 PR 时一单元一 PR（或明确声明合批理由）。

## Goal Capsule

**Objective:** Near Desktop（v0.6.0 用户反馈）在「真会话预算超限」「AI 创建数字专家」「数据根目录在 Windows 非系统盘」三条路径上，行为可预期、可操作、可验证，且不与已合入的 #71/#72 叠层假报混淆。

**Means:** 三件独立平台能力串行交付——D2 修复 AI 创建专家交接 → D1 补齐真超限卡片的设置深链与「新建会话续接」草稿 → D3 引入可配置 `agx_home`（设置入口 + 重启生效）。

**Authority:** 用户确认（本会话）> 本计划 Product Contract > `origin/main@3ead16b1` 代码事实。

**Stop when:** 三条铜管通过；默认会话上限仍为 500_000；无「清空累计用量」假续跑；未配置时行为与今日 `~/.agenticx` 一致。

## Product Contract

### Problem Frame

2026-10-31 飞书反馈（Near v0.6.0 / glm-5.3-flash）含三件事：

1. 会话出现「会话累计 token 已达上限」（截图显示 522,015 / 500,000，source=session）——属**真超限**，不是 #72（空定时任务叠层误报，已在 #223/`3ead16b1` 关闭）。
2. 数字专家 → AI 创建 →「开始创建」后窗口关闭，专家未出现——用户感知为创建失败。
3. `.agenticx` 希望落到 Windows 非系统盘；设置中无改目录入口。

### Actors

- **A1** 终端用户（含 Windows 客户机磁盘紧张场景）
- **A2** Desktop 开发/实施（需可配置数据根、可铜管验收）

### Requirements

- **R1** 真超限时，预算卡片展示用量/上限/来源，提供「打开设置到会话累计上限」与「新建会话并带上续接草稿」；**不**提高默认 500k；**不**提供清空会话累计作为续跑手段。
- **R2** AI 创建专家：点「开始创建」后必须进入可感知的 Meta 会话，composer 预填创建草稿；不得静默关窗无下文；专家实体仍须经确认 + `create_avatar` 落盘（保持安全协议）。
- **R3** 数据根目录可配置：解析优先级 env →（可选）持久配置 → `Path.home()/".agenticx"`；Desktop 设置有入口；改后需重启后端/应用生效；未配置时行为不变。
- **R4** 主仓准入：通用平台能力进 `agenticx/` + `desktop/`；Windows「建议用非系统盘」仅文案/示例，不把客户盘符写进引擎。

### Flows

- **F1** 超限 → 卡片 → 调整上限（深链）或新建会话续接（草稿可见）
- **F2** 画廊 AI 创建 → 关对话框 → 主聊天 Meta composer 有草稿 → 用户发送 → 确认 → `create_avatar` → 列表可见
- **F3** 设置改数据目录 → 提示重启 → 重启后读写新根下 sessions/avatars/config

### Acceptance Examples

- **AE1** 强制触发 session EXCEEDED：卡片含 current/max；「调整预算上限」打开 Automation 并滚到 sessionCap；「新建会话续接」新 session + composer 非空草稿。
- **AE2** 画廊 AI 填「项目经理助手」点开始创建：对话框关闭后主界面聊天可见预填草稿；发送并确认后专家出现在列表。
- **AE3** 设置数据目录到临时路径并重启：新会话落在新根；未设置时仍用 `~/.agenticx`。

### Scope / Non-goals

**In scope:** D1/D2/D3 如上。

**Non-goals:**

- 不改默认 `DEFAULT_MAX_TOKENS_PER_SESSION` / `TOKEN_BUDGET_DEFAULT_SESSION`（500_000）
- 不做「清空本会话累计」绕过硬截停
- 本轮不做跨 turn 真·会话累计 hydrate（`from_metadata` 生产接线）——另开跟进
- 不把 AI 创建改成无确认的一键 API 落盘
- 不静默迁移整个目录且不重启
- 不改 Electron `userData`/appId；B-pack/客户配置不进 `agenticx/`

### Key Decisions (session-settled)

- **KTD1** Token：只改善真超限提示 + 开新会话出路（用户采纳建议）。
- **KTD2** 三条都进同一主计划，分单元实现；顺序 D2 → D1 → D3。
- **KTD3** 作者仅 DemonDamon；功能分支 + squash；铜管关闭。

### Product Contract preservation

Product Contract unchanged from bootstrap（本文件即为源）。

## Planning Contract

### Technical Design

**D2 AI 创建专家**

- 现状：`AvatarCreateDialog.handleCreateViaChat` 调 `onCreateViaChat` 后立即 `resetAndClose`；`AvatarGalleryView` → `newMetaTask(createDraft)` → `agenticx:pane:new-topic` + `draftText`，**无 autoSend**。
- 根因（产品感知）：关窗无 toast；草稿依赖 new-topic/setComposerText 时序；用户仍停在画廊观感时像「什么都没发生」。
- 方向：关窗前/后保证 `setMainView("chat")`；确认 `draftText` 写入 composer（对齐 ChatPane 已有 new-topic 处理器）；可选短 toast「已打开创建草稿，发送后需确认才会创建」；禁止在无 `create_avatar` 成功时显示「已创建」。

**D1 Token UX**

- 卡片 `BudgetExceededCard` 已有用量与 CTA；缺口：`openSettings("automation")` 无 sessionCap 焦点；`resumeInNewSessionRef` 建了草稿但**未** `setComposerText`/`prepareFreshComposerPaneDraft`。
- 扩展 `SETTINGS_FOCUS_IDS`（镜像 security-rules）；`TokenBudgetConfigSection` 加锚点；修 new-session 草稿写入。

**D3 可配置根目录**

- 今日 `agx_home()` 仅 `Path.home()/".agenticx"`；Electron `CONFIG_DIR` 多处 hardcode。
- 引入单一解析：`AGX_HOME` 或 `AGENTICX_HOME` → 持久化配置（若已有合适键则复用，否则新增）→ 默认；Electron `getAgxHome()` 替换 hardcode；spawn 后端带入 env；设置 General 选目录 + 重启提示。
- 迁移：提供「复制/指向」策略说明；默认不静默搬迁；文档写清风险。

### Sequencing

1. **U1 / D2** 新建专家交接（用户感知失败，优先）
2. **U2 / D1** Token 卡片深链 + 新会话草稿
3. **U3 / D3** 可配置 `agx_home`（爆炸半径最大，最后）

### Assumptions

- 运行时预算守卫在单次 `run_turn` 内累计；卡片文案若仍写「每条消息重置」须与真实行为对齐或诚实改写（调研显示新 Runtime 每 turn 常见；以代码为准在实现时核对后改 i18n）。
- Windows 客户可接受「改目录后重启」。

## Implementation Units

### U1. AI 创建专家可感知交接（D2）

**Covers:** R2, F2, AE2

**Files (expected):**

- `desktop/src/components/AvatarCreateDialog.tsx`
- `desktop/src/components/gallery/AvatarGalleryView.tsx`
- `desktop/src/hooks/usePaneNavigation.ts`
- `desktop/src/components/ChatPane.tsx`（new-topic / draft 应用，若需加固）
- `desktop/locales/{zh,en}/sidebar.json`
- Tests: 新建或扩展 gallery / navigation vitest（路径随现有测试布局）

**Done when:**

- [ ] AI「开始创建」后主视图为 chat，composer 含 `gallery.createDraft` 插值文本
- [ ] 有明确用户可见反馈（toast 或空状态说明），且不声称专家已创建
- [ ] 铜管 AE2 通过
- [ ] 作者 DemonDamon；无 bot Co-authored-by

### U2. 真超限 Token UX（D1）

**Covers:** R1, F1, AE1

**Files (expected):**

- `desktop/src/components/messages/BudgetExceededCard.tsx`
- `desktop/src/components/ChatPane.tsx`（`resumeInNewSessionRef`、`openSettings`）
- `desktop/src/settings-tab.ts`
- `desktop/src/components/automation/TokenBudgetConfigSection.tsx`
- `desktop/src/components/SettingsPanel.tsx`
- `desktop/locales/{zh,en}/chat.json`（`budget.*`）
- Tests: `budget-resume-draft.test.ts` + new-session draft 应用测试；不改默认 500k 的 smoke

**Done when:**

- [ ] sessionCap 深链可滚到锚点
- [ ] 「新建会话续接」composer 有草稿
- [ ] 默认上限仍 500_000
- [ ] 铜管 AE1 通过

### U3. 可配置 `.agenticx` 根目录（D3）

**Covers:** R3, R4, F3, AE3

**Files (expected):**

- `agenticx/utils/agx_home.py`（及逐步收口调用方；优先新调用与 Electron 启动路径）
- `desktop/electron/main.ts`（`getAgxHome` / 替换 `CONFIG_DIR` hardcode 关键路径）
- Settings General（或等价）数据目录控件 + i18n
- 单元测试：`agx_home` 优先级；未设置时默认路径不变

**Done when:**

- [ ] env / 设置 / 默认三层解析文档化并测通
- [ ] 改目录后经重启，会话与配置落在新根
- [ ] Windows 文案提示非系统盘；引擎无硬编码盘符
- [ ] 铜管 AE3 通过

## Verification Contract

- Desktop vitest：触及的组件/工具函数测试全绿
- 相关 Python 单元：`agx_home`、token budget 默认值不变断言
- 铜管（本机 Near Desktop）：AE1 / AE2 / AE3 各至少一条手工或 Playwright 证据（截图或录屏路径写入 PR）
- PR：DemonDamon 作者；main 准入声明 + Non-goals 拷贝进 PR 正文

## Definition of Done

- 三单元均满足各自 Done when
- 与 #71/#72 无关的回归：设置→技能无浮条、空定时任务无预算穿模（抽检）
- 计划中 Non-goals 无一项被「顺手」做进主仓

## Appendix — Evidence breadcrumbs

- Feedback: Near v0.6.0 Feishu note 20261031（用户粘贴 + 四图）
- Closed: #71 / #72 / PR #223 @ `3ead16b1`
- Key symbols: `BudgetExceededCard`, `resumeInNewSessionRef`, `AvatarCreateDialog.handleCreateViaChat`, `newMetaTask`, `agx_home()`, `TOKEN_BUDGET_DEFAULT_SESSION = 500_000`
