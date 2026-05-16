---
name: ""
overview: ""
todos: []
isProject: false
---

# 灵巧模式（语音胶囊）重塑 Plan

- Plan-Id: 2026-05-15-voice-focus-mode-reboot
- 状态: Draft（待用户确认）
- 关联用户偏好: AGENTS.md「Desktop 端 Focus Mode（焦点模式）」段落 — 本 plan 在用户授权下**显著调整**该偏好（从 Perplexity 文本胶囊 → 豆包式语音电话胶囊），落地后须由用户在 AGENTS.md 同步更新一句。

## What & Why

### 现状
当前 `Focus Mode`（灵巧模式）在 `desktop/electron/main.ts` 把窗口缩成 `300×110` 文本胶囊，渲染层通过 `.agx-app.focus-mode` 一坨 CSS（`desktop/src/styles/base.css` L272–L600+）把现有 `ChatPane` 强行塞进胶囊；`desktop/src/voice/{stt,tts}.ts` 仅基于浏览器 SpeechRecognition + macOS `say` 命令，没有任何实时双工能力。用户反馈：**「根本就用不了，而且也很丑，可以基本上抛弃了」**。

### 目标
完全抛弃旧 Focus Mode 的 UI 与文本聊天链路，重塑为**类豆包桌面悬浮球 / Siri / OpenAI Advanced Voice 的圆形语音胶囊**：
- 点击顶栏「灵巧模式」按钮 → 主窗口缩成圆形胶囊（约 280×280 含波形提示），停在屏幕右上角，无边框、置顶、可拖拽。
- 胶囊核心 = Machi 头像（圆形）+ 围绕头像的实时音量/状态环 + 一个"挂断"按钮。**没有文字输入框、没有消息列表、没有工具调用气泡**。
- 默认始终监听（VAD 自动断句），用户开口即说，模型回复时用户出声立即打断，体验对齐打电话。
- 模型回答固定走 **Meta-Agent（Machi）**，与现有 Plan/Pro 多窗格无关。
- 语音后端**支持多 Provider**（OpenAI Realtime、豆包实时语音 / 火山引擎），用户在设置里切换。

### Non-Goals（明确不做，避免范围漂移）
- 不做"语音对话历史回放"UI（语音轮次只落到当前 Meta session 的 messages.json，作为正常文本消息存档，不在胶囊里展示）。
- 不做"分身语音对话"（Maggie/Mike 等分身暂不接入，需要再开 Plan）。
- 不做唤醒词 / 后台常驻监听 / 锁屏唤起。
- 不接入电话级回声消除/降噪算法（依赖 WebRTC AEC 默认行为 + `getUserMedia` 的 `echoCancellation`/`noiseSuppression` 标准开关）。
- 不动旧 Focus Mode 之外的任何 ChatPane 文本能力。

## Requirements

### FR — 功能需求
- **FR-1 入口**：保留顶栏现有「灵巧模式」按钮（主题切换按钮左侧 Siri 风格图标），点击后进入新语音胶囊；按钮 tooltip 改为「灵巧模式 · 实时语音」。
- **FR-2 窗口形态**：胶囊为 280×280（含 24px 内边距与 40px 波形高度），无边框、透明背景、`alwaysOnTop: floating`，可全局拖拽，停靠右上角默认 24/24 边距。
- **FR-3 胶囊 UI**：从外到内：旋转/呼吸的状态光环（idle/listening/thinking/speaking 四态用不同节奏） → 圆形 Machi 头像（取自 `metaAvatarUrl`，回落到默认资源） → 头像下沿叠一个 20px 高的实时音量条（说话时跟麦克风音量，模型说话时跟模型音频音量）。
- **FR-4 退出**：胶囊左下角小型「挂断」图标（红底圆点），点击恢复主窗口；同时 ESC 键也可退出（焦点在胶囊时）。退出按钮**不再用 ✕**，对齐打电话语义。
- **FR-5 多 Provider 抽象**：新增 `desktop/src/voice/realtime/` 目录，定义 `RealtimeVoiceProvider` 接口（connect / sendAudio / onAudio / onTranscript / interrupt / disconnect / dispose），先实现 OpenAI Realtime（WebRTC，端到端）与豆包实时语音（火山 RTC + Doubao-Voice）两家。
- **FR-6 Meta 路由**：所有语音轮次绑定当前 Meta-Agent session（`avatar_id` 为空的活跃 pane 对应的 session），用户提问与模型回复均落盘到该 session 的 `messages.json`，role 分别为 `user`/`assistant`，并在 metadata 标 `source: "voice-focus"`。
- **FR-7 始终监听 + 自动打断**：默认进入即开始监听，VAD 检测说话结束自动提交；模型说话期间检测到用户开口立即调用 provider 的 `interrupt()` 截停模型音频。
- **FR-8 设置面板**：`SettingsPanel` 新增「语音」Tab（中文「语音」，与现有 Tab 信息架构对齐），含：Provider 选择、API Key、模型/Voice ID（如 OpenAI 的 `alloy/echo/shimmer`、豆包的音色编号）、连通性测试按钮、麦克风设备选择。
- **FR-9 配置持久化**：`~/.agenticx/config.yaml` 新增 `voice:` 节（`provider`、`openai_realtime: { api_key, model, voice }`、`doubao_realtime: { app_id, access_key, secret_key, voice_type }`、`input_device_id`），通过现有 `agx serve` 配置读写 IPC（`load-config` / `save-config` 等）落盘。
- **FR-10 错误兜底**：未配置任何 provider 时进入灵巧模式弹**就近**提示「请先在 设置 → 语音 配置实时语音 Provider」并直接打开设置页对应 Tab；配置中但握手失败 / 麦克风权限被拒时，胶囊状态环变红 + 中央显示一句话错因 + 自动 5s 退出。

