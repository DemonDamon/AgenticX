# Near Desktop — 启动 Splash 窗口（Marvis 风格）

## What & Why

Near 桌面端冷启动时，主窗口要等 `agx serve` 就绪后才创建（实测 5–45 秒，DMG 首启更久），这段时间用户只能看到 Dock 图标在那里，没有任何「程序已经在启动」的反馈，体感像卡死。参考 Marvis（图见 chat），引入一个**独立 Electron Splash 窗口**，在 `app.whenReady()` 立即弹出，承担「品牌露出 + 真实阶段反馈 + 可取消」三件事，主窗就绪后无缝接管。

设计原则：
- **诚实**：不展示假百分比；只展示当前真实阶段文字（对齐用户偏好「耗时操作必须暴露真实阶段」）。
- **不抢戏**：极简、150ms 淡出、不在 Dock 留两个图标。
- **不串台**：只在冷启动出现；`activate`/`second-instance` 唤回主窗时不重复展示。
- **可逃生**：长时间无响应时暴露取消按钮，避免用户被迫强杀。

## Requirements

### FR — 功能需求
- **FR-1** 新增独立 Splash `BrowserWindow`：frameless、不可缩放、不在任务栏、`alwaysOnTop: true`、420×260、屏幕居中。
- **FR-2** Splash 在 `app.whenReady()` 内、`startStudioServe()` 之前**立即** `show()`。
- **FR-3** Splash 内容：Logo（复用 `desktop/assets/icon.png` 或 `export_embedded.png`）+ `APP_DISPLAY_NAME`（Near）+ `APP_TAGLINE` + indeterminate shimmer 进度条 + 阶段文字。
- **FR-4** 阶段（主进程通过 `splash:stage` IPC 推送给 splash renderer）：
  | 阶段 key | 中文文案 | 触发时机 |
  |---|---|---|
  | `initializing` | 正在初始化… | splash 创建后立即默认 |
  | `backend-starting` | 正在启动本地后端服务… | `startStudioServe()` 开始 |
  | `backend-waiting` | 正在等待后端就绪… | `waitServeReady()` 开始 |
  | `pinging-remote` | 正在连接远程服务器… | 远程模式 ping 阶段 |
  | `loading-ui` | 正在加载界面… | `createWindow()` 调用后、`ready-to-show` 前 |
  | `restoring-session` | 正在恢复上次会话… | 主窗加载后，renderer 上报 |
  | `ready` | 准备就绪 | renderer 发出 `startup:renderer-ready` |
- **FR-5** 远程模式（`remoteConfig` 已配置）跳过 `backend-starting` / `backend-waiting`，直接走 `pinging-remote`。
- **FR-6** Splash 自挂载起 25 秒后，若仍未达到 `ready`，在 splash 下方追加「如长时间无响应，可点击取消退出」+「取消」按钮；点击 → `app.quit()`。
- **FR-7** 主窗 `ready-to-show` 后**不立即 `show()`**；等 renderer 发 `startup:renderer-ready` IPC → 主进程推送 `splash:stage=ready` → splash 触发 150ms CSS 淡出 → splash close → 主窗 `show()` + `focus()`。
- **FR-8** Renderer 侧：`desktop/src/App.tsx` 在 `configLoaded === true` **且** 首个 pane 的 sessionId 已就位时，调用 `window.agenticxDesktop.startupRendererReady()`；同时去除「正在加载配置…」「正在连接 AgenticX 服务...」两个中间占位（splash 已承担反馈）。
- **FR-9** 主题：splash HTML 内用与 `desktop/index.html` 一致的 inline `<script>` 读 `localStorage.getItem("agx-theme")`（`light`/`dark`，缺省 `dark`），避免主题闪烁；与 `electron/main.ts` 已有 `mainWindowBackgroundColor` 同色系。
- **FR-10** 复用场景控制：用 `splashShownOnce` 模块级 flag；`app.on("activate")` 与 `second-instance` 唤回主窗时**不再**创建 splash。

### NFR — 非功能需求
- **NFR-1** Splash HTML/CSS/JS 总大小 < 30KB（不引第三方库），冷启动到 splash 可见目标 < 300ms。
- **NFR-2** 启动失败原有 `dialog.showErrorBox("Near 启动失败", …)` 路径**不变**，但需在弹错误对话框前先 `closeSplash()`，避免双窗叠加。
- **NFR-3** 打包路径鲁棒：dev 走 `process.cwd()/electron/splash.html`，packaged 走 `path.join(__dirname, "splash.html")`（vite-plugin-electron 输出到 `dist-electron/`）。需在 `desktop/electron/vite config / electron-builder.yml` 确认 splash.html 被复制进 `dist-electron/`。
- **NFR-4** 不影响现有 `startupOptimizing` 8s CSS 性能优化逻辑。
- **NFR-5** 主窗仍保持 `show: false` + `ready-to-show`，本计划不改主窗显示策略，只是把"何时 show"从 `ready-to-show` 推后到 `startup:renderer-ready`。

