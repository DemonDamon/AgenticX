---
name: 个人微信（iLink）接入 Machi 桌面
overview: |
  通过 Go Sidecar 桥接 openilink-sdk-go，让 Machi 桌面支持个人微信扫码绑定、
  消息收发，实现「在微信里给 Machi 发消息→本机 Agent 执行→结果回微信」的闭环体验。
todos:
  - id: phase-1-sidecar
    content: "Phase 1: Go Sidecar 最小可用（bind + monitor + send）"
    status: completed
  - id: phase-1-desktop
    content: "Phase 1: Desktop 子进程管理 + SettingsPanel 微信 Tab"
    status: completed
  - id: phase-1-e2e
    content: "Phase 1: 端到端文本消息打通（微信→Agent→微信）"
    status: completed
  - id: phase-2-adapter
    content: "Phase 2: WeChatILinkAdapter 接入 agx serve 网关"
    status: completed
  - id: phase-2-persist
    content: "Phase 2: 凭据持久化 + 自动恢复 + 续期"
    status: completed
  - id: phase-2-media
    content: "Phase 2: 图片/文件消息基础支持"
    status: completed
  - id: phase-2-badge
    content: "Phase 2: 绑定状态 Desktop 全局可见（badge/指示灯）"
    status: completed
  - id: phase-3-voice
    content: "Phase 3: 语音消息（SILK 编解码）"
    status: completed
  - id: phase-3-health
    content: "Phase 3: Sidecar 健康检查 + 自动重启"
    status: completed
  - id: phase-3-ci
    content: "Phase 3: CI 跨平台编译 + DMG 内嵌 sidecar"
    status: completed
isProject: true
---

# 个人微信（iLink）接入 Machi 桌面

