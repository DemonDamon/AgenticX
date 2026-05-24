# Plan: Desktop 品牌改名 Machi → Near（用户可见层重塑，保留内部 ID 与用户数据）

- Plan-Id: 2026-05-24-rename-machi-to-near
- Plan-File: .cursor/plans/2026-05-24-rename-machi-to-near.plan.md
- Owner: Damon Li
- Status: Draft

## 背景与问题

当前 Desktop 桌面端产品名为 **Machi**（源自《全职猎人》情怀梗），分布在仓库 200+ 文件中。问题：

1. **认知门槛高**：中英用户都需要解释发音（"马其？玛奇？"），不利于对外传播与 SEO。
2. **与产品定位脱节**：Machi 是个人 IP 情怀，与"端侧本地优先 AI 助手"的定位无强关联。
3. **官网/客户文档语境怪**：Enterprise 客户文档里频繁出现 Machi，但客户不知道也不在乎这是什么梗。

希望统一改名为 **Near**——语义指向"贴近用户、就在身边的本地 AI"，与产品架构一致（本地后端 + 端侧推理 + 贴身助手）。

**核心约束**：改名 ≠ 重装。用户磁盘上有：

- `~/.agenticx/` 全局配置目录与所有 session、memory、skills、avatars、bindings
- `agx-*` 前缀的 localStorage key（窗格状态、token 累计缓存、工作区快照等）
- 已持久化的 `messages.json` 中 `avatar_name: "Machi"`、群聊路由 mention 名 `"Machi"`
- macOS 已签名/notarized 的 `com.agenticx.desktop` Bundle ID 与对应数据目录

**这些一律不动**。本 plan 只重塑「用户在 UI / Dock / 标题 / 文案」看到的产品名。

## 目标（Goals）

- **G1**：Desktop 桌面端所有用户可见文案、窗口标题、Dock/任务栏名称、DMG/NSIS 安装包名展示为 `Near`。
- **G2**：默认元智能体（Meta-Agent）展示名为 `Near`；新建会话的 `avatar_name`、群聊 mention、飞书/微信回复前缀均为 `Near`。
- **G3**：历史会话与持久化数据（`avatar_name: "Machi"`、群聊里旧 mention 等）在**展示层做向后兼容映射**，自动渲染为 `Near`，不需要用户手动迁移或重置。
- **G4**：品牌字符串集中到 **branding 单一源**（`desktop/src/constants/branding.ts` + `agenticx/branding.py`），后续若再改名只动一处。
- **G5**：Backend 默认 fallback 标签同步为 `Near`，避免「前端传 Near、后端漏传时仍 fallback 到 Machi」造成顶栏与气泡品牌不一致。

## 非目标（Non-Goals）

- **不改** `appId: com.agenticx.desktop`：绑定 macOS 签名/公证/自动更新/用户数据目录路径，改了等于装新 App，旧用户全部断链。
- **不改** `~/.agenticx/` 配置目录与所有子路径（sessions/memory/skills/workspace/feishu_binding.json 等）。
- **不改** `agx-*` 前缀的 localStorage key（agx-meta-avatar-url / agx-session-token-cache-v1 / agx-history-width-v1 等）。
- **不改** 内部 agent identifier：`__meta__`、`META_LEADER_AGENT_ID`、`"meta-agent"`、Python `_DEFAULT_META_PRODUCT_LABEL` 常量名本身（值改成 `"Near"`）。
- **不改** Plan-Id 注释 / 历史文件名（如 `machi-kb-stage1-local-mvp`、`.cursor/plans/2026-05-22-machi-message-queue.plan.md`）——历史锚点，改了会断 `/update-conclusion --plan=...` 的聚合。
- **不改** Enterprise (`enterprise/`) 与 AgenticX-Website (`AgenticX-Website/`) 中的 `MachiAvatar`、`machi-grid-bg`、`MachiChatView.tsx`、`messages/{zh,en}.json` 等——那是另一套产品面，独立 plan 再处理；本 plan 仅限 Desktop + 后端默认 fallback。
- **不改** 第三方依赖 venv（`examples/mydeepresearch/.venv/`）、`docs/` 历史 ADR、`AI 原生交付最佳实践指南` 等已交付文档。
- **不动** 商标/域名/官网域名（near.ai 被 NEAR Protocol 占用的事实存在，由 Owner 另行评估）。
- **不改** Desktop 内部 React 状态机字段 `mode: "machi"` / `target: "machi"`（仅内存态，不落盘，无展示语义，留待 P2 之后独立小 PR 重命名为 `"meta"`）。

