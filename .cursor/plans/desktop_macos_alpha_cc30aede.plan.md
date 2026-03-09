---
name: Desktop macOS Alpha
overview: 将现有 desktop 脚手架打磨为可在 macOS 上真实运行的 Alpha 版桌面应用，包含 UI 体验升级、macOS 适配、语音集成、E2E 验证和 DMG 打包。
todos: []
isProject: true
phases:
  - name: "Phase 1: macOS 基础适配"
    todos:
      - id: p1-native-menu
        content: "electron/main.ts: 使用 Menu.buildFromTemplate 创建标准 macOS 菜单栏（AgenticX > About/Quit, Edit > Cut/Copy/Paste, Window > Minimize/Close），设置 app.dock.setIcon()，窗口加 vibrancy:'under-window' + titleBarStyle:'hiddenInset' 实现毛玻璃 + 圆角"
        status: pending
      - id: p1-visible-workspaces
        content: "electron/main.ts: mainWindow 设置 visibleOnAllWorkspaces: true + skipTaskbar: false，确保悬浮球在 macOS 全屏 App 上方仍可见；处理 app.on('activate') 重新显示窗口"
        status: pending
      - id: p1-tray-icon
        content: 新建 desktop/assets/trayTemplate.png（16×16 黑色模板图标 + @2x 版本），更新 main.ts 读取打包后路径（process.resourcesPath）；Tray 点击切换侧边栏显隐
        status: pending
      - id: p1-serve-lifecycle
        content: "electron/main.ts: app.whenReady 时通过 child_process.spawn 启动 agx serve --host 127.0.0.1 --port <random>；stdout 解析 'Uvicorn running' 后才 loadURL；app.on('before-quit') kill 子进程；端口号通过 IPC 传给渲染进程"
        status: pending
      - id: p1-preload-ipc
        content: "electron/preload.ts: 通过 contextBridge 暴露 { getApiBase(), onOpenSettings(callback), platform } 给渲染进程；main.ts 通过 ipcMain.handle('get-api-base') 返回 http://127.0.0.1:<port>"
        status: pending
  - name: "Phase 2: UI 体验升级"
    todos:
      - id: p2-tailwind
        content: "安装 tailwindcss + postcss + autoprefixer；新建 tailwind.config.ts（content: ['src/**/*.tsx']）、postcss.config.mjs；新建 src/index.css（@tailwind base/components/utilities + dark 主题变量）；main.tsx import index.css"
        status: pending
      - id: p2-store
        content: 新建 src/store.ts：Zustand store 管理 messages、sessionId、status、sidebarOpen、apiBase、settings（provider/model）；App.tsx 和所有组件改用 store 驱动
        status: pending
      - id: p2-floating-ball-upgrade
        content: "FloatingBall.tsx: 改为 Tailwind 样式；加 HTML5 拖拽（mousedown/move/up 记录偏移）；状态指示改为脉冲动画（idle=绿/listening=蓝呼吸/processing=橙旋转）；右键菜单（设置/侧边栏/退出）使用自定义 context menu 组件"
        status: pending
      - id: p2-sidebar-upgrade
        content: "Sidebar.tsx: 气泡布局（用户右对齐深色、助手左对齐浅色、工具调用灰色带图标）；消息支持 Markdown 渲染（引入 react-markdown）；滚动自动吸底；输入框支持 Enter 发送 + Shift+Enter 换行"
        status: pending
      - id: p2-confirm-dialog
        content: "新建 ConfirmDialog.tsx: 模态蒙层 + 居中卡片，显示问题文本 + diff 预览（若 context 含 diff 字段则高亮展示）；确认/取消按钮；替换 Sidebar.tsx 中的 window.confirm"
        status: pending
      - id: p2-code-preview
        content: "新建 CodePreview.tsx: 语法高亮代码展示（引入 prismjs 或 shiki-wasm）；替换 Sidebar 中的 <pre> 预览区；支持从 /api/artifacts 拉取最新产物并展示"
        status: pending
      - id: p2-settings-panel
        content: "新建 SettingsPanel.tsx: Provider 选择下拉 + Model 输入 + API Key 输入（密码样式）；保存到 Zustand store 并通过 IPC 持久化到 ~/.agenticx/config.yaml；从 main.ts IPC open-settings 事件触发显示"
        status: pending
  - name: "Phase 3: 语音集成（macOS 优先）"
    todos:
      - id: p3-whisper-stt
        content: "voice/stt.ts: 集成 Whisper.cpp WASM（tiny.en 或 base 模型）；录音使用 navigator.mediaDevices.getUserMedia；录音完成后送 Whisper 转写；若 WASM 加载失败则 fallback 到 Web Speech API；导出 startRecording() / stopRecording() / onResult(text)"
        status: pending
      - id: p3-native-tts
        content: "voice/tts.ts: macOS 环境下通过 IPC 调用主进程的 child_process.execFile('say', ['-v', 'Ting-Ting', text])；非 macOS 或失败时 fallback 到 Web Speech API；保留 stopSpeak() 能力"
        status: pending
      - id: p3-wakeword-loop
        content: "voice/wakeword.ts: 在 idle 状态下启动持续 STT 监听（低采样率/短片段），检测到 'hey jarvis' / '嘿 jarvis' 后切换到 listening 状态；结果文本去除唤醒词后作为用户输入发送"
        status: pending
      - id: p3-interrupt-upgrade
        content: "voice/interrupt.ts: 监听 STT 中间结果（interimResults=true），检测到用户开始说话时立即调用 stopSpeak()；在 Sidebar 中绑定：收到 final 事件 → speak() → 用户说话 → interrupt → 新一轮输入"
        status: pending
      - id: p3-voice-button
        content: FloatingBall 长按触发录音模式：mousedown 开始录音、mouseup 停止并发送；状态切换 idle→listening→processing→idle；Sidebar 也加一个麦克风图标按钮作为备选触发方式
        status: pending
  - name: "Phase 4: 打包与分发"
    todos:
      - id: p4-builder-config
        content: "新建 desktop/electron-builder.yml: appId: com.agenticx.desktop, mac.target: [dmg, zip], mac.icon: assets/icon.icns, mac.category: public.app-category.developer-tools, files: [dist-electron/**, dist/**], extraResources: [assets/**]"
        status: pending
      - id: p4-app-icon
        content: 新建 desktop/assets/icon.icns（1024×1024 → icns 转换）；或使用 electron-builder 支持的 icon.png 自动转换；同时放一份 icon.ico 备 Windows 打包
        status: pending
      - id: p4-build-script
        content: "package.json 新增 scripts: { 'build:mac': 'npm run build && electron-builder --mac', 'build:win': 'npm run build && electron-builder --win', 'build:linux': 'npm run build && electron-builder --linux' }；确保 vite build 输出到 dist/、tsc 输出到 dist-electron/"
        status: pending
      - id: p4-cors-fix
        content: "agenticx/studio/server.py: 添加 CORS middleware（allow_origins=['http://localhost:*', 'file://*']），确保 Electron 打包后 file:// 协议能请求 API；或改用 Electron 自带 protocol 拦截"
        status: pending
      - id: p4-smoke-test
        content: 在 macOS 上执行完整验证：npm run build:mac → 打开 .dmg → 安装到 Applications → 启动 → 验证自动启动 agx serve → 输入文本 → 收到 SSE 事件 → 确认弹窗 → 查看代码预览 → 退出时 serve 进程被清理
        status: pending
  - name: "Phase 5: E2E 测试与文档"
    todos:
      - id: p5-playwright-e2e
        content: "安装 @playwright/test + electron；新建 desktop/e2e/app.spec.ts: 启动 Electron → 验证 session 创建 → 输入文字 → 断言消息气泡出现 → 验证悬浮球拖拽 → 验证设置面板打开/关闭"
        status: pending
      - id: p5-desktop-readme
        content: "更新 desktop/README.md: 开发环境要求（Node 20+、Python 3.10+、agx 已安装）、快速启动步骤、打包步骤、架构说明图、已知限制（macOS 签名需证书、Windows 未测试等）"
        status: pending
      - id: p5-docs-cli
        content: "更新 docs/cli.md: 在 agx serve 章节补充 desktop 联动说明；新增「桌面版」章节描述安装与使用"
        status: pending