> **研究产物**：`research/codedeepresearch/openilink-hub/` （源码笔记、差距分析、技术方案）
>
> **上游参考**：[openilink/openilink-hub](https://github.com/openilink/openilink-hub)（MIT，Go）
>
> **核心依赖**：[openilink-sdk-go](https://github.com/openilink/openilink-sdk-go)

## 产品目标

**一句话**：用户在 Machi 设置中扫码绑定个人微信，之后在微信对话中给 Machi 发消息，本机 Agent 自动执行并回复到微信。

**用户场景**：
- 手机微信发「帮我查一下今天的 git log 总结成日报」→ Machi 执行 → 结果发回微信
- 在微信里发一张截图 → Machi 识别内容 → 文字摘要回微信
- 手机发语音 → Machi 转文字 + 执行指令 → 结果回微信

## 整体架构

```
┌──────────────────────────────────────────────┐
│  Machi Desktop (Electron + React)            │
│  ┌────────────────────────────────────────┐  │
│  │  SettingsPanel → 微信集成 Tab           │  │
│  │  • QR 二维码渲染 + 扫码状态              │  │
│  │  • 已绑定: 微信号标识 + 连接状态灯        │  │
│  │  • 异常: session_expired 引导重绑        │  │
│  └───────────────────┬────────────────────┘  │
│                      │ IPC                    │
│  ┌───────────────────▼────────────────────┐  │
│  │  electron/main.ts                      │  │
│  │  startWechatSidecar() — 类飞书子进程    │  │
│  │  stopWechatSidecar()                   │  │
│  └───────────────────┬────────────────────┘  │
└──────────────────────┼────────────────────────┘
                       │ HTTP localhost:${port}
┌──────────────────────▼────────────────────────┐
│  agx-wechat-sidecar (Go binary)               │
│                                                │
│  POST /bind/start       → FetchQRCode          │
│  WS   /bind/{id}/ws     → PollQRStatus 轮询    │
│  GET  /status            → 连接状态 + bot_id     │
│  POST /send              → SendText/SendMedia   │
│  GET  /events            → SSE (Monitor 推消息)  │
│  POST /reconnect         → 恢复已有凭据          │
│  POST /unbind            → 停止 + 清除凭据       │
│                                                │
│  依赖: openilink-sdk-go                         │
│  凭据: ~/.agenticx/wechat_credentials.json      │
│  端口: ~/.agenticx/wechat_sidecar.port          │
└────────────────────┬───────────────────────────┘
                     │ iLink HTTP
                     ▼
              微信 iLink 服务器
```

## 需求规格

### FR-1: Go Sidecar (Phase 1)

- FR-1.1: 编译最小 Go 二进制，依赖 `openilink-sdk-go`
- FR-1.2: HTTP API：`/bind/start` 返回 `{session_id, qr_url}` (qr_url 为 base64 图片)
- FR-1.3: WebSocket `/bind/{session}/ws` 推送扫码状态：`wait` → `scanned` → `confirmed`
- FR-1.4: `confirmed` 时返回 credentials，持久化到 `~/.agenticx/wechat_credentials.json`
- FR-1.5: `/events` SSE 端点，消息格式 `{type: "message", sender, text, context_token, items[]}`
- FR-1.6: `/send` 接收 JSON `{text, context_token?, recipient?, file?}`
- FR-1.7: 启动时写端口到 `~/.agenticx/wechat_sidecar.port`
- FR-1.8: 启动时自动加载已有凭据，自动恢复 Monitor

**AC-1**: 使用 OpeniLink MockServer 可完成 QR 绑定 → 收消息 → 发回复全流程

### FR-2: Desktop 集成 (Phase 1)

- FR-2.1: `electron/main.ts` 新增 `startWechatSidecar()`/`stopWechatSidecar()`，生命周期同飞书
- FR-2.2: Sidecar 二进制路径：开发期 `packaging/wechat-sidecar/agx-wechat-sidecar`，打包期内嵌
- FR-2.3: IPC：`start-wechat-sidecar` / `stop-wechat-sidecar` / `wechat-bind-start` / `wechat-bind-status` / `wechat-send` / `load-wechat-config` / `save-wechat-config`
- FR-2.4: `SettingsPanel.tsx` 飞书集成 Panel 同级新增「微信」Tab（或将 Panel 改名为「IM 集成」含飞书 + 微信子 Tab）
- FR-2.5: 未绑定态：「绑定微信」按钮 → QR 二维码 → 状态文字
- FR-2.6: 已绑定态：微信号标识 + 连接状态灯 + 「解绑」按钮
- FR-2.7: session_expired 态：红色警告 + 重绑定引导

**AC-2**: 在设置面板点击绑定 → 显示 QR → 手机微信扫码 → 显示"已连接" → 微信发文字 → Machi 收到

### FR-3: Agent 网关适配 (Phase 2)

- FR-3.1: `agenticx/gateway/adapters/wechat_ilink.py` — `WeChatILinkAdapter`
- FR-3.2: 连接 sidecar SSE `/events`，将消息转为 `GatewayMessage` 送入 agent runtime
- FR-3.3: Agent 回复时调 sidecar `/send`
- FR-3.4: `config.yaml` 新增 `gateway.adapters.wechat_ilink` 配置节
- FR-3.5: 消息携带 `platform: "wechat_ilink"` + `context_token` 元数据

**AC-3**: 微信发 "你好" → agent 回复 "你好！有什么可以帮你的？" → 微信收到回复

### FR-4: 凭据与会话管理 (Phase 2)

- FR-4.1: 凭据加密存储（bot_token 敏感）
- FR-4.2: 24h 续期：sidecar 内置 timer，22h 时可选发保活消息
- FR-4.3: `session_expired` 回调 → Desktop 通知 + UI 状态变更
- FR-4.4: 重绑定时若 `ilink_user_id` 匹配则复用原有配置

### FR-5: 媒体消息 (Phase 2-3)

- FR-5.1: 图片：sidecar 下载解密 → 转存本地 → 路径传入 agent
- FR-5.2: 文件：同图片流程
- FR-5.3: 语音 (Phase 3)：SILK → WAV 解码 → 可选 STT → 文字传入 agent
- FR-5.4: 视频 (Phase 3)：下载 → 本地存储 → 路径传入

### NFR-1: 非功能需求

- NFR-1.1: Sidecar 内存 < 50MB idle
- NFR-1.2: 文本消息端到端延迟 < 3s
- NFR-1.3: Sidecar 崩溃后 Desktop 自动重启（max 3 次）
- NFR-1.4: QR 过期自动刷新（sidecar 侧处理，5 min TTL）
- NFR-1.5: 跨平台编译：macOS arm64/x64、Linux amd64、Windows amd64

## Phase 1 实施细节

### Task 1.1: Go Sidecar 骨架

**目录**: `packaging/wechat-sidecar/`

```
packaging/wechat-sidecar/
├── go.mod
├── go.sum
├── main.go           # HTTP server + CLI flags
├── bind.go           # /bind/start + /bind/{id}/ws
├── monitor.go        # iLink Monitor → SSE /events
├── send.go           # /send endpoint
├── credentials.go    # 凭据读写 + 加密
└── Makefile          # 编译脚本
```

**依赖**:
- `github.com/openilink/openilink-sdk-go`
- `github.com/gorilla/websocket`（QR 状态推送）
- 标准库 `net/http`、`encoding/json`

### Task 1.2: Desktop 子进程管理

**改动文件**: `desktop/electron/main.ts`, `desktop/electron/preload.ts`, `desktop/src/global.d.ts`

模式与飞书一致：
```typescript
let wechatProcess: ChildProcess | null = null;

function startWechatSidecar() {
  const binary = getWechatSidecarPath(); // dev vs packaged
  const port = findAvailablePort();
  wechatProcess = spawn(binary, ['--port', String(port)]);
  // write port to ~/.agenticx/wechat_sidecar.port
}
```

### Task 1.3: SettingsPanel 微信 Tab

**改动文件**: `desktop/src/components/SettingsPanel.tsx`

在「飞书集成」Panel 下方或改为统一「IM 集成」Panel，新增微信子 Tab：
- 绑定流程：调 IPC → sidecar → 渲染 QR → WebSocket 轮询状态
- 状态展示：复用飞书 badge 样式

## 测试策略

| 层级 | 方法 | 工具 |
|---|---|---|
| Sidecar 单元 | Go test | openilink MockServer |
| Desktop IPC | 手动 + Playwright | Electron dev 模式 |
| 端到端 | 微信真机 + MockServer | 手动验收 |
| CI | Sidecar 编译 + MockServer 冒烟 | GitHub Actions |

OpeniLink Hub 内置 `internal/provider/ilink/mockserver/`，可独立运行模拟 iLink 服务器，开发阶段无需真实微信。

## 与现有 plan 的关系

| 已有 Plan | 关系 |
|---|---|
| `2026-03-30-im-remote-command-gateway.plan.md` | 该 plan Phase 2 为企微 webhook 接入；本 plan 是个人微信（iLink）独立通道，互补不冲突 |
| `2026-03-24-dmg-self-contained-packaging.plan.md` | sidecar 二进制需纳入 DMG 打包流程 |
| `2026-03-24-desktop-remote-backend.plan.md` | 远程模式下 sidecar 需跑在远端（Phase 3+ 考虑） |
