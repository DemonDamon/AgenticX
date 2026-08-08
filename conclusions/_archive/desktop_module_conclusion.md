> 已归档（2026-08-08）：内容不再单独维护。server 相关请见 conclusions/server_module_conclusion.md；desktop 相关请见 desktop/conclusions/desktop_conclusion.md。

# Desktop 模块结论（Near）

> 结论更新时间：2026-05-29（覆盖 2026-05-25 之后的变更）
>
> 本轮新增能力（2026-05-25 → 05-29）：远程后端模式与按后端隔离的会话存储、全局系统搜索、检索引用卡片与行内角标、按住说话（Doubao ASR）流式语音输入、会话切换即时化（LRU 缓存）+ 历史面板分组分页/折叠、Splash 预加载、stall 续跑与操作按钮冲突修复、聊天密钥安全 UX、主进程代理（undici/HTTPS_PROXY）。

## 启动 Splash 窗口（2026-05-25）

Near 桌面端冷启动时，在 `agx serve` 就绪前用户可能长时间只看到 Dock 图标。新增独立 **Splash BrowserWindow**（Marvis 风格）提供品牌露出、真实阶段文案与 25s 后可取消退出。

### 核心文件

| 文件 | 职责 |
|------|------|
| `desktop/electron/splash.html` | Splash UI：Logo + Near 品牌 + shimmer 进度条 + 阶段文字 + 取消按钮 |
| `desktop/electron/splash-preload.ts` | Splash 专用 preload：`splash:stage` 监听、`splash-request-quit` |
| `desktop/electron/splash.ts` | 创建/更新/关闭 Splash；主题读 `~/.agenticx/layout.json` 的 `theme` |
| `desktop/electron/main.ts` | 冷启动流程插入阶段更新；主窗 `show()` 推迟至 `startup:renderer-ready` |
| `desktop/src/App.tsx` | 配置与会话恢复完成后调用 `startupRendererReady()` |

### 启动时序

1. `app.whenReady()` → 立即 `createSplashWindow()`（仅冷启动一次，`splashShownOnce`）
2. 本地模式：`backend-starting` → `backend-waiting`；远程模式：`pinging-remote`
3. `createWindow()` → `loading-ui`；主窗 `did-finish-load` → `restoring-session`
4. Renderer：`configLoaded && sessionId 就位` → IPC `startup:renderer-ready`
5. 主进程：180ms 淡出 Splash → `mainWindow.show()`；60s 兜底强制显示主窗

### IPC

- `startup:renderer-ready`（renderer → main）：关闭 Splash 并显示主窗
- `splash-request-quit`（splash → main）：用户取消 → `app.quit()`
- `splash:stage`（main → splash）：推送阶段 key

### 打包

`npm run build` 会将 `electron/splash.html` 复制到 `dist-electron/`；`electron-builder.yml` 已包含 `dist-electron/**/*`。

### 范围外

- `activate` / `second-instance` 唤回主窗不重复显示 Splash
- 不改动 `startupOptimizing` 8s 性能优化逻辑

### Splash 预加载（NEW, commit `af81affc`）

Splash 展示期间并行预热分身/会话/工作区数据，主窗显示即就绪，免去进窗后的二次加载等待。

| 文件 | 职责 |
|------|------|
| `desktop/src/utils/splash-preload-core.ts` (NEW) | 预加载核心：在 Splash 阶段拉取分身列表、最近会话、工作区状态并写入 store |
| `desktop/electron/main.ts` / `splash.ts` | 新增预加载阶段编排与 IPC |
| `desktop/src/store.ts` / `App.tsx` | 消费预加载结果，主窗挂载后直接渲染 |

## 远程后端模式与会话隔离（NEW, 2026-05-25, commits `e09f1095` `4b9751ff` `b4f2669c` `acd90bbf`）

打破「硬绑本地 `agx serve`」的限制，支持连接远程后端，并按后端隔离会话存储。

| 文件 | 职责 |
|------|------|
| `desktop/electron/main.ts` / `preload.ts` | 远程模式下 ping 远端、Provider 配置路由到远程后端；切换后端自动重启 |
| `desktop/src/components/SettingsPanel.tsx` | 后端模式（本地/远程）配置入口 |
| `desktop/src/utils/avatar-last-session.ts` | 会话存储按后端 scope 隔离 |
| `desktop/src/store.ts` / `App.tsx` | 后端切换状态管理 |

- 远程不可达时回退到本地后端（`acd90bbf`）
- 顶栏左侧展示后端 scope chip（`b4f2669c`）

## 全局系统搜索（NEW, commits `ef545503` `aa0e413e` `fb3ad295` `be1040d9` `f38e4f73`）

侧栏触发的全局搜索面板，跨会话/分身检索，视觉对齐 Settings 与 Marvis。