## 技术方案

### 1. 单一品牌源（最重要）

**新增**：

- `desktop/src/constants/branding.ts`

  ```typescript
  /** User-visible product / meta-agent display name. */
  export const APP_DISPLAY_NAME = "Near";
  export const META_AGENT_DISPLAY_NAME = "Near";
  export const APP_DESCRIPTION = "Near — AgenticX Desktop";
  
  /** Legacy product names that should still resolve to the current brand. */
  export const LEGACY_META_DISPLAY_NAMES = new Set<string>(["Machi", "machi", "meta"]);
  ```

- `agenticx/branding.py`

  ```python
  """Product branding constants (user-visible defaults).
  
  Author: Damon Li
  """
  
  APP_DISPLAY_NAME = "Near"
  DEFAULT_META_PRODUCT_LABEL = "Near"
  LEGACY_META_LABELS = frozenset({"Machi", "machi"})
  ```

后续所有展示文案改为引用这两个常量。

### 2. 历史数据兼容层

**新增** `desktop/src/utils/display-name.ts`：

```typescript
import { META_AGENT_DISPLAY_NAME, LEGACY_META_DISPLAY_NAMES } from "../constants/branding";

export function resolveMetaDisplayName(raw?: string | null): string {
  const t = (raw ?? "").trim();
  if (!t || t === "分身" || LEGACY_META_DISPLAY_NAMES.has(t)) {
    return META_AGENT_DISPLAY_NAME;
  }
  return t;
}
```

所有读取 `pane.avatarName` / `message.avatarName` / `avatar_name` 用作**展示**的地方改走此函数。**不修改持久化字段本身**（避免一次大规模 messages.json 重写）。

Python 后端 `group_router.py` / `feishu_longconn.py` / `wechat_ilink.py` 同步在 mention 解析、回复构造处认 `Machi` 为 alias，但默认输出 `Near`。

### 3. Desktop 打包与系统注册名

| 文件 | 当前 | 改为 |
|---|---|---|
| `desktop/package.json` | `"productName": "Machi"`、`"description": "Machi - AgenticX Desktop"` | `Near` / `Near — AgenticX Desktop` |
| `desktop/electron-builder.yml` | `productName: Machi` | `productName: Near` |
| `desktop/electron/main.ts` | `app.setName("Machi")`、`title: "Machi"`、tray tooltip `"Machi"`、错误页 `"Machi 界面"` | `"Near"` |
| `desktop/index.html` | `<title>Machi</title>` | `<title>Near</title>` |
| `.github/workflows/build-desktop.yml` | workflow 名 `Machi Desktop Build`、artifact `Machi-${version}-${arch}.dmg` | `Near Desktop Build` / `Near-...` |

**`appId` 保持 `com.agenticx.desktop`**。

### 4. Desktop UI 文案替换

按已扫范围（按目录分组）：

#### `desktop/src/store.ts`
- 默认 `avatarName: "Machi"` → 引用 `META_AGENT_DISPLAY_NAME`
- 注释 `Machi 官网账号`、`Custom avatar for Meta-Agent (Machi)` → `Near`
- `META_AVATAR_URL_KEY = "agx-meta-avatar-url"` **不动**

#### `desktop/src/components/ChatPane.tsx`（13 处）
- 顶栏/气泡显示名 fallback `"Machi"` → `resolveMetaDisplayName()`
- 空态卡片 `Machi` / `Orchestrated by Machi · Executed by AgenticX` → `APP_DISPLAY_NAME` / `Orchestrated by Near · Executed by AgenticX`
- 注释 `machi-kb-stage1-local-mvp` 等 Plan-Id 引用**保留**

#### `desktop/src/components/AvatarSidebar.tsx`（11 处）
- 侧栏入口 alt/title/text `"Machi"` → `APP_DISPLAY_NAME`
- 上下文菜单 `target: "machi"` 与 `mode: "machi"` 内部状态机字段**本 plan 不动**

#### `desktop/src/components/SettingsPanel.tsx`（24 处）
- 所有「Machi」「重启 Machi」「Machi 官网账号」「元智能体（Machi）」等中文文案 → `Near`
- Plan-Id 注释保留

