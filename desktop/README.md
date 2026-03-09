# AgenticX Desktop macOS Alpha

## 环境要求

- Node.js 20+
- Python 3.10+
- 已安装 `agx` CLI（能在终端执行 `agx version`）
- macOS 13+（Windows/Linux 仅做基础兼容，未完整验证）

## 快速启动（开发）

```bash
cd desktop
npm install
npm run dev
```

启动后 Electron 主进程会自动拉起 `agx serve --host 127.0.0.1 --port <随机端口>`，渲染层通过 IPC 获取 API 基址，不需要手工再开一个终端。

## 打包

```bash
cd desktop
npm run build:mac
```

产物在 `desktop/release/`，包含 `.dmg` 和 `.zip`。  
如需 Windows/Linux：

```bash
npm run build:win
npm run build:linux
```

## 架构说明

```text
Electron Main
  ├─ 启动/停止 agx serve
  ├─ IPC: get-api-base / save-config / native-say
  └─ Tray + Native Menu

Renderer (React + Zustand)
  ├─ ChatView（主智能体对话流，SSE token 流式）
  ├─ SubAgentPanel（Agent Team 进度与事件）
  ├─ ConfirmDialog（按 agent_id 路由确认）
  └─ SettingsPanel（provider/model/apiKey）
```

## Meta-Agent + Agent Team

当前 Desktop 已支持“主智能体 + 子智能体团队”协作模型：

- 主聊天区只展示 `meta`（主智能体）消息，用户可持续对话，不被子任务阻塞。
- 右侧 `SubAgentPanel` 展示子智能体列表、状态（running/completed/failed/cancelled）与最近事件。
- SSE 事件带 `agent_id`，前端按来源路由到主对话或对应子智能体卡片。
- 子智能体卡片支持“中断”，会调用 `POST /api/subagent/cancel`。
- 确认弹窗会显示来源智能体，并在提交 `/api/confirm` 时携带 `agent_id`。

## 已知限制

- macOS 签名/公证暂未接入（开发版可运行，发行版建议后续补）
- STT 优先尝试 Whisper WASM，失败时回退到 Web Speech API
- `native say` 仅 macOS 使用，其他平台回退浏览器 TTS
- Playwright Electron E2E 为基础冒烟用例，暂未覆盖完整语音链路