### AC — 验收
- **AC-1** macOS 开发模式下 `npm run dev`：点击图标后 ≤ 1s 看到 splash；splash 顺序显示 `初始化 → 启动本地后端 → 等待后端就绪 → 加载界面 → 恢复上次会话 → 准备就绪`；最后 150ms 淡出并切到主窗，无黑闪。
- **AC-2** 故意把 `agx serve` 二进制改名制造启动失败：splash 25s 后出现「取消」按钮；点取消后应用退出；不出现「splash + 错误对话框」叠加。
- **AC-3** 切到远程模式（`remote_server.enabled: true`，URL 指向不可达地址）：splash 显示 `正在连接远程服务器…`，重试对话框弹出前 splash 已关闭。
- **AC-4** 主窗启动后从 Dock 关掉主窗再点击 Dock 图标（`activate`）：**不**再显示 splash。
- **AC-5** 主题：把 `agx-theme=light` 写入 localStorage 后重启，splash 显示浅色版本；缺省深色。
- **AC-6** Splash 期间无 console 报错（含 renderer 与主进程）；`devtools` 不自动打开。
- **AC-7** DMG 打包版（`packaging/build_dmg.sh`）一次构建跑通；splash.html 与图片资源被正确打入 `dist-electron/` 或 `extraResources`，不出现 `ERR_FILE_NOT_FOUND`。

## 实施步骤（按提交粒度）

### Commit 1 — Splash HTML + 主进程接线（核心闭环）
- 新建 `desktop/electron/splash.html`（含主题脚本、shimmer 进度条、阶段文字、隐藏的"取消"按钮）。
- 新建 `desktop/electron/splash.ts`：导出 `createSplashWindow()` / `updateSplashStage(stage)` / `closeSplash({ fade: true })` / `splashShownOnce` 状态。
- `desktop/electron/main.ts`：
  - `app.whenReady()` 入口处先 `createSplashWindow()`（在 `Menu.setApplicationMenu` 之后、`registerIpc` 之前）。
  - `startStudioServe` 前后、`waitServeReady` 前后、`pingRemoteServer` 前后、`createWindow` 前后插入 `updateSplashStage(...)` 调用。
  - `createWindow` 内删除 `mainWindow.once("ready-to-show", show)`，改为只记录 `ready-to-show` 状态；真正的 `show()` 推迟到 `startup:renderer-ready` IPC 触发。
  - 新增 IPC handler `startup:renderer-ready`：`updateSplashStage("ready")` → `setTimeout(closeSplash, 180)` → `mainWindow.show(); mainWindow.focus();`。
  - 启动失败 `dialog.showErrorBox` 之前先 `closeSplash({ fade: false })`。
  - 远程模式分支显式调用 `updateSplashStage("pinging-remote")`。
- `desktop/electron/preload.ts` + `desktop/src/global.d.ts`：暴露 `startupRendererReady()`。
- `desktop/src/App.tsx`：在 `configLoaded === true` 后续的 `useEffect` 里，若是首次 ready，调用 `window.agenticxDesktop.startupRendererReady()`（防重入 ref）；并把 `!configLoaded` / `apiBase 为空` 两个占位降级为空 `<div />`（splash 接管反馈）。
- Splash HTML 内 25s 计时器：到点 unhide 取消按钮，按钮 click → `window.close()` + 通过 preload 暴露的 `splashRequestQuit()` IPC 通知主进程 `app.quit()`。

### Commit 2 — 打包资源 & 视觉打磨
- 修改 `desktop/electron-builder.yml`：把 `electron/splash.html` 与所需 logo 资源纳入构建（必要时通过 `extraResources` 或 `files`）。
- 修改 `desktop/electron/vite config`（如 `vite.config.ts` / `electron.vite.config.ts`）：让 splash.html 与图片复制到 `dist-electron/`，并能被 `__dirname` 相对解析。
- 视觉微调：shimmer 配色对齐 `desktop/src/styles/base.css` 的 token；浅/深色双套；图标使用 `assets/icon.png`（128px 渲染）。
- 手测：dev + DMG 各一次回归 AC-1 ~ AC-7。

### Commit 3 — 文档 / 总结（按 `/update-conclusion` 流程）
- 用 `/update-conclusion --plan=.cursor/plans/2026-05-25-desktop-startup-splash.plan.md` 更新代码 conclusion。
- 提交时使用 `/commit --spec=...`，附 `Plan-Id` / `Plan-File` / `Made-with: Damon Li`。

## 风险与回退

- **风险 R1**：vite-plugin-electron 不自动复制 HTML 静态资源 → splash.html 在打包环境找不到。
  - **缓解**：先在 Commit 1 内用 `fs.existsSync` 兜底，找不到时降级为内联 `data:` URL（splash 内容已 < 30KB）。
- **风险 R2**：`alwaysOnTop` 在 Linux 某些 WM 下抢焦点。
  - **缓解**：5s 后自动 `setAlwaysOnTop(false)`。
- **风险 R3**：renderer 永远不发 `startup:renderer-ready`（极端配置错误）。
  - **缓解**：主进程兜底定时器 60s 强制 `closeSplash + mainWindow.show()`。
- **回退**：删除 splash.ts / splash.html、移除 main.ts 内 `createSplashWindow` / `updateSplashStage` 调用、恢复 `mainWindow.once("ready-to-show", show)`、回滚 App.tsx 两个占位文案 — 一个 revert commit 即可。

## 范围外（明确不做）

- 不重写主窗显示逻辑（仍 `show: false` + `ready-to-show`，只是 show 时机推后）。
- 不改动后端启动顺序、`registerIpc` 拆分、远程模式判定逻辑。
- 不为 splash 加多语言（产品端默认中文）。
- 不引入第三方动画库（Lottie/Rive 等）。

---

**Plan-Id**: `2026-05-25-desktop-startup-splash`
**Plan-File**: `.cursor/plans/2026-05-25-desktop-startup-splash.plan.md`
