---
module_id: desktop
module_name: Desktop
roots:
  - desktop
summary_schema: code-module-summaries/v1
summary_path: desktop/conclusions/desktop_conclusion.md
---

# Desktop

产品名 **Near**（`package.json` / `electron-builder.yml` 的 `productName`；包版本 `0.6.0`）。Electron 45 + React 18 + Vite 6 + Zustand 5 桌面壳，对接本机或远程 `agx serve`。

> 结论落盘：`desktop/conclusions/`（custom layout）。**核心代码 = `desktop/src`（渲染）+ `desktop/electron`（主进程）**；ownership 扫描 root 为整个 `desktop/`（已排除 dist/node_modules 等）。

## Responsibility

- Electron 主进程（`desktop/electron/`）生命周期：单实例锁、Splash、主窗口、布局持久化、GPU/代理策略。
- 本地后端子进程：`agx serve` / 打包内嵌 `agx-server`；可选远程 `remote_server`。
- IPC 桥（`window.agenticxDesktop`）：配置、会话、分身/群聊、工作区、MCP、Skills、自动化、IM、终端、Focus Mode、项目协作、本地空间、画布案例、网关渠道、MCP OAuth、Harness 切换、企业托管会话与可配置数据根目录。
- 渲染层 UI（`desktop/src/`）：多窗格聊天、侧栏、设置、全屏主视图（市场 / 项目协作 / Wiki / 自动化 / 分身）、工作区/终端、随手聊、设计画布、语音焦点模式。
- 主进程侧：`AutomationScheduler`、飞书 `agx feishu` 子进程、微信 iLink sidecar、connector-runtime sidecar、原生连接器 CLI、`proxyAwareFetch`、node-pty 终端、协作缓存与离线发送、动作审计上送、任务完成系统通知，以及浏览器 Native Messaging host / socket bridge。

明确不拥有：

- Agent 运行时、工具执行、MCP stdio 子进程、LLM 路由、凭证与审批的权威存储（属 Python `agenticx` / Studio；企业门户与 MA 服务是托管智能体、审计和案例库的远端权威）。
- 会话消息落盘（`messages.json` 等）与群聊路由逻辑；Desktop 只消费 REST/SSE。协作房间另有本机副本 `<AGX_HOME>/collab-cache/`，服务端仍是权威。
- Skills/Hooks/KB/Wiki 的索引与写作本体；设置页与 Wiki 浏览经 Studio API 操作。Desktop 负责市场安装 UI、技能开关展示和 Wiki 浏览壳。
- 浏览器扩展本体与 MA 托管执行器；Desktop 只安装/承接 Native Messaging host、转发桥接协议，并把 MA 事件适配成桌面消息。

## Entry points and public interfaces

| 入口 | 路径 / 符号 | 角色 |
|------|-------------|------|
| npm / Electron | `desktop/package.json` → `main: dist-electron/main.js`；`npm run dev` / `build` / `start` | 开发与打包入口 |
| Vite | `desktop/vite.config.ts`：`AGX_DEV_PORT` 或默认 `5713`，`strictPort: true` | 渲染开发服务器 |
| 主进程 | `desktop/electron/main.ts`：`app.whenReady`、`startStudioServe`、`registerIpc`、`createWindow` | 壳层与子进程编排 |
| Preload | `desktop/electron/preload.ts` → `contextBridge.exposeInMainWorld("agenticxDesktop", …)` | 渲染安全桥 |
| 渲染 | `desktop/src/main.tsx` → `RootErrorBoundary` → `App` | UI 根 |
| 类型契约 | `desktop/src/global.d.ts`：`window.agenticxDesktop` | IPC 面 TS 定义 |
| 状态 | `desktop/src/store.ts`：`useAppStore`、`ChatPane`、`Message` | Zustand 全局 UI 状态 |
| 打包 | `desktop/electron-builder.yml`：`appId com.agenticx.desktop`，mac DMG / win NSIS / linux AppImage | 分发与 `extraResources` 内嵌后端 |

辅助主进程模块：