### NFR — 非功能需求
- **NFR-1 延迟**：从用户说完到模型开口的 P50 ≤ 800ms（OpenAI Realtime 实测一般可达），P95 ≤ 1500ms。
- **NFR-2 兼容**：Mac arm64 / x64、Windows x64 三平台均可用；无 Apple 签名构建下不引入需要签名的原生模块。
- **NFR-3 隐私**：麦克风音频仅在用户进入灵巧模式时采集，退出立即 `MediaStream.getTracks().forEach(t => t.stop())`；API Key 不出现在渲染进程日志。
- **NFR-4 主题**：胶囊外环、头像描边、波形配色严格走 `--ui-*` token，dark/dim/light 三态都好看，不硬编码 cyan / `#xxx`。

### AC — 验收标准
- **AC-1**：旧 `.agx-app.focus-mode*` CSS、`ChatPane` 内 `focusMode` 分支、`focus-mode-expand` IPC 全部删除；`rg "focus-mode"` 在 `desktop/src` 下仅命中新组件相关命名。
- **AC-2**：未配置 provider 情况下点击灵巧模式 → 弹出引导并跳转设置页，无白屏、无报错。
- **AC-3**：配置 OpenAI Realtime 后，进入胶囊 → 说"你好" → 1.5s 内听到 Machi 用所选 voice 回复"你好"等效内容，整轮无需点任何按钮。
- **AC-4**：模型回复中说"停"或随便插一句 → 模型音频在 ≤ 200ms 内截停，胶囊状态环切回 listening。
- **AC-5**：退出胶囊后窗口 / 红绿黄按钮 / vibrancy / 最小尺寸 / 工作区面板状态全部恢复进入前。
- **AC-6**：当前轮次的 user 与 assistant 文本（Realtime API 边出音频边出 transcript）写入当前 Meta session 的 `messages.json`，`metadata.source === "voice-focus"`，重启 desktop 仍能在历史会话面板看到这两条。
- **AC-7**：切换主题（dark/dim/light）胶囊视觉无穿帮，状态环、波形、头像描边均 token 化。

## Implementation Phases

按"先骨架可见、再接实时语音、再多 Provider、最后打磨"分四段提交。每段独立 `npm run typecheck && npm run build` 绿后再进下一段，避免一次大爆炸。

### P0 — 拆旧 + 新窗口策略 + VoiceFocusMode 静态骨架
> 目标：点击灵巧模式按钮，窗口正确变圆形胶囊，胶囊里渲染头像 + 状态环 + 假波形 + 挂断按钮，退出能完美还原。**还没有真实语音。**

文件改动：
- 删 `desktop/src/styles/base.css` L272–~L600 的 `.agx-app.focus-mode*` 全部规则。
- 删 `desktop/src/components/ChatPane.tsx` 内所有 `focusMode` / `focusModeTall` / `focusComposerOnly` 分支与渲染（约 30+ 处），`ChatPane` 在灵巧模式下**不再被渲染**。
- 删 `desktop/electron/main.ts` 的 `focus-mode-expand` IPC 与 `focusModeTall` 相关逻辑；保留并改造 `focus-mode-enter` / `focus-mode-exit`：
  - 尺寸改为 `280×280`，仍停右上角。
  - macOS 下加 `mainWindow.setShape?` 不可用 → 用透明窗口 + CSS 圆形遮罩。
