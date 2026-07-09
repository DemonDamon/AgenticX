# P1 — Desktop 授权/扫码卡 + 「打开工作区终端」手动接管入口

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.3-codex

> 父规划：`.cursor/plans/2026-07-08-interactive-bash-background-main.plan.md`
> 依赖：P0 已落地（`bash_bg_start` 工具返回值含 `auth_urls`）。**可后置**：P0 完成后二维码/链接已能通过模型转述让用户点开，本 P1 只是把「授权/扫码」做成聊天区可点击卡，并提供「在工作区终端打开」按钮，直接满足用户「内置一个打开终端按钮 / 自己开终端接管」的诉求。

---

## 目标与现状

- 用户诉求（原话）：希望遇到扫码类命令时，Near 能「内置一个按钮打开终端」或「Agent 自己打开终端帮我执行」。
- 主规划已定：不 shell out 到系统终端（跨平台/可观测性问题），而是复用**工作区面板的内嵌终端**做手动接管入口。
- 现状锚点（已核验）：
  - `desktop/src/components/messages/ToolCallCard.tsx`：工具调用卡，已有 `message.toolName`（`58-70`）、`message.toolResultPreview`，并有「按 toolName 渲染专用预览卡」的范式（如 `WidgetBlock`、`SkillPatchPreviewCard`，import 于 `19-27`）。
  - `desktop/src/utils/open-external.ts` `openExternalUrl(...)`（`ToolCallCard.tsx:28` 已引用）——用于「打开链接」。
  - `desktop/src/components/WorkspacePanel.tsx:647` `openTerminalForPath(absPath, labelHint?)` —— 在指定目录打开内嵌 `TerminalEmbed`（`WorkspacePanel.tsx:8,1277`）；右键「在此目录打开终端」即调它（`1317/1350-1351`）。

---

## FR-1：从 `bash_bg_start` 结果解析授权信息

新增解析工具 `desktop/src/components/messages/bash-bg-preview.ts`（与 `skill-manage-preview.ts` / `widget-preview.ts` 同目录同范式）：

```ts
export type BashBgAuth = {
  jobId: string | null;
  status: "running" | "exited" | null;
  cwd: string | null;
  command: string | null;
  authUrls: string[];
};
export function parseBashBgStart(content: string): BashBgAuth | null;
// 解析 P0 返回文本里的 job_id= / status= / cwd= / command= 行，
// 以及 auth_urls: 段下的 `- https://...` 列表；无 auth_urls 时返回 authUrls=[]。
```

**AC-1**：给定 P0 `bash_bg_start` 的标准返回文本，`parseBashBgStart` 正确解出 `jobId/status/cwd/command/authUrls`；非该工具文本返回 `null`。附单测 `bash-bg-preview.test.ts`。

---

## FR-2：授权/扫码卡渲染

在 `ToolCallCard.tsx` 内，当 `message.toolName === "bash_bg_start"` 且 `parseBashBgStart(...)` 得到 `authUrls.length > 0` 时，在卡内（展开态，参照 `forceExpand` 语义 `39`）渲染一个「授权/扫码」区块：

- 标题：`需要授权/扫码` + 状态点（running=琥珀，exited=绿/灰）。
- 每个 auth URL 一行：可点击（`openExternalUrl`）+ 「复制链接」按钮。
- 一句引导文案：`请用飞书/对应 App 扫码或点击链接完成授权，完成后回到对话告诉我。`
- 「在工作区终端打开」按钮（见 FR-3）。

样式复用主题 token（禁止硬编码颜色，遵循既有卡片；参照 `WidgetBlock`/`SkillPatchPreviewCard` 的容器样式），默认展开该卡（有待用户操作，语义同 `forceExpand`）。

**AC-2**：`bash_bg_start` 返回含 URL 时，聊天区该工具卡内出现可点击链接 + 复制按钮 + 引导文案；无 URL 时不渲染该区块（回退为普通工具卡）。

---

## FR-3：「在工作区终端打开」跨组件触发

卡片在消息流中，`openTerminalForPath` 在 `WorkspacePanel`；需要一个轻量跨组件信号：

- 方案（推荐，最小侵入）：在按钮点击时 `window.dispatchEvent(new CustomEvent("agx:open-terminal", { detail: { cwd, command } }))`；`WorkspacePanel.tsx` 内 `useEffect` 注册监听，收到后调用 `openTerminalForPath(detail.cwd, "授权")`，并在终端可选地预填 `detail.command`（若 `TerminalEmbed`/pty 支持写入初始命令则预填，否则仅打开目录，由用户自行粘贴——预填为增强项，不作硬 AC）。
- `cwd` 取 `parseBashBgStart` 的 `cwd`（P0 已在返回值给出绝对路径）；为空时回退当前会话工作区根。
- 点击后确保侧栏切到工作区/终端 tab（复用 `WorkspacePanel` 既有 tab 逻辑）。

**AC-3**：点击「在工作区终端打开」→ 工作区面板打开一个位于该 `cwd` 的内嵌终端；不新起系统终端窗口；跨平台一致（不依赖 macOS `open`）。

---

## FR-4：进行中可感知状态（轻量）

- 当 `status=running` 时，卡片状态点用「运行中」态（复用既有 `Shimmer`/spinner 语义，`ToolCallCard.tsx:18`），避免看起来「卡住无反馈」。
- 不新增独立轮询 UI；模型侧按 P0 prompt 规则低频 `bash_bg_poll`，每次 poll 结果作为新消息进入对话流，用户可见进度。

**AC-4**：running 态卡片有明确「运行中」视觉；exited 态显示最终状态；无长时间静态 ⏳。

---

## In scope / Out of scope（本子规划）

**In scope**：FR-1~FR-4——解析、授权卡、打开工作区终端按钮、running 态视觉；对应单测。
**Out of scope**：
- 不新增系统级终端窗口 / 不 `open -a Terminal`。
- 不改 P0 工具返回格式（仅解析）。
- 不实现前端主动轮询循环（轮询由模型按 prompt 规则驱动）。
- 不改 `TerminalEmbed`/pty 底层协议（预填命令为可选增强，能力不具备则仅打开目录）。
- 不动无关组件与主题 token 定义。

## 验收门槛
- `desktop` 侧 `npm run typecheck` 与 `npm run build` 绿。
- 新增 `bash-bg-preview.test.ts` 通过。
- 手动回归：Near 执行 `lark-cli config init --new`（P0 生效）→ 聊天区出现授权卡（链接可点/可复制）→ 点「在工作区终端打开」在正确目录起终端。

## Traceability
- Plan-Id: `2026-07-08-interactive-bash-background-p1-desktop-ux`
- Plan-File: `.cursor/plans/2026-07-08-interactive-bash-background-p1-desktop-ux.plan.md`
- 提交须含 `Plan-Model`/`Impl-Model`（用户提供）+ `Made-with: Damon Li`。