- `desktop/electron/proxy-fetch.ts` — `proxyAwareFetch`（undici `ProxyAgent`，读 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`/`NO_PROXY`）
- `desktop/electron/fetch-favicon.ts` — `fetchFaviconDataUrl`（主进程经 `proxyAwareFetch` 拉站点图标；IPC `fetch-favicon`，供 WorkPanel `SiteFavicon`；渲染层 `<img>` 不走代理）
- `desktop/electron/native-connectors-core.ts` — 原生连接器安装/解析
- `desktop/electron/system-search.ts` — 系统搜索预览
- `desktop/electron/splash.ts` / `splash.html` — 启动 Splash（点击可穿透到下层窗口）
- `desktop/scripts/wait-and-electron.mjs` — 等 Vite + `dist-electron/main.js` 再起 Electron
- `desktop/electron/local-spaces.ts` — `readLocalSpaces` / `createLocalSpace` / `assignSessionToSpace`；文件 `<AGX_HOME>/spaces.json`
- `desktop/electron/collab-cache.ts` + `collab-outbox-flusher.ts` — 项目/房间消息本机缓存与离线 outbox；`startOutboxFlusher`
- `desktop/electron/canvas-case.ts` + `zip-store.ts` — 画布视图包提交/拉取企业案例库（`writeStoreZip` / `submitEnterpriseCase`）
- `desktop/electron/action-audit-uploader.ts` — `startActionAuditUploader`：把 `<AGX_HOME>/action_audit/outbox.jsonl` 刷到 `{base_url}/api/desktop/action-audit`
- `desktop/electron/enterprise-agent-policy.ts` — `normalizeAgentActionPolicy`：企业下发的 `denied_tools` / `always_ask_tools` / `disable_session_allow` 写入本地 config
- `desktop/electron/automation-run-health.ts` — `applyRunOutcome`：连续失败达 `AUTO_PAUSE_FAILURE_THRESHOLD`（3）自动暂停；启动时 `markInterruptedOnStartup`
- `desktop/electron/desktop-notify.ts` — `deliverTaskCompleteNotification`；未聚焦时走系统通知（macOS 可走 osascript）
- `desktop/electron/gateway-adapter-config.ts` — `mergeGatewayAdapters`：钉钉 / Slack / Telegram / QQ 写入 `config.yaml` 的 `gateway.adapters`
- `desktop/electron/mcp-oauth-store.ts` — 只读「是否已授权」；令牌文件 `<AGX_HOME>/connectors/oauth/<safe_name>.json`，重置只删 `tokens`
- `desktop/electron/agx-home.ts` — `resolveAgxHomeDir` / `applyConfiguredDataDir`：按环境变量、`data_root.json`、bootstrap YAML、默认目录解析并切换数据根
- `desktop/electron/ma-session-client.ts` + `ma-sse.ts` — `maRequest`、`MaStreamRegistry`、`parseSseChunk`：代理 MA REST/SSE，按 `Last-Event-ID` 续流并在空闲超时后退避重连
- `desktop/electron/native-messaging-host.ts` + `nm-socket-server.ts` — `installNmHost` / `startNmSocketServer`：注册 Chrome / Edge / Chromium host，承接 `act_result`、`inject_context`、`copilot_chat`
- `desktop/electron/terminal-shell-routing.ts` — `resolveTabWriteSessionId`：同一终端 tab 下优先真实 shell PTY，避免把登录命令误写入 bridge REPL

## Core execution path

### 启动

1. `npm run dev`：并发 Vite、`tsc -p electron --watch`、`wait-and-electron.mjs`。
2. `app.requestSingleInstanceLock()`；第二实例聚焦已有窗口。
3. Splash → **先** `registerIpc()`（避免 macOS `activate` 竞态）→ 本地则 `startStudioServe()`（随机端口，写 `<AGX_HOME>/serve.port` / `serve.token`）→ `waitServeReady`（poll `/api/session`）。
4. 本地就绪后：`startFeishuProcess()`、`startWechatSidecar()`；主进程同时启动 `startNearBrowserBridge`，并以 dev / installed 模式幂等执行 `installNmHost`。
5. `createWindow`（dev：`VITE_DEV_SERVER_URL` 或 `localhost:${AGX_DEV_PORT}`；prod：`dist/index.html`）。
6. 渲染：`App` 等待 Studio ready，恢复 `agx-workspace-state-v1` 等 scoped localStorage，加载分身/会话；普通窗格恢复服务端 Harness 绑定，`ma:` 窗格不参与本地 Studio session 恢复。

### 聊天

1. Pro：`ChatPane` `POST ${apiBase}/api/chat`，header `x-agx-desktop-token`，解析 SSE（`data:` frames）。
2. 打断 / 延续：`interrupt-session` IPC；`continueSessionUrl` → `/api/sessions/{id}/continue`；重连 `reattachSessionStreamUrl` → `/api/sessions/{id}/stream`。
3. Lite：`ChatView` / `LiteChatView` 同类 SSE；`App.tsx` 启动路径当前强制 Pro。
4. Harness：`PreferredHarnessPicker` 只为新会话设默认值；`PaneHarnessPicker` 经 `/api/sessions/{id}/harness/switch` 热切换，失败时回退 metadata rebind，进行中的 turn 则 fail closed。消息 metadata 记录实际回答 Harness，重启后由 `restorePaneHarnessFromSession` 恢复。
5. CodeBuddy：聊天层识别授权失效，`startCodebuddyOAuthLogin` 打开浏览器 OAuth、轮询结果并调用 `refreshCodebuddyHarnessAfterOAuth` 重启相关 Harness surface；认证材料仍留在 CLI。

### 企业托管会话

1. 分身画廊经 `/api/enterprise-agents` 展示企业智能体；`openManagedAgentPane` 用 `ma:<agent ULID>` 打开独立 `ManagedChatPane`。
2. `registerManagedSessionIpc` 根据 `enterprise.worker.ma_base_url` / `enterprise.base_url` 和 PAT 代理 `/ma/v1/sessions`、events 列表/写入与 SSE；主进程不把 PAT 暴露给渲染层。
3. `useManagedSession` 先分页回放事件，再从最后序号续流；`ma-event-adapter.ts` 把 message / thinking / tool / usage / stop reason 映射为现有 `MessageRenderer` 数据。
4. 用户消息、打断与工具确认分别写 `user.message`、`user.interrupt`、`user.tool_confirmation`；`requires_action` 同时进入消息内确认和全局 `ApprovalInbox`。
5. `desktop_worker` 智能体先注册 interactive environment，并每 10 分钟续期；云端与本机执行均由 MA 服务锁定会话版本，Desktop 仅持久化最近 session 映射。

### IPC 与推送

- 渲染只经 `window.agenticxDesktop`；主进程 `ipcMain.handle` 读本地文件或转发 Studio。
- 主→渲染事件含：`agx-studio-ready`、`agx-connection-mode-changed`、`open-settings`、`skills-changed`、`automation-task-progress`、`ma-stream-frame`、`ma-stream-state` 等。

### 多窗格与持久化

- UI：`PaneManager` → 多个 `ChatPane`；布局另有 `<AGX_HOME>/layout.json`（`layout-get` / `layout-set`）。
- Scoped localStorage（`src/utils/backend-scope.ts`）：`agx-workspace-state-v1`、`agx-session-token-cache-v1`、`agx-avatar-last-session-v1` 等；托管智能体最近会话另存 `agx-ma-last-session-v1`。

### IM sidecar

- 飞书：`startFeishuProcess` → `agx feishu`；绑定 `<AGX_HOME>/feishu_binding.json`。
- 微信：`startWechatSidecar` → Go 二进制（dev：`packaging/wechat-sidecar/`；打包：`resources/backend/`），健康检查与有限次重启。

### 设置

- `SettingsPanel.tsx` + `settings-tab.ts` 的 `SETTINGS_TAB_IDS`：`account` / `enterprise_worker` / `general` / `security` / `provider` / `mcp` / `credentials` / `connectors` / `tools` / `skills` / `commands` / `knowledge` / `data_sources` / `memory` / `automation` / `voice` / `email` / `favorites` / `server`。`enterprise_worker` 仅在企业已登录时出现；导航仍只保留有面板的页签（已无 `hooks` / `workspace`）。`SETTINGS_FOCUS_IDS` 含 `security-rules` 与 `sessionCap`。
- 子目录示例：`components/settings/mcp/*`、`knowledge/*`、`connectors/*`（`ConnectorsHub` / `useConnectorsController`）、`credentials/CredentialsTab`（`/api/credentials`，名称 `CREDENTIAL_NAME_RE`）、`commands/CommandsSettings`、`server/GatewayAdaptersPanel`、`voice/*`；自动化另有 `components/automation/*`。
- General 中 `PreferredHarnessPicker` 选择新会话默认 Harness；数据目录表单经 `getAgxHomeDir` / `setAgxHomeDir` 写 bootstrap 指针并提示重启，`AGX_HOME` / `AGENTICX_HOME` 存在时禁止 UI 覆盖。
- `EnterpriseWorkerPanel` 每 5 秒读取 `/api/enterprise-worker/status`，乐观切换 worker 与 MA 开关，并展示可用环境、当前工作、心跳和最近错误。
- 设置 → Server：`QrConnectModal` 的 `mode: "mobile" | "im"`，分别给 Near 手机 App 扫码配对和飞书/企微机器人绑定。
- **Tool Search（工具按需加载）**：`components/automation/ToolSearchConfigSection.tsx` 挂在 Automation/Runtime 区；模式 `off` / `auto` / `always`，`auto` 时阈值默认 6000（范围 1000–50000）。切换即写 Studio runtime（`tool_search_mode`、`tool_search_auto_schema_token_threshold`），失败就近展示错误，不依赖底部「保存」。
- 设置开关统一 `components/settings/SettingsSwitch.tsx`（主题色轨道 + `--theme-color-text` 滑钮）；单色主题下分身首字母等走 `avatar-color.ts` 的 `--theme-color-text`，避免白底白字。

### 工作区 HTML 预览

- 统一壳：`HtmlPreviewShell`（`WorkspaceFilePreview` + `WorkPanel` 浏览器态复用）。
- Chrome：`HtmlPreviewChrome`（分享 / More 菜单用 `bg-surface-popover` 等不透明层，避免预览内容透出）；设备视口 `html-preview-device.ts`；Inspect / 选元素 `html-preview-inspect.ts` + `HtmlElementSelectPopover`，可报价进对话（`onQuoteHtmlElement`）。
- 沙箱 `srcDoc`：`html-preview-storage.ts` 注入 memory storage bridge（opaque origin 下 `localStorage` 失败时回退）；主题：`html-preview-theme.ts` + `adapt-svg-theme.ts` 使聊天 SVG / 预览贴合 app 主题。
- WorkPanel：站内 webview 导航、地址栏前进后退刷新；站点图标优先 `window.agenticxDesktop.fetchFavicon`。

### Delivery

- 全局 `DeliveryPanel`（`store.deliveryPanel`）仍在；自动化侧冗余入口 `DeliveryConfigSection` 已删除（避免与 Delivery 主面板重复）。

### 主视图

`store.ts` 的 `MainView`：`chat` | `avatars` | `groups` | `collab` | `automation` | `wiki` | `market`。`App.tsx` 按 `mainView` 挂载。离开聊天时 `setMainView` 记下当前 `paneId` / `sessionId`（`chatReturnSnapshot`），`returnToPreviousChat` 据此回到原窗格。

| 视图 | 组件 | 角色 |
|------|------|------|
| `market` | `MarketplaceView` | 全屏市场：Tab `all` / `connectors` / `mcp` / `skills` / `agents` / `commands`；`ManageView` 管已装项；技能安装走 `useSkillInstall` |
| `collab` | `ProjectCollabView` → `ProjectDetailView` | 项目协作首页、群树、单聊、拉小群、合回主群 |
| `wiki` | `WikiBrowseView` | 侧栏进入已编译 Wiki：页面树 + `@xyflow/react` 关系图；数据来自 brains / KB API |
| `groups` | `ProjectsView` | 专家群项目页（与 `collab` 的企业项目协作分开） |

侧栏 `SidebarSpaces`：本地目录空间（IPC `local-spaces-*`）与协作项目列表同级；会话可 `assignSessionToSpace`。任务与空间分组，渠道绑定显示为会话标记（`SessionChannelMarks`）。

分身画廊在企业已登录时追加 `EnterpriseAgentSection`；`EnterpriseAgentDrawer` 展示版本、执行目标、模型、工具策略、Skills 与环境。自建分身的 `AvatarEnterprisePublishTab` 先 dry-run 展示工具裁剪、凭证移除、密钥脱敏与本地路径替换报告，再发布版本。

### 市场与连接器运行时

- 文案：`desktop/locales/{en,zh}/marketplace.json`；目录数据 `src/data/marketplace-config.ts`、`plugin-skill-bundles.ts`。
- 品牌图标与分类卡在 `components/marketplace/`（`UnifiedGrid`、`FeaturedCategoryCards`、`brand-assets.ts`）。
- connector-runtime：开发态二进制 `desktop/bundled-sidecar/<arm64|x64|win-amd64>/connector-runtime`；打包后 `resources/sidecar/`（`getConnectorRuntimeBinaryPath`）。已在跑的实例可 `tryAdoptConnectorRuntime`。
- MCP OAuth：IPC `mcp-oauth-state` / `mcp-oauth-reset` 只回布尔，令牌不出主进程。

### 浏览器桥接

- `browser-bridge.ts` 的 `BrowserBackendMode` 为 `embedded` / `extension` / `auto`；`AGX_BROWSER_BACKEND` 选择后端，auto 仅在 Native Messaging 心跳在线时转发扩展，否则回落 embedded。
- `startNmSocketServer` 使用 `<AGX_HOME>/browser_bridge_nm.sock` 的 JSONL 协议；ping/pong 同步企业域名 deny list，扩展动作结果进入与 Python 共用的 `action_audit/outbox.jsonl`。
- `dispatchInjectContext` 把页面/选区注入目标 Studio session；`dispatchCopilotChat` 聚合现有 `/api/chat` SSE 后回传 `copilot_reply`。主进程会把当前 active session 推给扩展，但不在扩展侧复制会话权威状态。
- `pack-nm-host.js` 在打包后复制 host shim；installed 模式复用 Electron `ELECTRON_RUN_AS_NODE=1`，避免终端用户依赖系统 Node。

### 项目协作本机副本

- IPC：`collab-project-*`、`collab-room-*`（含 `collab-room-create-sub`、`collab-room-merge`、`collab-room-approve-merge`）、`collab-outbox-list`、`collab-directory-search`。
- 缓存根 `<AGX_HOME>/collab-cache/`（`projects.json`、按房间的消息；房间 id 须为 26 位字母数字）。发送失败进 outbox，`startOutboxFlusher` 断线后续拉。
- 渲染辅助：`src/utils/collab-project-tree.ts`、`components/collab/CollabRoomConversation.tsx`。

### 工作区目的地、随手聊与画布

- 右侧目的地栏 `shell/destination-rail.tsx` 的 `DESTINATION_ITEMS`：`summary` / `scratch` / `changes` / `browser` / `canvas` / `graph` / `timeline` / `terminal` / `workspace`。新任务未启动时 `workspaceToolLocked` 锁住工具；`browser` 与 `canvas` 除外。
- 设置弹层打开时目的地栏隐藏。`TerminalEmbed` 的 `shellOnly` 路径保持真实 shell PTY 常驻，并通过 `terminal-shell-routing.ts` 与 cc-bridge session 隔离。
- 随手聊：`utils/scratch-chat.ts` 的 `ScratchChat` 自带 `sessionId`，`hostSessionId` 指向正式窗格会话，不写入该会话历史。UI 为 `ScratchChatCard` / `ScratchChatFloatHost`，运行时 `useScratchChatRuntime`。停放上限 `PARKED_SCRATCH_CAP`（20）。
- 设计画布：`work-panel/DesignCanvasPanel.tsx`；画框状态 `utils/canvas-frames-store.ts`、可视化编辑 `canvas-visual-editor.ts`。导出保存对话框有超时。发布走 `window.agenticxDesktop.submitEnterpriseCase` → `POST {portal}/api/desktop/cases`（包体上限 12MB）。
- 长会话：`ChatPane` 使用 `VirtualizedMessageList`（`@tanstack/react-virtual`）。未发送草稿在 `agx-composer-drafts-v1`；大图进 IndexedDB（`composer-draft-blob-store.ts`），不进 localStorage。
- 输入 `/` 指令：`composer/CommandMenu.tsx` + `services/commandsApi.ts`（`VisibleCommand`，scope 含 `builtin` / `session` / `avatar` / `group` / `room` / `global`）。
- 终端选区引用：`workspace/terminal-selection-quote.ts`。

### 审批、策略与审计

- `ApprovalInbox.tsx` 的 `ApprovalInboxButton` 挂在 `Topbar` 与 `SidebarAccountBar`：普通会话轮询 `GET /api/approvals/pending`、确认走 `POST /api/confirm`；托管会话审批来自 `store.managedApprovals`，决策写回 MA `user.tool_confirmation`。
- 企业动作策略在设备登录同步后经 `normalizeAgentActionPolicy` 写入 `config.yaml` 的 `enterprise.agent_action_policy`。
- 动作审计：Python 追加 outbox，主进程每 60s `flushActionAuditOnce`（批大小 200）。`enterprise.enabled` 且 token / `base_url` 齐全才上传；HTTP 400 丢弃该批，401/403 与传输失败留在磁盘。
- 定时任务健康：`lastRunStatus` 含 `success` | `error` | `interrupted`；需用户处理的错误文案子串见 `NEEDS_USER_ACTION_MARKERS`（单次审批超时不在表内，走连续失败阈值）。

### 聊天呈现

- 群聊按发言人聚类（`group-sender-cluster.ts`）；长报告剥到 `GroupTalkReportCard`。结构化路由决策卡：`messages/JevDecisionCard.tsx`、`utils/jev-decision.ts`。
- `HarnessAvatarBadge` 在用户轮次头像旁展示实际回答引擎；`harness-marks.ts` 为 AgenticX、Claude Code、CodeBuddy、Codex、OpenCode、DeepSeek、Hermes Agent、PI Agent、OpenClaw 映射独立 SVG。
- 子智能体未结束前，本轮不显示为已完成；跨 Harness 的 CB/CC 子任务由 inline cluster 聚合，`shouldAutoReportSubagentCompletion` 阻止再发一条 Meta 自动汇报。
- CodeBuddy 认证错误正文可被收敛为消息内 OAuth CTA/状态提示，避免把原始 Harness 错误重复渲染；外部 Harness single-flight 冲突也只展示软提示。
- 低风险工具确认可按会话「不再询问」（`utils/confirm-remember.ts`）。版本化选择面板带过期保护。
- 空态快捷卡 `brand/QuickStartCards.tsx`；活动胶囊 `AgentActivityPill.tsx`。专家立绘样式 `utils/expert-portrait.ts` 与 `cube-colorway.ts`（`UserCubeColorwayPicker`）。

## Data and configuration

| 契约 | 说明 |
|------|------|
| `<AGX_HOME>/config.yaml` | 主配置；`<AGX_HOME>` 默认 `~/.agenticx` |
| `~/.agenticx/data_root.json` | 非默认数据根指针；环境变量 `AGX_HOME` / `AGENTICX_HOME` 优先于该指针 |
| `<AGX_HOME>/serve.port` / `serve.token` | 动态 Studio 发现与 Desktop 鉴权 |
| `<AGX_HOME>/layout.json` | 窗口 bounds / panes / theme |
| `<AGX_HOME>/feishu_binding.json`、`wechat_credentials.json` | IM 绑定与凭据 |
| `<AGX_HOME>/automation_tasks.json`、`logs/automation/<taskId>.log` | 定时任务；任务对象带 `lastRunStatus` / `consecutiveFailures` / `autoPausedReason` |
| `<AGX_HOME>/spaces.json` | 本地目录空间与 `session_space` 映射（`LocalSpacesFile.version = 1`） |
| `<AGX_HOME>/collab-cache/` | 协作项目列表、房间消息与发送 outbox |
| `<AGX_HOME>/action_audit/outbox.jsonl` | 本机与扩展动作审计待上送队列 |
| `<AGX_HOME>/connectors/oauth/<safe_name>.json` | MCP OAuth 令牌（主进程只暴露是否已授权） |
| `<AGX_HOME>/mcp.json`、`hooks/`、`connectors/`、`skills/` | 设置与连接器相关路径 |
| `<AGX_HOME>/browser_bridge.{port,token}`、`browser_bridge_nm.sock` | 浏览器桥 HTTP 发现文件与 Native Messaging socket |
| `config.yaml` → `gateway.adapters.{dingtalk,slack,telegram,qqbot}` | 渠道开关与密钥（`GatewayAdapterForm`） |
| `config.yaml` → `enterprise.agent_action_policy` | `denied_tools` / `always_ask_tools` / `disable_session_allow` |
| `agx-composer-drafts-v1` | 按后端 scope 的未发送草稿；图片字节在 IndexedDB |
| `agx-preferred-harness`、`agx-ma-last-session-v1` | 新会话默认 Harness；企业智能体最近会话映射 |
| `config.yaml` → `enterprise.worker.ma_base_url` | MA 服务优先地址；缺省回退 `enterprise.base_url`，PAT 必须以 `agx-pat-` 开头 |
| `AGX_DEV_PORT`、`VITE_DEV_SERVER_URL`、`AGX_DISABLE_GPU`、`AGX_DESKTOP_TOKEN` | 开发/运行环境 |
| `AGX_HOME`、`AGENTICX_HOME`、`AGX_BROWSER_BACKEND`、`AGX_NM_SOCKET_PATH` | 数据根与浏览器桥运行环境 |
| `HTTPS_PROXY` 等 | 主进程 outbound（`proxy-fetch`）；显式使用 `undici` 6 的 `ProxyAgent` |
| Vite dev `proxy /api → 127.0.0.1:8000` | 仅开发便利；打包后走 IPC + 动态 serve 端口 |

## Dependencies

- **上游**：用户 OS、Electron 运行时、（经主进程）LLM Provider HTTP。
- **下游**：本机/远程 `agx serve`（REST + SSE，含 Harness、CodeBuddy OAuth、企业智能体目录/发布与 worker API）；企业 MA `/ma/v1`；`agx feishu`；微信 sidecar；connector-runtime sidecar；原生连接器 CLI；企业门户 `/api/desktop/cases` 与 `/api/desktop/action-audit`；浏览器 Native Messaging peer；打包时 `bundled-backend/${arch}` → `resources/backend`、sidecar → `resources/sidecar/`、NM shim → `resources/extension-host/`。
- **仓库内相关但不属本模块 roots**：`packaging/`（PyInstaller / Windows 安装 / wechat-sidecar 源码）、Python `agenticx/studio`。

## Tests and operations

- **Vitest**：`npm test` = `vitest run src tests`。`desktop/tests/*.test.ts` 覆盖主进程纯函数与协议（含 `agx-home`、MA REST/SSE、Native Messaging host/socket、浏览器桥安全与 context/copilot、终端 shell 路由、企业 deny 下发；不启 Electron）。`desktop/src/**/*.test.ts(x)` 覆盖 Harness 选择/恢复/模型兼容、CodeBuddy OAuth、托管窗格/事件适配、企业画廊/发布/worker、审批收件箱与消息呈现。
- **Playwright e2e**：`desktop/e2e/app.spec.ts`、`mcp-*.spec.ts`（偏打包产物 smoke）。
- **运维**：改 `electron/main.ts` / 新 IPC（含 `fetch-favicon`）后须完全退出再启（主进程不热重载）；Electron 升级后 `npx @electron/rebuild -f -w node-pty`；Windows 默认禁 GPU；`checkAgxCli` 超时约 30s。

## Unverified or ambiguous

- e2e 期望的 `.app` 产物名与当前 `productName: Near` 是否始终一致（需本地/CI 打包后核对）。
- 远程 `remote_server` 路径下飞书/微信 sidecar 与 connector-runtime 是否与本地 `whenReady` 分支同样自动拉起（远程分支需对照运行时）。
- Tool Search 的实际检索/加载、Wiki 编译与凭证存储本体在 Python Studio / 企业门户；Desktop 只负责配置 UI、浏览壳与本机队列。
- `desktop/bundled-sidecar/*` 在本 checkpoint 只有 `.gitkeep`；connector-runtime 二进制是否随构建 stage 进目录，需对照打包脚本，不能从 git 树推断本机已有可执行文件。
- Windows Native Messaging 注册已由 `native-messaging-host.test.ts` 校验 `reg.exe` 参数构造，但本提交无法从 macOS 开发机证明真实浏览器注册链路。
