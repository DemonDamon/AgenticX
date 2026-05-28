---
name: splash-preload-core-data
overview: 扩展 splash「准备环境」阶段，在主窗显示前预拉取分身 / 活跃 pane 的会话 / 活跃 session 的工作区，让用户进入页面即看到数据已就绪，而非进来后再看到「加载分身…/暂无会话/暂无工作区」。
todos:
  - id: splash-stage-preloading-core
    content: splash.ts / splash-preload.ts / splash.html 新增 `preloading-core` 阶段与中文文案「正在加载工作数据…」
    status: completed
  - id: ipc-preload-core-data
    content: main.ts 新增 `preload-core-data` IPC，并发拉 listAvatars + 活跃 pane 的 listSessions + 该 session 的 listTaskspaces + 该 session 的 messages（复用 load-session-messages），每项独立超时（默认 6s），整体 12s
    status: completed
  - id: app-init-await-preload
    content: App.tsx 在 loadConfig 之后、startupRendererReady 之前调用 preload-core-data，把 avatars 灌进 store、messages 写入已有的 sessionMessageCache（66e517f4 落地）、sessions/taskspaces 写入新增的轻量 cache slice
    status: completed
  - id: force-show-timeout-tune
    content: 调整 scheduleSplashForceShowFallback 兜底超时，确保 preload 阶段最长不会让 splash 卡超过 ~15s；后端真挂时仍能进主窗
    status: completed
  - id: history-workspace-loading-ux
    content: SessionHistoryPanel / WorkspacePanel 在「尚未首次加载完成」与「真为空」之间增加 loading 占位（对齐 66e517f4 的 loadingMessages + skeleton 模式），避免历史回退；分身侧栏现有 spinner 不动
    status: completed
  - id: smoke-verify
    content: 冷启动 + 二次启动各跑一次：主窗显示瞬间，分身列表 / 历史面板 / 工作区面板均无 spinner、无「暂无」占位
    status: pending
isProject: false
---

# Near 启动 splash 预加载核心数据

## 背景

> **与 66e517f4 的关系**：上游 commit `66e517f4 perf(desktop): instant session switch with LRU message cache + skeleton` 已落地 `pane.loadingMessages` + 骨架屏 + `sessionMessageCache: Map<sessionId, Message[]>` LRU(10)，解决了「点击切换会话时旧气泡挂着」的体感卡顿。**本 plan 不重做这部分**，而是复用其设施：preload 阶段顺手把活跃 session 的 messages 也灌进 `sessionMessageCache`，让用户进主窗时连消息正文都已就绪；并将 SessionHistoryPanel / WorkspacePanel 的 loading 占位**对齐** `loadingMessages + skeleton` 的视觉模式，保持 UX 一致。

当前 Near 启动流程：

1. splash 显示 `backend-starting` → `backend-waiting` → `loading-ui`
2. `App.tsx` 加载 `loadConfig` 后立刻调用 `startupRendererReady`
3. splash 关闭，主窗显示
4. **进主窗后**才异步开始 `listAvatars` / `listSessions` / `listTaskspaces`

问题：用户在 splash 看到「准备环境」结束、进入主窗，却仍看到「正在加载分身…」「暂无会话」「暂无工作区」一段时间。`SessionHistoryPanel.loadSessions` 在 `result.ok === false` 时直接 return 不更新列表也不显示 loading；`WorkspacePanel` 在 sessionId 未恢复前显示「暂无工作区」——失败/未就绪态被误展示为「真的为空」。

## 目标

进入主窗瞬间，活跃 pane 的核心数据（分身列表、当前会话列表、当前 session 的工作区目录）已经在 store 里，UI 直接渲染。非活跃 pane 与重操作（MCP 恢复、Feishu/微信、知识库索引等）保持懒加载，不阻塞 splash。

## Requirements

### FR-1 splash 新增 `preloading-core` 阶段
- `SplashStage` 类型加 `preloading-core`
- splash.html 文案：`"preloading-core": "正在加载工作数据…"`
- 触发位置：`App.tsx` 在 `loadConfig` 之后调用 `updateSplashStage("preloading-core")`（通过新增 IPC 或扩展 `startup:renderer-ready` 的语义）

### FR-2 主进程预加载 IPC
- 新增 `preload-core-data` handler，输入 `{ avatarId?: string, sessionId?: string }`
- 内部并发执行：
  - `listAvatars()`
  - `listSessions(avatarId)`（avatarId 为空时拉 Meta 列表）
  - 若 `sessionId` 存在则 `listTaskspaces(sessionId)`，否则跳过
  - 若 `sessionId` 存在则 `load-session-messages(sessionId)`，否则跳过——结果写入渲染侧已有的 `sessionMessageCache`（66e517f4 引入），保证进主窗时活跃 pane 的消息正文已在缓存