#### `desktop/src/components/AvatarSettingsPanel.tsx`（8 处）
- `Machi · 设置`、`Machi 全局策略`、`下一轮 Machi 对话生效` 等 → `Near`
- 状态机字段 `mode: "machi"` **本 plan 不动**

#### `desktop/src/components/AccountTab.tsx`、`Topbar.tsx`、`ChatView.tsx`
- 「联系 Machi 支持」「登录 Machi 官网账号」「Machi 官网登录状态」 → `Near`

#### `desktop/src/components/messages/ImBubble.tsx`
- 显示名 fallback `"Machi"` → `resolveMetaDisplayName()`

#### `desktop/src/components/SessionHistoryPanel.tsx`
- pane title fallback `"Machi"` → `resolveMetaDisplayName(pane.avatarName)`
- `addPane(...item.avatar_name || "Machi", ...)` → `META_AGENT_DISPLAY_NAME`

#### `desktop/src/voice/realtime/doubao-realtime.ts`、`VoiceSettingsPanel.tsx`
- 默认 `bot_name: "Machi"` → `META_AGENT_DISPLAY_NAME`
- placeholder `"Machi"` → `"Near"`
- 历史 turns 渲染里 `"Machi"` 标签 → `META_AGENT_DISPLAY_NAME`

#### `desktop/src/voice/realtime/openai-realtime.ts`、`VoiceFocusMode.tsx`、`TurnToolGroupCard.tsx`
- 注释「Machi」描述 → `Near`

#### `desktop/src/components/automation/AutomationTab.tsx`、`TaskFormPanel.tsx`、`settings/knowledge/*`、`settings/code-index/*`、`settings/brains/BrainScopePanel.tsx`、`ProjectStatePanel.tsx`、`AvatarToolPermissionDialog.tsx`、`utils/task-stall-policy.ts`、`utils/budget-resume-draft.test.ts`
- 文案中 `Machi` → `Near`
- 测试 fixture 用户输入中的 `Machi`（如 `"安装 skill 到 Machi"`）**保留**——那是模拟历史用户消息，正好覆盖兼容路径

#### `desktop/electron/main.ts`
- 注释 `Machi 官网 / Supabase 账号`、`Machi 会话` 等 → `Near`
- `"两个 Machi 窗格"` → `"两个 Near 窗格"`
- 错误页 `"无法加载 Machi 界面"` / 启动失败弹窗 → `Near`

### 5. Backend Python fallback 同步

| 文件 | 改动 |
|---|---|
| `agenticx/runtime/meta_tools.py` | `_DEFAULT_META_PRODUCT_LABEL = "Machi"` → `from agenticx.branding import DEFAULT_META_PRODUCT_LABEL as _DEFAULT_META_PRODUCT_LABEL` |
| `agenticx/runtime/group_router.py` | `self._meta_leader_label = label or "Machi"` → `or DEFAULT_META_PRODUCT_LABEL`；mention alias 表追加 `"machi"` 保留兼容；`META_LEADER_NAME = "组长"` **不动** |
| `agenticx/studio/server.py` | 两处 `or "Machi"` fallback → `or DEFAULT_META_PRODUCT_LABEL` |
| `agenticx/gateway/feishu_longconn.py` | 回复前缀 `[Machi]` → `[Near]`；中文提示「**飞书绑定 Machi 会话**」「Machi 在线」「Machi 客户端」「默认 Machi 会话」 → `Near` |
| `agenticx/gateway/adapters/wechat_ilink.py` | `AGX_WECHAT_REPLY_NAME` 默认 `"Machi"` → `DEFAULT_META_PRODUCT_LABEL`；环境变量名**不动**（兼容已有部署） |
| `agenticx/gateway/client.py`、`router.py`、`connect_page.py` | 用户可见文案 `Machi` → `Near`（飞书/微信下行文案） |
| `agenticx/cli/main.py` | `agx feishu` 提示「Machi 执行」「Machi (or agx serve) ...」 → `Near` |
| `agenticx/cli/agent_tools.py` | 错误提示「请在 Machi 设置中开启...完全重启 Machi」 → `Near` |
| `agenticx/studio/kb/runtime.py` | 用户可见提示文案 `重启 Machi` → `Near`；模块 docstring「Machi Stage-1 MVP」**保留**（历史锚点） |
| `agenticx/studio/web_search/providers.py` | `User-Agent: MachiWebSearch/1.0` **保留**（对外可观测 token，改了影响日志聚合；如要改单列后续 PR） |
| `agenticx/code_index/tools.py` | 文案「请在 Machi 设置 → 知识库」 → `Near` |
| `agenticx/runtime/global_mcp_manager.py`、`global_mcp_state.py`、`cli/studio_mcp.py` | docstring 与注释里 `Machi` → `Near`（顺手，但属低优先） |
| `agenticx/skills/bundled/code-dev-workflow/SKILL.md`、`agenticx-automation-crontask/SKILL.md` | description 里 `Machi` → `Near`（skill 描述会被 LLM 读到，影响判定） |

