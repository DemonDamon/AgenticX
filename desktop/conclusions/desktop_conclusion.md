---
module_id: desktop
module_name: Desktop
roots:
  - desktop
summary_schema: code-module-summaries/v1
summary_path: desktop/conclusions/desktop_conclusion.md
---

# Desktop

产品名 **Near**（`package.json` / `electron-builder.yml` 的 `productName`）。Electron 34 + React 18 + Vite 6 + Zustand 桌面壳，对接本机或远程 `agx serve`。

> 结论落盘：`desktop/conclusions/`（custom layout）。**核心代码 = `desktop/src`（渲染）+ `desktop/electron`（主进程）**；ownership 扫描 root 为整个 `desktop/`（已排除 dist/node_modules 等）。

## Responsibility

- Electron 主进程（`desktop/electron/`）生命周期：单实例锁、Splash、主窗口、布局持久化、GPU/代理策略。
- 本地后端子进程：`agx serve` / 打包内嵌 `agx-server`；可选远程 `remote_server`。
- IPC 桥（`window.agenticxDesktop`）：配置、会话、分身/群聊、工作区、MCP、Skills、自动化、IM、终端、Focus Mode。
- 渲染层 UI（`desktop/src/`）：多窗格聊天、侧栏、设置、工作区/终端、语音焦点模式、自动化视图。
- 主进程侧：`AutomationScheduler`、飞书 `agx feishu` 子进程、微信 iLink sidecar、原生连接器 CLI、`proxyAwareFetch`、node-pty 终端。

明确不拥有：

- Agent 运行时、工具执行、MCP stdio 子进程、LLM 路由（属 Python `agenticx` / Studio）。
- 会话消息落盘（`messages.json` 等）与群聊路由逻辑；Desktop 只消费 REST/SSE。
- Skills/Hooks/KB 的索引与执行本体；设置页经 Studio API 操作。

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
- `desktop/electron/splash.ts` / `splash.html` — 启动 Splash
- `desktop/scripts/wait-and-electron.mjs` — 等 Vite + `dist-electron/main.js` 再起 Electron

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

- `SettingsPanel.tsx` + `settings-tab.ts` 的 `SETTINGS_TAB_IDS`：`account` / `general` / `provider` / `mcp` / `connectors` / `tools` / `skills` / `knowledge` / `data_sources` / `memory` / `hooks` / `automation` / `voice` / `email` / `workspace` / `favorites` / `server`。
- 子目录示例：`components/settings/mcp/*`、`knowledge/*`、`connectors/*`、`voice/*`；自动化另有 `components/automation/*`。
- **Tool Search（工具按需加载）**：`components/automation/ToolSearchConfigSection.tsx` 挂在 Automation/Runtime 区；模式 `off` / `auto` / `always`，`auto` 时阈值默认 6000（范围 1000–50000）。切换即写 Studio runtime（`tool_search_mode`、`tool_search_auto_schema_token_threshold`），失败就近展示错误，不依赖底部「保存」。
- 设置开关统一 `components/settings/SettingsSwitch.tsx`（主题色轨道 + `--theme-color-text` 滑钮）；单色主题下分身首字母等走 `avatar-color.ts` 的 `--theme-color-text`，避免白底白字。

### 工作区 HTML 预览

- 统一壳：`HtmlPreviewShell`（`WorkspaceFilePreview` + `WorkPanel` 浏览器态复用）。
- Chrome：`HtmlPreviewChrome`（分享 / More 菜单用 `bg-surface-popover` 等不透明层，避免预览内容透出）；设备视口 `html-preview-device.ts`；Inspect / 选元素 `html-preview-inspect.ts` + `HtmlElementSelectPopover`，可报价进对话（`onQuoteHtmlElement`）。
- 沙箱 `srcDoc`：`html-preview-storage.ts` 注入 memory storage bridge（opaque origin 下 `localStorage` 失败时回退）；主题：`html-preview-theme.ts` + `adapt-svg-theme.ts` 使聊天 SVG / 预览贴合 app 主题。
- WorkPanel：站内 webview 导航、地址栏前进后退刷新；站点图标优先 `window.agenticxDesktop.fetchFavicon`。

### Delivery

- 全局 `DeliveryPanel`（`store.deliveryPanel`）仍在；自动化侧冗余入口 `DeliveryConfigSection` 已删除（避免与 Delivery 主面板重复）。

## Data and configuration

| 契约 | 说明 |
|------|------|
| `~/.agenticx/config.yaml` | 主配置 |
| `~/.agenticx/serve.port` / `serve.token` | 动态 Studio 发现与 Desktop 鉴权 |
| `~/.agenticx/layout.json` | 窗口 bounds / panes / theme |
| `~/.agenticx/feishu_binding.json`、`wechat_credentials.json` | IM 绑定与凭据 |
| `~/.agenticx/automation_tasks.json`、`logs/automation/<taskId>.log` | 定时任务 |
| `~/.agenticx/mcp.json`、`hooks/`、`connectors/`、`skills/` | 设置与连接器相关路径 |
| `AGX_DEV_PORT`、`VITE_DEV_SERVER_URL`、`AGX_DISABLE_GPU`、`AGX_DESKTOP_TOKEN` | 开发/运行环境 |
| `HTTPS_PROXY` 等 | 主进程 outbound（`proxy-fetch`）；`undici` 钉 `^6.x`（与 Electron 34 / Node 20 兼容） |
| Vite dev `proxy /api → 127.0.0.1:8000` | 仅开发便利；打包后走 IPC + 动态 serve 端口 |

## Dependencies

- **上游**：用户 OS、Electron 运行时、（经主进程）LLM Provider HTTP。
- **下游**：本机/远程 `agx serve`（REST + SSE）；`agx feishu`；微信 sidecar；原生连接器 CLI；打包时 `bundled-backend/${arch}` → `resources/backend`（`afterPack: scripts/verify-bundled-backend.js`）。
- **仓库内相关但不属本模块 roots**：`packaging/`（PyInstaller / Windows 安装 / wechat-sidecar 源码）、Python `agenticx/studio`。

## Tests and operations

- **Vitest**：`desktop/tests/*.test.ts`（`test:native-connectors`、`test:action-confirmation`）；`desktop/src/**/*.test.ts(x)` 大量纯函数单测（SSE/merge/markdown/stall、`html-preview-*`、`adapt-svg-theme`、`favicon-url`、`task-stall-policy` 等，不启 Electron）。
- **Playwright e2e**：`desktop/e2e/app.spec.ts`、`mcp-*.spec.ts`（偏打包产物 smoke）。
- **运维**：改 `electron/main.ts` / 新 IPC（含 `fetch-favicon`）后须完全退出再启（主进程不热重载）；Electron 升级后 `npx @electron/rebuild -f -w node-pty`；Windows 默认禁 GPU；`checkAgxCli` 超时约 30s。

## Unverified or ambiguous

- e2e 期望的 `.app` 产物名与当前 `productName: Near` 是否始终一致（需本地/CI 打包后核对）。
- 远程 `remote_server` 路径下飞书/微信 sidecar 是否与本地路径同样自动拉起（本地 `whenReady` 分支显式调用；远程分支需对照运行时）。
- Tool Search 的实际检索/加载行为在 Python Studio runtime；Desktop 只负责配置 UI 与持久化字段，运行时效果需对照 `agx serve` 侧实现。