- `desktop/src/store.ts` 删 `focusModeTall` / `focusSnapshot.panePanels` / `setFocusModeTall`；`enterFocusMode` 简化为只切 `focusMode = true` + 调 IPC，不再去清各窗格 panel 状态。
- 新增 `desktop/src/components/VoiceFocusMode.tsx`：纯 UI 组件，props = `{ status, micLevel, onHangup }`，渲染状态环 + Machi 头像（用 `metaAvatarUrl` 回落 `assets/machi-empty-state.svg`）+ 假波形 + 挂断按钮。
- 新增 `desktop/src/styles/voice-focus.css`（从 `base.css` 切出，单独维护），全部用 `--ui-*` token。
- `desktop/src/App.tsx`：当 `focusMode === true` 时**只渲染** `<VoiceFocusMode />`，**完全不渲染** `MainShell` / `PaneManager` / `Topbar`，保证胶囊内不会"看到"原界面残影。
- 顶栏「灵巧模式」按钮 tooltip 文案改为「灵巧模式 · 实时语音」。

验收：
- 进入/退出 5 次窗口尺寸/按钮/vibrancy/最小尺寸均能正确还原。
- `rg "focus-mode|focusModeTall|focusComposerOnly"` 在 `desktop/src` 下命中数 ≤ 新组件 + store 的核心字段。
- 三套主题下胶囊都好看（截图自检）。

### P1 — Voice Provider 抽象 + OpenAI Realtime 端到端打通
> 目标：配置 OpenAI Realtime 后，胶囊真能对话（VAD + 自动打断 + transcript 落盘）。