**docstring 与模块顶部说明里的 `Machi Stage-1 MVP` / `Machi KB MVP` 等历史名称保留**（Plan-Id 锚点性质）。

### 6. 静态资源

- `desktop/assets/machi-logo-transparent.png`、`desktop/assets/machi-empty-state.svg`、`desktop/assets/export_embedded.png`：**先保留文件名**（被 `import` 引用，且与品牌图素无关），仅在 P5 末尾视觉资产替换时一并改名。
- 应用图标 `desktop/assets/icon.icns` / `icon.ico` 是否换风格由 Owner 决定，本 plan 不在范围内。

## 实施分段（Phases）

### P0：建立 branding 单一源（30 min）

- FR-0.1：新增 `desktop/src/constants/branding.ts`，导出 `APP_DISPLAY_NAME` / `META_AGENT_DISPLAY_NAME` / `APP_DESCRIPTION` / `LEGACY_META_DISPLAY_NAMES`。
- FR-0.2：新增 `agenticx/branding.py`，导出 `APP_DISPLAY_NAME` / `DEFAULT_META_PRODUCT_LABEL` / `LEGACY_META_LABELS`。
- FR-0.3：新增 `desktop/src/utils/display-name.ts`，实现 `resolveMetaDisplayName()`。
- AC-0.1：`npm --prefix desktop run build` 通过；`python -c "from agenticx.branding import APP_DISPLAY_NAME; print(APP_DISPLAY_NAME)"` 输出 `Near`。
- **Commit 1**：`feat(branding): introduce Near brand constants (TS + Python)`
- Plan-Id trailer：`Plan-Id: 2026-05-24-rename-machi-to-near`

### P1：Desktop 打包与系统注册名（1h）

- FR-1.1：改 `desktop/package.json` 的 `productName` / `description`。
- FR-1.2：改 `desktop/electron-builder.yml` 的 `productName`。
- FR-1.3：改 `desktop/electron/main.ts` 的 `app.setName` / 窗口 title / tray tooltip / 错误页文案；其余注释里 Machi 也顺手改。
- FR-1.4：改 `desktop/index.html` 的 `<title>`。
- FR-1.5：改 `.github/workflows/build-desktop.yml` 的 `name` / `run-name` 与构建注释；artifact 名跟随 `productName` 自动变化。
- AC-1.1：`npm --prefix desktop run build` 通过；本机 `npm --prefix desktop run dev` 启动后 Dock/标题显示 `Near`。
- AC-1.2：`grep -r "Machi" desktop/electron-builder.yml desktop/package.json desktop/electron/main.ts desktop/index.html` 无匹配（注释里的产品文案也清掉）。
- **Commit 2**：`feat(desktop): rename app/window/tray to Near and wire branding`
- Plan-Id trailer 同上

### P2：Desktop UI 文案与兼容层（2h）

