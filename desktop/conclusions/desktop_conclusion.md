---
module_id: desktop
module_name: Desktop
roots:
  - desktop
summary_schema: code-module-summaries/v1
summary_path: desktop/conclusions/desktop_conclusion.md
---

# Desktop

产品名 **Near**（`package.json` / `electron-builder.yml` 的 `productName`；包版本 `0.6.0`）。Electron 34 + React 18 + Vite 6 + Zustand 桌面壳，对接本机或远程 `agx serve`。

> 结论落盘：`desktop/conclusions/`（custom layout）。**核心代码 = `desktop/src`（渲染）+ `desktop/electron`（主进程）**；ownership 扫描 root 为整个 `desktop/`（已排除 dist/node_modules 等）。

## Responsibility

- Electron 主进程（`desktop/electron/`）生命周期：单实例锁、Splash、主窗口、布局持久化、GPU/代理策略。
- 本地后端子进程：`agx serve` / 打包内嵌 `agx-server`；可选远程 `remote_server`。
- IPC 桥（`window.agenticxDesktop`）：配置、会话、分身/群聊、工作区、MCP、Skills、自动化、IM、终端、Focus Mode、项目协作、本地空间、画布案例、网关渠道、MCP OAuth 状态。
- 渲染层 UI（`desktop/src/`）：多窗格聊天、侧栏、设置、全屏主视图（市场 / 项目协作 / Wiki / 自动化 / 分身）、工作区/终端、随手聊、设计画布、语音焦点模式。
- 主进程侧：`AutomationScheduler`、飞书 `agx feishu` 子进程、微信 iLink sidecar、connector-runtime sidecar、原生连接器 CLI、`proxyAwareFetch`、node-pty 终端、协作缓存与离线发送、动作审计上送、任务完成系统通知。

明确不拥有：

- Agent 运行时、工具执行、MCP stdio 子进程、LLM 路由、凭证与审批的权威存储（属 Python `agenticx` / Studio；企业门户是审计与案例库的远端）。
- 会话消息落盘（`messages.json` 等）与群聊路由逻辑；Desktop 只消费 REST/SSE。协作房间另有本机副本 `~/.agenticx/collab-cache/`，服务端仍是权威。
- Skills/Hooks/KB/Wiki 的索引与写作本体；设置页与 Wiki 浏览经 Studio API 操作。Desktop 负责市场安装 UI、技能开关展示和 Wiki 浏览壳。

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
- `desktop/electron/local-spaces.ts` — `readLocalSpaces` / `createLocalSpace` / `assignSessionToSpace`；文件 `~/.agenticx/spaces.json`
- `desktop/electron/collab-cache.ts` + `collab-outbox-flusher.ts` — 项目/房间消息本机缓存与离线 outbox；`startOutboxFlusher`
- `desktop/electron/canvas-case.ts` + `zip-store.ts` — 画布视图包提交/拉取企业案例库（`writeStoreZip` / `submitEnterpriseCase`）
- `desktop/electron/action-audit-uploader.ts` — `startActionAuditUploader`：把 `~/.agenticx/action_audit/outbox.jsonl` 刷到 `{base_url}/api/desktop/action-audit`
- `desktop/electron/enterprise-agent-policy.ts` — `normalizeAgentActionPolicy`：企业下发的 `denied_tools` / `always_ask_tools` / `disable_session_allow` 写入本地 config
- `desktop/electron/automation-run-health.ts` — `applyRunOutcome`：连续失败达 `AUTO_PAUSE_FAILURE_THRESHOLD`（3）自动暂停；启动时 `markInterruptedOnStartup`
- `desktop/electron/desktop-notify.ts` — `deliverTaskCompleteNotification`；未聚焦时走系统通知（macOS 可走 osascript）
- `desktop/electron/gateway-adapter-config.ts` — `mergeGatewayAdapters`：钉钉 / Slack / Telegram / QQ 写入 `config.yaml` 的 `gateway.adapters`
- `desktop/electron/mcp-oauth-store.ts` — 只读「是否已授权」；令牌文件 `~/.agenticx/connectors/oauth/<safe_name>.json`，重置只删 `tokens`

## Core execution path

### 启动