- 每项独立 `Promise.race` 超时（默认 6000ms），单项失败/超时不影响其它项
- 复用现有 `waitForStudio` + 现有 IPC 的内部逻辑，不复制网络代码

### FR-3 App.tsx 启动序列调整
- 顺序：`loadConfig` → `updateSplashStage("preloading-core")` → `preload-core-data` → 灌 store → `startupRendererReady`
- preload 结果写入 store：
  - avatars → `useAppStore.setAvatars`
  - sessions → 写入 `SessionHistoryPanel` 可读的缓存（新增轻量 store slice 或 localStorage，避免侵入历史面板内部 state）
  - taskspaces → 写入 `WorkspacePanel` 可读的缓存
- 现有「pane 状态恢复」逻辑维持不变，但其中重复的 `listSessions` 调用应优先读 preload 结果，避免重复 IPC

### FR-4 兜底超时
- `scheduleSplashForceShowFallback` 当前超时不动，但 preload 必须有总体超时（默认 12s），到点强行 `startupRendererReady` 进主窗
- 远程模式 / 弱网下不得让 splash 卡住超过 15s

### FR-5 历史 / 工作区 loading UX
- `SessionHistoryPanel`：新增 `hasLoadedOnce` 状态，未首次加载完成显示骨架/loading；之后才允许显示「暂无会话」
- `WorkspacePanel`：`loading === true || !hasLoadedOnce` 时不显示「暂无工作区」
- 分身侧栏的现有 spinner 保持不动

### NFR-1 不引入新阻塞链路
- MCP 恢复、Feishu/微信 sidecar、Gateway client、知识库 preload 等不能纳入预加载集合
- 非活跃 pane 的 `listSessions` 仍懒加载

### NFR-2 远程模式兼容
- preload IPC 走与 `list-avatars` 等相同的 `getStudioUrl()` / `getStudioToken()`，远程模式自动可用
- 远程模式下首次 ping 失败已有现成兜底弹窗，preload 不重复处理

## Acceptance Criteria

- AC-1：冷启动 Near，主窗显示瞬间，活跃 pane 看到的是已渲染好的分身列表、当前会话列表、工作区目录，无 spinner、无「暂无」占位（前提：后端正常）。
- AC-2：后端启动正常但 preload 某一项超时（如 `listTaskspaces` 6s 未返回），splash 仍按时关闭，主窗进入后该项面板降级为 loading 态，几秒后自动出现数据。
- AC-3：后端完全无响应（kill `agx serve`），splash 在 ≤15s 内强制关闭进主窗，主窗各面板显示 loading 而非「暂无」。
- AC-4：进主窗后首次渲染活跃 pane，**不**触发 `load-session-messages` IPC（因为已在 splash 阶段灌进 `sessionMessageCache`），与 66e517f4 的「同 session 重复切回 0 IPC」体验对齐。

## 文件改动范围（预估）

| 文件 | 改动 |
| --- | --- |
| `desktop/electron/splash.ts` | 加 `preloading-core` 到 SplashStage 联合类型 |
| `desktop/electron/splash-preload.ts` | 同上 |
| `desktop/electron/splash.html` | 加文案 |
| `desktop/electron/main.ts` | 新增 `preload-core-data` IPC + 调整 splash 阶段触发 |
| `desktop/electron/preload.ts` | 暴露 `preloadCoreData` / `updateSplashStage` 给渲染 |
| `desktop/src/global.d.ts` | 类型声明 |
| `desktop/src/App.tsx` | 启动序列改造 |
| `desktop/src/store.ts` | 可能新增 `sessionListCache` / `taskspacePreload` slice |
| `desktop/src/components/SessionHistoryPanel.tsx` | `hasLoadedOnce` + loading 占位 |
| `desktop/src/components/WorkspacePanel.tsx` | `hasLoadedOnce` + loading 占位 |

## 非范围

- 不做后端侧 SessionManager / AvatarRegistry 优化（属另一 plan `session-switch-latency-profile` 的后续）
- 不解决本机代理导致 127.0.0.1 502 问题（独立的 `proxyAwareFetch` 推广 plan 处理）
- 不改 MCP 恢复 / 飞书 / 微信启动顺序
- 不重做 `sessionMessageCache` / `loadingMessages` / ChatPane 骨架屏（已在 66e517f4 落地，只复用）

## 回滚

启动序列改造集中在 `App.tsx` 一个 try/catch 块内，加 feature flag `AGX_SPLASH_PRELOAD=0` 可降级回当前行为。