- FR-2.1：`desktop/src/store.ts` 默认 `avatarName` 引用 `META_AGENT_DISPLAY_NAME`；相关注释更新。
- FR-2.2：`ChatPane.tsx` / `ImBubble.tsx` / `SessionHistoryPanel.tsx` / `AvatarSidebar.tsx` 所有显示名 fallback 改走 `resolveMetaDisplayName()`；硬编码 `"Machi"` 文案 → `APP_DISPLAY_NAME`。
- FR-2.3：`SettingsPanel.tsx` / `AvatarSettingsPanel.tsx` / `AccountTab.tsx` / `Topbar.tsx` / `ChatView.tsx` 中文文案的 `Machi` → `Near`。
- FR-2.4：`voice/realtime/{doubao,openai}-realtime.ts` + `VoiceSettingsPanel.tsx` + `VoiceFocusMode.tsx` 中 `bot_name` 默认值 / placeholder / 标签 → `META_AGENT_DISPLAY_NAME`。
- FR-2.5：`automation/*`、`settings/knowledge/*`、`settings/code-index/*`、`settings/brains/*`、`ProjectStatePanel.tsx`、`AvatarToolPermissionDialog.tsx`、`utils/task-stall-policy.ts` 文案更新；测试 fixture 中模拟用户消息**保留** `"Machi"`。
- AC-2.1：`npm --prefix desktop run build` 通过；`tsc -p desktop/electron/tsconfig.json` 通过。
- AC-2.2：手测：本机 `dev` 模式打开 Desktop，新建会话顶栏/气泡/侧栏/空态显示 `Near`；切换到一个旧的、`avatar_name: "Machi"` 的历史会话，UI 仍显示 `Near`（兼容层生效），底层 `messages.json` 文件**未被改写**。
- AC-2.3：`rg "\"Machi\"|'Machi'" desktop/src/ --type ts --type tsx` 仅剩 (a) `branding.ts` 自身的 LEGACY 集合、(b) `display-name.ts` 自身、(c) 注释里的 Plan-Id 锚点 `machi-kb-stage1-local-mvp` 等；无其他硬编码。
- **Commit 3**：`feat(desktop): swap UI copy to Near with legacy-name compat`

### P3：Backend Python fallback 与 IM 网关文案（1h）

- FR-3.1：`meta_tools.py` / `studio/server.py` / `group_router.py` fallback 改读 `agenticx.branding.DEFAULT_META_PRODUCT_LABEL`；`group_router.py` mention alias 表追加 `"machi"`（小写）保留兼容。
- FR-3.2：`gateway/feishu_longconn.py` / `gateway/adapters/wechat_ilink.py` / `gateway/router.py` / `gateway/client.py` / `gateway/connect_page.py` 用户可见文案 `Machi` → `Near`；`AGX_WECHAT_REPLY_NAME` env 名**不动**，仅默认值改。
- FR-3.3：`cli/main.py` / `cli/agent_tools.py` / `studio/kb/runtime.py` / `code_index/tools.py` 用户可见提示更新；`global_mcp_manager.py` / `studio_mcp.py` 等内部 docstring 顺手更新。
- FR-3.4：bundled SKILL.md（`code-dev-workflow`、`agenticx-automation-crontask`）description 字段 `Machi` → `Near`，避免 skill 召回提示词里出现旧名。
- AC-3.1：`pytest -x tests/test_smoke_*.py` 全绿（不引入新测试，验证不破现有）。
- AC-3.2：手测：飞书绑定 → 发消息 → 回复以 `[Near]` 起头；微信 sidecar 同理。
- AC-3.3：群聊里 `@machi` 仍能 mention 到 meta-leader（兼容 alias 生效）；新对话 `@Near` 也能命中。
- **Commit 4**：`feat(runtime): default meta-agent and IM replies to Near`

### P4：验收与文档收尾（30 min）

- FR-4.1：更新 `desktop/README.md`、`README.md` / `README_ZN.md`、`docs/guides/machi-remote-mcp.md`（**文件名保留**，内部正文 `Machi` → `Near`，并在顶部加一行 "Machi 是 Near 的前身名称，本文为旧文档保留"）。
- FR-4.2：`AGENTS.md` 顶部加一段 "Brand note: The desktop app was renamed from Machi to Near on 2026-05-24. Existing references to 'Machi' in plan files, conclusions, and historical docs are intentionally preserved."
- AC-4.1：`npm --prefix desktop run build:mac:arm64` 本机出包（如本机有 arm64 mac），DMG 文件名为 `Near-${version}-arm64.dmg`。
- AC-4.2：从全新用户身份打开新装包，未导入 `~/.agenticx` 时显示 `Near`；有旧 `~/.agenticx` 时，历史会话/分身/绑定全部保留可见。
- **Commit 5（可与 4 合并）**：`docs: note Near rename and update Desktop README`

## 风险与回滚