1. `npm run dev`：并发 Vite、`tsc -p electron --watch`、`wait-and-electron.mjs`。
2. `app.requestSingleInstanceLock()`；第二实例聚焦已有窗口。
3. Splash → **先** `registerIpc()`（避免 macOS `activate` 竞态）→ 本地则 `startStudioServe()`（随机端口，写 `~/.agenticx/serve.port` / `serve.token`）→ `waitServeReady`（poll `/api/session`）。
4. 本地就绪后：`startFeishuProcess()`、`startWechatSidecar()` → `createWindow`（dev：`VITE_DEV_SERVER_URL` 或 `localhost:${AGX_DEV_PORT}`；prod：`dist/index.html`）。
5. 渲染：`App` 等待 Studio ready，恢复 `agx-workspace-state-v1` 等 scoped localStorage，加载分身/会话。

### 聊天

1. Pro：`ChatPane` `POST ${apiBase}/api/chat`，header `x-agx-desktop-token`，解析 SSE（`data:` frames）。
2. 打断 / 延续：`interrupt-session` IPC；`continueSessionUrl` → `/api/sessions/{id}/continue`；重连 `reattachSessionStreamUrl` → `/api/sessions/{id}/stream`。
3. Lite：`ChatView` / `LiteChatView` 同类 SSE；`App.tsx` 启动路径当前强制 Pro。

### IPC 与推送

- 渲染只经 `window.agenticxDesktop`；主进程 `ipcMain.handle` 读本地文件或转发 Studio。
- 主→渲染事件含：`agx-studio-ready`、`agx-connection-mode-changed`、`open-settings`、`skills-changed`、`automation-task-progress` 等。

### 多窗格与持久化

- UI：`PaneManager` → 多个 `ChatPane`；布局另有 `~/.agenticx/layout.json`（`layout-get` / `layout-set`）。
- Scoped localStorage（`src/utils/backend-scope.ts`）：`agx-workspace-state-v1`、`agx-session-token-cache-v1`、`agx-avatar-last-session-v1` 等。

### IM sidecar

- 飞书：`startFeishuProcess` → `agx feishu`；绑定 `~/.agenticx/feishu_binding.json`。
- 微信：`startWechatSidecar` → Go 二进制（dev：`packaging/wechat-sidecar/`；打包：`resources/backend/`），健康检查与有限次重启。

### 设置

- `SettingsPanel.tsx` + `settings-tab.ts` 的 `SETTINGS_TAB_IDS`：`account` / `general` / `security` / `provider` / `mcp` / `credentials` / `connectors` / `tools` / `skills` / `commands` / `knowledge` / `data_sources` / `memory` / `automation` / `voice` / `email` / `favorites` / `server`。导航只保留有面板的页签（已无 `hooks` / `workspace`）。`SETTINGS_FOCUS_IDS` 含 `security-rules`（运行模式「自定义」锚到安全中心规则）。
- 子目录示例：`components/settings/mcp/*`、`knowledge/*`、`connectors/*`（`ConnectorsHub` / `useConnectorsController`）、`credentials/CredentialsTab`（`/api/credentials`，名称 `CREDENTIAL_NAME_RE`）、`commands/CommandsSettings`、`server/GatewayAdaptersPanel`、`voice/*`；自动化另有 `components/automation/*`。
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

### 市场与连接器运行时

- 文案：`desktop/locales/{en,zh}/marketplace.json`；目录数据 `src/data/marketplace-config.ts`、`plugin-skill-bundles.ts`。
- 品牌图标与分类卡在 `components/marketplace/`（`UnifiedGrid`、`FeaturedCategoryCards`、`brand-assets.ts`）。
- connector-runtime：开发态二进制 `desktop/bundled-sidecar/<arm64|x64|win-amd64>/connector-runtime`；打包后 `resources/sidecar/`（`getConnectorRuntimeBinaryPath`）。已在跑的实例可 `tryAdoptConnectorRuntime`。
- MCP OAuth：IPC `mcp-oauth-state` / `mcp-oauth-reset` 只回布尔，令牌不出主进程。

### 项目协作本机副本

- IPC：`collab-project-*`、`collab-room-*`（含 `collab-room-create-sub`、`collab-room-merge`、`collab-room-approve-merge`）、`collab-outbox-list`、`collab-directory-search`。
- 缓存根 `~/.agenticx/collab-cache/`（`projects.json`、按房间的消息；房间 id 须为 26 位字母数字）。发送失败进 outbox，`startOutboxFlusher` 断线后续拉。
- 渲染辅助：`src/utils/collab-project-tree.ts`、`components/collab/CollabRoomConversation.tsx`。

### 工作区目的地、随手聊与画布

