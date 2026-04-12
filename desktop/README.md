# Machi Desktop — macOS Alpha Preview

> **注意：当前为 Alpha 预览版，macOS 签名/公证尚未接入，首次打开需要手动放行（见下方说明）。**

## 安装步骤（用户版）

> **远程模式说明（可选）**：在 `~/.agenticx/config.yaml` 中配置 `remote_server` 并启用后，可连接远程 `agx serve`，无需本机安装 Python/agx。详见仓库内 `.cursor/plans/2026-03-24-desktop-remote-backend.plan.md`。

### Step 1 — 下载正确的安装包

| 机型 | 下载文件 |
|------|---------|
| Apple M1 / M2 / M3 / M4（ARM） | `Machi-x.x.x-arm64.dmg` |
| Intel Mac（2020 年前机型） | `Machi-x.x.x-x64.dmg` |

**如何判断我的 Mac 是哪种芯片？**  
点击左上角苹果菜单 → 关于本机，查看"芯片"一栏。

### Step 2 — 本地后端（二选一）

**方式 A — 官方 DMG 自包含版（推荐）**  

使用通过 `packaging/build_dmg.sh` 打出的安装包时，应用内已嵌入 `agx-server`（PyInstaller），**无需**再安装 Python 或 `agx` CLI。若你从源码目录执行 `npm run build:mac:*` 且未先放入 `bundled-backend/<arch>/agx-server`，则仍需要方式 B。

**方式 B — 自行安装 agx CLI**

若未使用自包含 DMG，Machi 需要 `agx` 命令行工具来运行本地 AI 服务。打开终端，运行：

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

### 图标规范化（保证 dev 与 DMG 一致）

使用同一母图导出 `icon.png`（Dock/dev）与 `icon.icns`（DMG/App），避免两套图标视觉尺寸不一致：

```bash
cd desktop
npm run icons:sync
# 或指定母图
bash ./scripts/sync-icons.sh assets/icon-master.png
```

建议母图为 `1024x1024` 的正方形 PNG，并控制主体留白一致（推荐主体占比 80%~85%）。

### 自包含 DMG（内嵌 Python 后端，用户无需安装 agx）

在仓库根目录执行（需 Python ≥3.10、Node 20；首次会创建 `packaging/.venv-packaging`）：

```bash
# Apple Silicon
./packaging/build_dmg.sh arm64

# Intel Mac（需在 x64 runner 或 Rosetta 环境构建 x64 后端）
./packaging/build_dmg.sh x64

# Universal：先分别构建 arm64 与 x64 后端，再 lipo 合并
./packaging/build_dmg.sh universal
```

跳过重新打包 Python、仅复用已有 `packaging/dist/<arch>/agx-server`：

```bash
SKIP_BACKEND=1 ./packaging/build_dmg.sh arm64
```

产物在 `desktop/release/` 下的 `.dmg` / `.zip`。

**可选：签名与公证**（分发给别人时建议配置）  
在构建环境中设置 `APPLE_ID`、`APPLE_ID_PASSWORD`（App 专用密码）、`APPLE_TEAM_ID`，以及 `CSC_LINK` / `CSC_KEY_PASSWORD`（Developer ID 证书）。未设置时脚本会跳过公证（`desktop/scripts/mac/notarize.js` 会打印 skip）。

### Windows 自包含 NSIS（内嵌 agx-server.exe + 微信 sidecar）

| 项目 | macOS | Windows（本方案） |
|------|--------|-------------------|
| 一体脚本 | `packaging/build_dmg.sh` | `packaging/build_windows_installer.ps1` |
| 预置目录 | `desktop/bundled-backend/<arch>/` | `desktop/bundled-backend/win-amd64/` |
| 产物 | `.dmg` | `Machi-<version>-win-x64.exe`（NSIS） |
| 本机要求 | bash、Python、Node、Go | **Windows**、PowerShell 7+（`pwsh`）、Python ≥3.10、Node 20、Go 1.22+；`curl.exe`（系统自带）用于冒烟 |

在**仓库根目录**打开 PowerShell：

```powershell
# 首次会创建 packaging\.venv-packaging 并执行 PyInstaller + Go + electron-builder
./packaging/build_windows_installer.ps1
```

或在 `desktop` 目录：

```powershell
cd desktop
npm run build:win:bundled
```

仅复用已构建的 `packaging\dist\win-amd64\agx-server.exe`、跳过 PyInstaller（仍会冒烟并重新打 sidecar 与安装包）：

```powershell
$env:SKIP_BACKEND = '1'
./packaging/build_windows_installer.ps1
```

**注意**：`electron-builder` 的 `win.extraResources` 指向 `bundled-backend/win-amd64`。若未先运行上述脚本就执行 `npm run build:win`，会因缺少该目录而打包失败——与 mac 侧未预置 `bundled-backend/<arch>` 时类似。

**CI**：推送 `v*` tag 或手动 `workflow_dispatch` 选择 `windows-amd64` 时，会运行同一脚本并上传 `Machi-*-win-x64.exe` 构件。Windows 代码签名未接入（与 mac 无证书构建一致）。

### 仅 Electron 壳（不含内嵌后端）

分架构单独打包（需本机已安装 `agx`）：

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
如需 Windows/Linux（**不含**内嵌后端，需本机已安装 `agx`）：

```bash
npm run build:win
npm run build:linux
```

Windows 若要内嵌后端，请使用上一节 `build:win:bundled` 或 `packaging/build_windows_installer.ps1`。

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