- **风险 1**：漏改某处用户可见文案，dev 包某窗口仍显示 Machi → AC-2.3 的 `rg` 验证 + 启动后逐 tab 自检；遗漏的小批补丁式修复，不需要整体回滚。
- **风险 2**：群聊历史里旧用户消息 `@Machi` 在新代码下匹配不到 meta-leader → P3 alias 表显式保留 `"machi"` 兜底；新增 1 条群聊冒烟测试覆盖 `@machi` → meta_direct 路由。
- **风险 3**：飞书 `[Machi]` → `[Near]` 改动后，下游做关键词过滤的运维脚本失效 → 在 commit message 与 `docs/changelog.md` 中明确告知；如有外部规则要联调，必要时保留双前缀过渡（默认 `[Near]`，env `AGX_KEEP_LEGACY_REPLY_PREFIX=1` 时同时输出 `[Machi]`）——若 P3 实施时 Owner 确认无下游脚本则跳过此兜底。
- **风险 4**：用户已有图标缓存（macOS Dock / Launchpad）仍显示 Machi → 文档里给出 `killall Dock; killall Finder` 与 `sudo /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user` 的清缓存提示。
- **风险 5**：`enterprise/` 与 `AgenticX-Website/` 暂不同步改名，导致客户文档与桌面端品牌短暂不一致 → 在 plan 末尾「延伸 plan」中登记；本 plan 只承诺 Desktop。
- **回滚**：5 个 commit 完全独立，可按顺序反向 revert；branding 常量改回 `"Machi"` 即可瞬间回切（兼容层使整个回滚路径无副作用）。

## 测试计划

- **后端冒烟**：
  - 现有 `tests/test_smoke_*.py` 全跑过；不引入新测试。
  - 手动：构造一条历史 `messages.json` 中 `avatar_name: "Machi"` 的会话，跑 `/api/chat`，断言 SSE 流里 `avatar_name` 字段依然按持久化原样回传（不被强行改写），UI 由前端兼容层渲染为 `Near`。
- **前端**：
  - 现有 `desktop/src/utils/budget-resume-draft.test.ts` 中 `Machi` fixture 不动（验证兼容路径）。
  - 新增 `desktop/src/utils/display-name.test.ts`，覆盖 `resolveMetaDisplayName` 对 `"Machi"` / `"machi"` / `"meta"` / `""` / `"分身"` / `"自定义名"` 的各种输入。
  - 手测：
    1. 全新用户：清空 `~/.agenticx`，打开新装包，全程显示 `Near`。
    2. 升级用户：保留旧 `~/.agenticx`，打开新装包，所有历史会话标题/侧栏/顶栏/气泡显示 `Near`，但 `messages.json` 文件磁盘内容 diff 为空。
    3. 群聊：`@machi 帮我查 X`、`@Machi 帮我查 X`、`@Near 帮我查 X` 三种写法都能路由到 meta-leader。
    4. 飞书绑定：默认回复以 `[Near]` 起头；历史 `[Machi]` 前缀仍可在历史 session 中读到。
    5. Voice Focus 模式：进入后默认 `bot_name` 字段显示 `Near`，对话归档到当前 meta session。

## 不在本 plan 范围内的延伸想法（仅记录）

- **延伸 1**：`enterprise/` 与 `AgenticX-Website/` 的 `MachiAvatar` / `MachiChatView` / `messages/{zh,en}.json` / `machi-grid-bg` 同步改名 → 独立 plan（涉及客户文档、SEO 与 i18n 词条更新，影响面更大）。
- **延伸 2**：Desktop 内部状态机字段 `mode: "machi"` / `target: "machi"` 重命名为 `"meta"` → 独立小 PR，纯内存态，零持久化风险。
- **延伸 3**：bundled skills 与 `docs/` 历史文档（如 `docs/plans/2026-04-13-machi-chatbox-pattern.md`）的全面更名 → 视需要单独清扫，不影响功能。
- **延伸 4**：应用图标视觉刷新（与改名解耦） → Owner 评估后另开 plan。
- **延伸 5**：商标/域名/官网域名注册与冲突评估（near.ai / nearapp.com 等） → 业务侧动作，非本仓库 plan。
- **延伸 6**：把磁盘上已持久化的 `avatar_name: "Machi"` 一次性 backfill 为 `"Near"` → 不必要；兼容层已足够，且 backfill 有写入风险。