- 右侧目的地栏 `shell/destination-rail.tsx` 的 `DESTINATION_ITEMS`：`summary` / `scratch` / `changes` / `browser` / `canvas` / `graph` / `timeline` / `terminal` / `workspace`。新任务未启动时 `workspaceToolLocked` 锁住工具；`browser` 与 `canvas` 除外。
- 随手聊：`utils/scratch-chat.ts` 的 `ScratchChat` 自带 `sessionId`，`hostSessionId` 指向正式窗格会话，不写入该会话历史。UI 为 `ScratchChatCard` / `ScratchChatFloatHost`，运行时 `useScratchChatRuntime`。停放上限 `PARKED_SCRATCH_CAP`（20）。
- 设计画布：`work-panel/DesignCanvasPanel.tsx`；画框状态 `utils/canvas-frames-store.ts`、可视化编辑 `canvas-visual-editor.ts`。导出保存对话框有超时。发布走 `window.agenticxDesktop.submitEnterpriseCase` → `POST {portal}/api/desktop/cases`（包体上限 12MB）。
- 长会话：`ChatPane` 使用 `VirtualizedMessageList`（`@tanstack/react-virtual`）。未发送草稿在 `agx-composer-drafts-v1`；大图进 IndexedDB（`composer-draft-blob-store.ts`），不进 localStorage。
- 输入 `/` 指令：`composer/CommandMenu.tsx` + `services/commandsApi.ts`（`VisibleCommand`，scope 含 `builtin` / `session` / `avatar` / `group` / `room` / `global`）。
- 终端选区引用：`workspace/terminal-selection-quote.ts`。

### 审批、策略与审计

- `ApprovalInbox.tsx` 的 `ApprovalInboxButton` 挂在 `Topbar` 与 `SidebarAccountBar`：轮询 `GET /api/approvals/pending`，确认走 `POST /api/confirm`。
- 企业动作策略在设备登录同步后经 `normalizeAgentActionPolicy` 写入 `config.yaml` 的 `enterprise.agent_action_policy`。
- 动作审计：Python 追加 outbox，主进程每 60s `flushActionAuditOnce`（批大小 200）。`enterprise.enabled` 且 token / `base_url` 齐全才上传；HTTP 400 丢弃该批，401/403 与传输失败留在磁盘。
- 定时任务健康：`lastRunStatus` 含 `success` | `error` | `interrupted`；需用户处理的错误文案子串见 `NEEDS_USER_ACTION_MARKERS`（单次审批超时不在表内，走连续失败阈值）。

### 聊天呈现（本区间稳定下来的契约）

- 群聊按发言人聚类（`group-sender-cluster.ts`）；长报告剥到 `GroupTalkReportCard`。结构化路由决策卡：`messages/JevDecisionCard.tsx`、`utils/jev-decision.ts`。
- 子智能体未结束前，本轮不显示为已完成；最终回复与失败留在 run presentation 里。
- 低风险工具确认可按会话「不再询问」（`utils/confirm-remember.ts`）。版本化选择面板带过期保护。
- 空态快捷卡 `brand/QuickStartCards.tsx`；活动胶囊 `AgentActivityPill.tsx`。专家立绘样式 `utils/expert-portrait.ts` 与 `cube-colorway.ts`（`UserCubeColorwayPicker`）。

## Data and configuration

| 契约 | 说明 |
|------|------|
| `~/.agenticx/config.yaml` | 主配置 |
| `~/.agenticx/serve.port` / `serve.token` | 动态 Studio 发现与 Desktop 鉴权 |
| `~/.agenticx/layout.json` | 窗口 bounds / panes / theme |
| `~/.agenticx/feishu_binding.json`、`wechat_credentials.json` | IM 绑定与凭据 |
| `~/.agenticx/automation_tasks.json`、`logs/automation/<taskId>.log` | 定时任务；任务对象带 `lastRunStatus` / `consecutiveFailures` / `autoPausedReason` |
| `~/.agenticx/spaces.json` | 本地目录空间与 `session_space` 映射（`LocalSpacesFile.version = 1`） |
| `~/.agenticx/collab-cache/` | 协作项目列表、房间消息与发送 outbox |
| `~/.agenticx/action_audit/outbox.jsonl` | 本机动作审计待上送队列 |
| `~/.agenticx/connectors/oauth/<safe_name>.json` | MCP OAuth 令牌（主进程只暴露是否已授权） |
| `~/.agenticx/mcp.json`、`hooks/`、`connectors/`、`skills/` | 设置与连接器相关路径 |
| `config.yaml` → `gateway.adapters.{dingtalk,slack,telegram,qqbot}` | 渠道开关与密钥（`GatewayAdapterForm`） |
| `config.yaml` → `enterprise.agent_action_policy` | `denied_tools` / `always_ask_tools` / `disable_session_allow` |
| `agx-composer-drafts-v1` | 按后端 scope 的未发送草稿；图片字节在 IndexedDB |
| `AGX_DEV_PORT`、`VITE_DEV_SERVER_URL`、`AGX_DISABLE_GPU`、`AGX_DESKTOP_TOKEN` | 开发/运行环境 |
| `HTTPS_PROXY` 等 | 主进程 outbound（`proxy-fetch`）；`undici` 钉 `^6.x`（与 Electron 34 / Node 20 兼容） |
| Vite dev `proxy /api → 127.0.0.1:8000` | 仅开发便利；打包后走 IPC + 动态 serve 端口 |

