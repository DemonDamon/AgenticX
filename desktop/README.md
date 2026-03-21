# Machi Desktop — macOS Alpha Preview

> **注意：当前为 Alpha 预览版，macOS 签名/公证尚未接入，首次打开需要手动放行（见下方说明）。**

## 安装步骤（用户版）

### Step 1 — 下载正确的安装包

| 机型 | 下载文件 |
|------|---------|
| Apple M1 / M2 / M3 / M4（ARM） | `Machi-x.x.x-arm64.dmg` |
| Intel Mac（2020 年前机型） | `Machi-x.x.x-x64.dmg` |

**如何判断我的 Mac 是哪种芯片？**  
点击左上角苹果菜单 → 关于本机，查看"芯片"一栏。

### Step 2 — 安装 agx CLI（首次使用必须）

Machi 需要 `agx` 命令行工具来运行本地 AI 服务。打开终端，运行：

```bash
curl -sSL https://raw.githubusercontent.com/agenticx/agenticx/main/install.sh | bash
```

或通过 pip 安装：

```bash
pip install agenticx
```

安装后验证：

```bash
agx --version
```

### Step 3 — 绕过 macOS Gatekeeper（Alpha 版无签名）

由于当前版本未经过 Apple 签名公证，macOS 默认会阻止打开。有两种方式放行：

**方式 A（推荐，图形化）：**

1. 双击 `.dmg` 将 Machi.app 拖入 Applications
2. 在 Finder 里找到 Machi.app，**右键 → 打开**
3. 在弹窗中点击"打开"确认（只需第一次）

**方式 B（终端命令）：**

```bash
xattr -cr /Applications/Machi.app
```

### Step 4 — 启动 Machi

双击 Machi.app，等待约 5-15 秒完成初始化即可使用。

---

## 环境要求（开发者）

- Node.js 20+
- Python 3.10+
- 已安装 `agx` CLI（`agx --version` 可正常执行）
- macOS 13+（Windows/Linux 仅做基础兼容，未完整验证）

## 快速启动（开发）

```bash
cd desktop
npm install
npm run dev
```

启动后 Electron 主进程会自动拉起 `agx serve --host 127.0.0.1 --port <随机端口>`，渲染层通过 IPC 获取 API 基址，不需要手工再开一个终端。

## 打包

分架构单独打包（推荐）：

```bash
cd desktop
npm run build:mac:arm64   # M 系列芯片 → Machi-x.x.x-arm64.dmg
npm run build:mac:x64     # Intel 芯片  → Machi-x.x.x-x64.dmg
```

或同时打出两个包：

```bash
npm run build:mac:all
```

产物均在 `desktop/release/`。  
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