---

# AgenticX Desktop macOS Alpha

## 现状评估

当前 `desktop/` 已完成脚手架（Electron + React + Vite + TypeScript），但存在以下差距：

- 组件为 inline style 原型，无设计语言
- 无 macOS 原生适配（Dock 图标、原生菜单、`visibleOnAllWorkspaces`、窗口圆角）
- 托盘图标资源缺失
- `window.confirm` 做确认弹窗，体验粗糙
- STT 依赖 Web Speech API，在 Electron Chromium 中 macOS 上不可靠
- 无打包配置，无法生成 `.dmg`
- 服务端 `agx serve` 需手动启动，desktop 与 serve 无生命周期联动

## 技术决策

- **样式方案**：Tailwind CSS 4（零配置 + PostCSS），轻量且适合小型 UI
- **macOS 原生菜单**：Electron `Menu.setApplicationMenu` + 标准 macOS 菜单模板
- **STT**：Whisper.cpp WASM（`@nicepkg/whisper.cpp-wasm`）作为主方案，Web Speech API 作 fallback
- **TTS**：macOS `say` via Electron `child_process` + Edge TTS（网络可用时）
- **打包**：`electron-builder` → `.dmg` target，Code Sign 可选（CI 阶段再加）
- **服务联动**：Electron 主进程通过 `child_process.spawn` 启动 `agx serve`，退出时 `kill`
- **状态管理**：Zustand（已有依赖），不引入新库

## 文件清单（预计变更）

- `desktop/package.json`：加 tailwindcss、whisper.cpp-wasm、postcss 依赖
- `desktop/tailwind.config.ts`（新建）
- `desktop/postcss.config.mjs`（新建）
- `desktop/src/index.css`（新建）：Tailwind directives
- `desktop/electron/main.ts`（重构）：macOS 适配、serve 联动、原生菜单
- `desktop/electron/preload.ts`（扩展）：暴露 IPC bridge
- `desktop/src/App.tsx`（重构）：接入 Zustand store
- `desktop/src/store.ts`（新建）：全局状态 store
- `desktop/src/components/FloatingBall.tsx`（升级）：拖拽、动画、右键菜单
- `desktop/src/components/Sidebar.tsx`（升级）：气泡 UI、Markdown 渲染、确认弹窗组件化
- `desktop/src/components/ConfirmDialog.tsx`（新建）
- `desktop/src/components/CodePreview.tsx`（新建）
- `desktop/src/components/SettingsPanel.tsx`（新建）
- `desktop/src/voice/stt.ts`（升级）：Whisper WASM + fallback
- `desktop/src/voice/tts.ts`（升级）：macOS `say` + Edge TTS
- `desktop/src/voice/wakeword.ts`（升级）：持续监听循环
- `desktop/assets/trayTemplate.png`（新建）：16×16 macOS tray icon
- `desktop/assets/icon.icns`（新建）：macOS app icon
- `desktop/electron-builder.yml`（新建）：打包配置
- `agenticx/studio/server.py`（微调）：CORS 支持（生产模式时 file:// origin）