## Dependencies

- **上游**：用户 OS、Electron 运行时、（经主进程）LLM Provider HTTP。
- **下游**：本机/远程 `agx serve`（REST + SSE，含 `/api/credentials`、`/api/approvals/pending`、`/api/confirm`）；`agx feishu`；微信 sidecar；connector-runtime sidecar；原生连接器 CLI；企业门户 `/api/desktop/cases` 与 `/api/desktop/action-audit`；打包时 `bundled-backend/${arch}` → `resources/backend`（`afterPack: scripts/verify-bundled-backend.js`），sidecar → `resources/sidecar/`。
- **仓库内相关但不属本模块 roots**：`packaging/`（PyInstaller / Windows 安装 / wechat-sidecar 源码）、Python `agenticx/studio`。

## Tests and operations

- **Vitest**：`npm test` = `vitest run src tests`。`desktop/tests/*.test.ts` 覆盖主进程纯函数（`action-audit-uploader`、`automation-run-health`、`collab-cache`、`collab-outbox-flusher`、`desktop-notify`、`enterprise-agent-policy`、`gateway-adapter-config`、`local-spaces`、cookie 导入、enterprise login、workspace mounts、path-guard 等，不启 Electron）。`desktop/src/**/*.test.ts(x)` 覆盖随手聊、画布、草稿、市场/连接器、协作树、虚拟列表、审批收件箱等。
- **Playwright e2e**：`desktop/e2e/app.spec.ts`、`mcp-*.spec.ts`（偏打包产物 smoke）。
- **运维**：改 `electron/main.ts` / 新 IPC（含 `fetch-favicon`）后须完全退出再启（主进程不热重载）；Electron 升级后 `npx @electron/rebuild -f -w node-pty`；Windows 默认禁 GPU；`checkAgxCli` 超时约 30s。

## 增量（30e57496 → 22d051f5）

相对上次 checkpoint：555 个路径，`A` 340 / `M` 215，无删除、无重命名。工作区干净，结论按 `HEAD` 写入。上面各节已吸收本区间的稳定契约；这里只标能力落点，避免把旧增量再抄一遍。

- **壳与主进程**：connector-runtime（`bundled-sidecar/`）、本地空间、协作缓存/outbox、画布案例 zip、动作审计上送、企业动作策略归一化、定时任务连续失败暂停、任务完成通知、网关四渠道适配器、MCP OAuth 只读状态。`main.ts` / `preload.ts` 增加对应 IPC。包版本到 `0.6.0`。
- **全屏视图**：市场、项目协作、Wiki 浏览；侧栏空间与任务分组。
- **工作区**：随手聊（独立 session）、设计画布与案例回流、右侧目的地栏、消息虚拟列表、作曲家草稿与 `/` 指令。
- **治理**：待审批收件箱、凭证引用页、本机承接企业智能体任务、手机 App 扫码配对入口。
- **呈现**：群发言人聚类、结构化决策卡、空态快捷卡、专家立绘/立方体配色、官方线稿标（`assets/near-cube-mark.svg` 等）。

## Unverified or ambiguous

- e2e 期望的 `.app` 产物名与当前 `productName: Near` 是否始终一致（需本地/CI 打包后核对）。
- 远程 `remote_server` 路径下飞书/微信 sidecar 与 connector-runtime 是否与本地 `whenReady` 分支同样自动拉起（远程分支需对照运行时）。
- Tool Search 的实际检索/加载、Wiki 编译与凭证存储本体在 Python Studio / 企业门户；Desktop 只负责配置 UI、浏览壳与本机队列。
- `desktop/bundled-sidecar/*` 在本 checkpoint 只有 `.gitkeep`；connector-runtime 二进制是否随构建 stage 进目录，需对照打包脚本，不能从 git 树推断本机已有可执行文件。