文件改动：
- 新增 `desktop/src/voice/realtime/types.ts`：`RealtimeVoiceProvider` 接口、事件类型（`audio`、`transcript`、`status`、`error`）、`VoiceSessionOptions`。
- 新增 `desktop/src/voice/realtime/openai-realtime.ts`：基于 [OpenAI Realtime WebRTC 协议](https://platform.openai.com/docs/guides/realtime/webrtc)，在 renderer 直接走 WebRTC（`RTCPeerConnection` + `getUserMedia` 麦克风轨道 + `addTrack`），ephemeral key 通过新增的 `agx serve` 端点 `POST /api/voice/realtime/ephemeral_key`（在 `agenticx/studio/server.py` 添加，从 `~/.agenticx/config.yaml` 读 OpenAI key 后向 `https://api.openai.com/v1/realtime/sessions` 换 ephemeral token，避免长 key 落到渲染进程）。
- 新增 `desktop/src/voice/realtime/index.ts`：工厂方法 `createVoiceProvider(config): RealtimeVoiceProvider`。
- 改造 `VoiceFocusMode.tsx`：`useEffect` 在挂载时 `createVoiceProvider().connect()`，订阅 `audio`（接到 `<audio>` 元素播放）、`transcript`（每轮结束写入当前 Meta session）、`status`（驱动状态环），卸载时 `disconnect()`。
- 麦克风音量条：用 `AnalyserNode` + `requestAnimationFrame` 取音量驱动 `micLevel`。
- 模型回复音量条：同样在 `<audio>` 元素接 `AnalyserNode`。
- VAD：直接复用 OpenAI Realtime 服务端内置的 server-side VAD（`turn_detection: { type: "server_vad" }`），不在 client 自己跑 Silero。
- 自动打断：监听本地麦克风音量超阈 + Realtime 协议的 `input_audio_buffer.speech_started` 事件，触发 `provider.interrupt()`（OpenAI 实现里发 `response.cancel`）。
- Transcript 落盘：新增 IPC `voice-append-message`（preload + main 主进程透传到 `agx serve` 的 `POST /api/session/messages/append`），写 `{role, content, metadata: {source: "voice-focus"}}` 到当前 Meta pane 的 sessionId。

依赖新增：
- 不引入 npm 新包（WebRTC API 是浏览器内置）。
- 服务端不引入新依赖（直接用 `httpx`）。

验收：
- AC-3 / AC-4 / AC-6 全部通过。

### P2 — 豆包实时语音 Provider
> 目标：用户在设置页选「豆包实时语音」后，行为与 OpenAI Realtime 一致。

文件改动：
- 新增 `desktop/src/voice/realtime/doubao-realtime.ts`：基于火山引擎 RTC SDK + Doubao-Voice 实时语音协议。SDK 通过 `npm i @volcengine/rtc` 引入（在 `desktop/package.json`），实现接口与 OpenAI 实现等价。
- `agenticx/studio/server.py` 新增 `POST /api/voice/realtime/doubao_token`：用 app_id/access_key/secret_key 签发 RTC 临时 token，避免长期凭据落渲染。
- `desktop/src/voice/realtime/index.ts` 工厂识别 `provider === "doubao"` 走豆包实现。

验收：
- 配置豆包账号后切换 Provider，胶囊行为与 OpenAI Realtime 一致；切换不需要重启 desktop。

### P3 — 设置面板 + 配置持久化 + 错误兜底 + 主题打磨
> 目标：把"能用"打磨成"客户能用"。

文件改动：
- 新增 `desktop/src/components/settings/voice/VoiceSettingsPanel.tsx`：Provider Radio（OpenAI Realtime / 豆包实时语音）、对应字段表单、麦克风设备 `enumerateDevices()` 下拉、「测试连通性」按钮（调一次 ephemeral_key 端点验证），UI 风格对齐已有 `WebSearchSettingsPanel`。
- `SettingsPanel.tsx` 新增「语音」Tab，中文化文案。
- `agenticx/studio/server.py` 新增 `GET/PUT /api/voice/settings`，读写 `~/.agenticx/config.yaml` 的 `voice:` 节。
- 错误兜底（FR-10）UI：在 `VoiceFocusMode` 内补 `<ErrorOverlay />` + 自动退出 timer。
- 主题：状态环颜色用 `--ui-accent`、波形用 `--ui-fg-subtle`、错误态用 `--ui-danger`。
- AGENTS.md 由用户更新「Desktop 端 Focus Mode」段落，把 Perplexity 文本胶囊偏好替换成"豆包式实时语音胶囊"。

验收：
- AC-1 ~ AC-7 全部通过；
- 在 dark/dim/light 三套主题各截一张图，确认无视觉穿帮；
- 三平台 typecheck + build 绿。

## Risks & Open Questions

1. **OpenAI Realtime 区域可用性**：国内直连可能被墙，需用户自配 `OPENAI_BASE_URL` 走代理。设置页字段需暴露自定义 base URL。
2. **豆包实时语音商务接入**：需要客户/用户自备火山引擎账号开通 Doubao-Voice 实时语音应用并拿到 app_id/access_key/secret_key；若客户没有，只能先用 OpenAI 路线。
3. **Realtime API 计费**：实时语音按音频时长计费，且较贵（OpenAI 约 $0.06/min input + $0.24/min output）。需在设置页显著提示。
4. **macOS 麦克风权限**：首次进入灵巧模式会触发系统弹窗，无法跳过；用户偏好"零打扰"时只能以一次性弹窗为代价。
5. **Windows 透明无边框窗口圆形遮罩**：Windows 不支持真窗口非矩形，CSS 圆形 + 透明四角是事实标准，需测试拖拽热区不要因透明四角断裂。
6. **现有 `desktop/src/voice/{stt,tts,wakeword,interrupt}.ts`**：本 plan **不动**这四个文件（它们目前未被灵巧模式调用，留给未来其他场景）；如最终确认无任何引用，可在 P3 末尾顺手删除（需先 `rg` 确认零引用并经用户同意）。

## Files Touched (Summary)

新增：
- `desktop/src/components/VoiceFocusMode.tsx`
- `desktop/src/styles/voice-focus.css`
- `desktop/src/voice/realtime/types.ts`
- `desktop/src/voice/realtime/index.ts`
- `desktop/src/voice/realtime/openai-realtime.ts`
- `desktop/src/voice/realtime/doubao-realtime.ts`
- `desktop/src/components/settings/voice/VoiceSettingsPanel.tsx`

修改：
- `desktop/src/styles/base.css`（删 `.agx-app.focus-mode*`）
- `desktop/src/components/ChatPane.tsx`（删 focusMode 分支）
- `desktop/src/components/Topbar.tsx`（按钮 tooltip）
- `desktop/src/components/SettingsPanel.tsx`（新增 Tab）
- `desktop/src/App.tsx`（focusMode 渲染分流）
- `desktop/src/store.ts`（精简 focus 字段）
- `desktop/electron/main.ts`（窗口尺寸 + 删 expand IPC）
- `desktop/electron/preload.ts`（新增 voice IPC）
- `desktop/src/global.d.ts`（新增 voice IPC 类型）
- `agenticx/studio/server.py`（新增 voice 设置与 ephemeral_key 端点）
- `AGENTS.md`（用户更新偏好段落）

不动：
- `desktop/src/voice/{stt,tts,wakeword,interrupt}.ts`（除非 P3 末尾确认无引用）
- 任何分身 / 群聊 / Plan-Mode / 工作区相关代码
- enterprise / cli / cc-bridge / gateway 等其他模块

Plan-File: .cursor/plans/2026-05-15-voice-focus-mode-reboot.plan.md