| 文件 | 职责 |
|------|------|
| `desktop/electron/system-search.ts` (NEW, 571 行) | 主进程全局搜索后端：跨 session 检索与结果聚合 |
| `desktop/src/components/global-search/GlobalSearchPanel.tsx` (NEW) | 搜索面板 UI |
| `desktop/src/components/global-search/GlobalSearchTrigger.tsx` (NEW) | 侧栏触发入口 |
| `desktop/src/components/global-search/global-search-events.ts` (NEW) | 搜索事件总线 |
| `desktop/electron/main.ts` / `preload.ts` / `global.d.ts` | IPC 与类型声明 |

- 结果右键上下文菜单（`aa0e413e`）、空闲态 UX 与更新深度循环修复（`f38e4f73`）

## 检索引用卡片与行内角标（NEW, commit `8051c123`）

assistant 回复中渲染检索来源引用，支持引用卡片与行内角标。

| 文件 | 职责 |
|------|------|
| `desktop/src/components/messages/CitationBadge.tsx` (NEW) | 行内引用角标 |
| `desktop/src/components/messages/CitationMarkdownBody.tsx` (NEW) | 带引用标记的 Markdown 渲染 |
| `desktop/src/components/messages/ReferencesCard.tsx` (NEW, 145 行) | 引用来源卡片 |
| `ChatPane.tsx` / `ChatView.tsx` / `MessageRenderer.tsx` | 接入引用渲染链路 |

## 按住说话语音输入（NEW, commit `317534ba`）

Push-to-talk 流式语音输入，走 Doubao ASR。

| 文件 | 职责 |
|------|------|
| `desktop/src/hooks/useVoicePushToTalk.ts` (NEW, 137 行) | PTT 录音与流式上送钩子 |
| `desktop/src/voice/stt-ptt-doubao.ts` (NEW) | Doubao ASR 流式识别 |
| `desktop/src/voice/stt-ptt.ts` / `ptt-config.ts` / `pcm-utils.ts` (NEW) | PTT 链路、配置与 PCM 处理（含 `*.test.ts` 单测） |
| `desktop/src/components/VoicePttOverlay.tsx` (NEW) | 按住说话浮层 |
| `desktop/src/components/settings/voice/VoiceSettingsPanel.tsx` | PTT 设置项 |

## 会话切换即时化与历史面板（NEW, commits `66e517f4` `365d701c` `3480df0d` `d683a69f` `85dad862` `c7c2d8c1`）

会话切换从「等待加载」改为「即时切换 + 骨架屏」，历史面板对齐 Cursor 的分组分页与折叠。

| 文件 | 职责 |
|------|------|
| `desktop/src/store.ts` | LRU 消息缓存（即时切换 + 骨架屏） |
| `desktop/src/components/SessionHistoryPanel.tsx` | 分组分页（Cursor 式）、Last 30 days 分桶、折叠（折叠时重置）、Today 分桶修正与隐藏空会话 |
| `desktop/src/components/ChatPane.tsx` | 切换时消费缓存 |
| `c7c2d8c1` | 全链路（前端/IPC/后端）会话切换延迟埋点 |

## stall 续跑与操作按钮冲突修复（NEW, commit `0c02337a`）

修复生成停滞后的续跑、消息操作按钮冲突与切回 session 后的状态追平。

| 文件 | 职责 |
|------|------|
| `desktop/src/components/ChatPane.tsx` | 续跑与 session 切回状态追平 |
| `desktop/src/components/messages/StallRecoveryCard.tsx` / `ImBubble.tsx` | 停滞恢复卡与气泡操作 |
| `desktop/src/utils/im-bubble-actions.ts` / `session-continue.ts` | 操作按钮与续跑上下文构造（含单测） |
| `f277c5fb` | 模型跳过最终 `todo_write` 时自动收尾粘滞任务条 |

## 其它体验修复（2026-05-26 → 05-29）

- **聊天密钥安全 UX**（`4bcd2d7a`）：`SettingsPanel.tsx` 拒绝在聊天中输入 API Key 并给出安全提示
- **主进程代理**（`99191eff` `d0af2a08` `ee9ef8b5`）：主进程 fetch 改用 undici 直发以使 `ProxyAgent`/`HTTPS_PROXY` 生效，undici 钉到 `^6` 兼容 Electron 34
- **模型选择器**（`b11d4029` `7fa4d881`）：按已配置 Provider 展示、拒绝可见目录外的过期模型
- **图片拖拽**（`73ef788a`）：支持将图片拖拽到聊天输入框
- **托盘图标**（`52e7f136`）：占位图标替换为 Near wireframe 品牌
- **群聊身份/进度 UI**（`f8eb2834`）、中文 IME 下 Enter 发送（`580e9aaf`）、上下文提示与工具调用图标主题对齐（`7eadc7bc`）、知识库设置可读性（`68f24360`）、Doubao 语音提示浅色可读性（`2ab2581f`）等
