---
name: Desktop 连接远程后端
overview: 让 Machi Desktop 支持连接云主机上的 agx serve 后端，无需在用户本机安装 Python/agenticx
todos: []
isProject: false
---

# Desktop 连接远程后端实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Machi (Desktop) 支持两种运行模式——"本地模式"（现有行为不变）和"远程模式"（连接云主机上的 `agx serve`），用户无需在本机安装 Python / agenticx 即可使用 Desktop 客户端。

**Architecture:** 在 `~/.agenticx/config.yaml` 新增 `remote_server` 配置节；`main.ts` 启动流程根据配置分支：远程模式跳过本地 CLI 检测和进程 spawn，直接连远程后端；服务端 CORS 放行 Desktop Electron origin；设置面板新增"服务器连接"配置区。

**Tech Stack:** TypeScript (Electron main process), React + Zustand (Desktop renderer), Python/FastAPI (server-side CORS)

**现有代码关键点：**

- `desktop/electron/main.ts`：
  - L201: `apiToken = crypto.randomBytes(16).toString("hex")` — 启动时随机生成 token
  - L315-333: `checkAgxCli()` — 强制检查本地 `agx` CLI，找不到则弹框退出
  - L335-366: `startStudioServe()` — spawn 本地 `agx serve --host 127.0.0.1`
  - L368-452: `waitServeReady()` — 轮询本地端口直到后端 ready
  - L553: `get-api-base` IPC → 固定返回 `http://127.0.0.1:<port>`
  - L554: `get-api-auth-token` IPC → 返回随机 token
  - L1409-1462: `app.whenReady()` → 串行 `checkAgxCli → startStudioServe → waitServeReady → createWindow`
- `desktop/electron/preload.ts`：
  - L3-22: `desktopApiFetch()` — 通过 IPC 获取 base URL + token，前端所有请求统一走此函数
  - 前端代码**不需要改**，改 main 侧 IPC 返回值即可
- `agenticx/studio/server.py`：
  - L82: CORS `allow_origins` 硬编码 `["http://localhost:5173", "http://127.0.0.1:5173", "null"]`
  - L93: `desktop_token = os.getenv("AGX_DESKTOP_TOKEN", "")` — 从环境变量读 token
  - L206-216: `_check_token()` — 空 token 时跳过校验，否则严格匹配
- `agenticx/cli/main.py`：
  - L534-552: `serve` 命令 — `--host`/`--port`/`--reload` 参数

---

## Phase 1: config.yaml 扩展 + 类型定义

### Task 1.1: 扩展 AgxConfig 类型，新增 remote_server 配置

**Files:**

- Modify: `desktop/electron/main.ts` (类型定义 + 读取逻辑)

**Requirements:**

- FR-1.1: 在 `AgxConfig` TypeScript 类型中新增 `remote_server` 可选字段
- FR-1.2: 支持以下配置结构：

```yaml
  remote_server:
    enabled: false          # 是否启用远程模式
    url: ""                 # 远程后端 URL，如 https://cloud.example.com:8080
    token: ""               # 认证 token，需与服务端 AGX_DESKTOP_TOKEN 一致
  

```

- FR-1.3: 新增 `loadRemoteConfig()` 辅助函数从 config 读取并校验远程配置
- AC-1: `loadRemoteConfig()` 在 `remote_server` 不存在或 `enabled: false` 时返回 `null`
- AC-2: `remote_server.url` 为空时视为未启用，不报错
- AC-3: 不改动现有任何 `AgxConfig` 字段的行为

**Step 1: 扩展类型定义**

在 `desktop/electron/main.ts` 的 `AgxConfig` 类型中加入：

```typescript
type RemoteServerConfig = {
  enabled?: boolean;
  url?: string;
  token?: string;
};

// AgxConfig 新增字段
remote_server?: RemoteServerConfig;
```

**Step 2: 新增 loadRemoteConfig 函数**

```typescript
type ResolvedRemoteConfig = {
  url: string;   // 已去尾斜杠
  token: string;
};

function loadRemoteConfig(): ResolvedRemoteConfig | null {
  const cfg = loadAgxConfig();
  const rs = cfg.remote_server;
  if (!rs?.enabled) return null;
  const url = (rs.url || "").trim().replace(/\/+$/, "");
  if (!url) return null;
  return { url, token: (rs.token || "").trim() };
}
```

---

## Phase 2: 改造 Electron 启动流程

### Task 2.1: 启动分支——远程模式跳过本地 CLI + spawn

**Files:**

- Modify: `desktop/electron/main.ts` (启动流程)

**Requirements:**

- FR-2.1: `app.whenReady()` 中先调用 `loadRemoteConfig()`，非 null 时进入远程模式
- FR-2.2: 远程模式下**跳过** `checkAgxCli()` 和 `startStudioServe()`
- FR-2.3: 远程模式下执行 `pingRemoteServer(config)` 替代 `waitServeReady()`，确认远程后端可达
- FR-2.4: ping 失败时弹对话框提示"无法连接远程服务器"，提供重试/退出选项
- FR-2.5: 本地模式完全不变（zero regression）
- AC-1: 远程模式下 `serveProcess` 始终为 null，`app.on("before-quit")` 中 `stopStudioServe()` 不会 crash
- AC-2: 远程模式下 `apiPort` 变量不再使用

**Step 1: 新增 pingRemoteServer**

```typescript
async function pingRemoteServer(config: ResolvedRemoteConfig, timeoutMs = 10000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${config.url}/api/session`, {
      headers: { "x-agx-desktop-token": config.token },
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
```

**Step 2: 改造 app.whenReady()**

```typescript
// 模块级变量
let remoteConfig: ResolvedRemoteConfig | null = null;

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));
    // ... dock icon setup (不变) ...

    remoteConfig = loadRemoteConfig();

    if (remoteConfig) {
      // ── 远程模式 ──
      const ok = await pingRemoteServer(remoteConfig);
      if (!ok) {
        const { response } = await dialog.showMessageBox({
          type: "warning",
          title: "无法连接远程服务器",
          message: `无法连接到 ${remoteConfig.url}`,
          detail: "请检查：\n1. 云主机上 agx serve 是否已启动\n2. URL 和端口是否正确\n3. 防火墙是否放行\n4. Token 是否匹配",
          buttons: ["重试", "退出"],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 0) {
          // 重试一次
          const retryOk = await pingRemoteServer(remoteConfig);
          if (!retryOk) {
            app.quit();
            return;
          }
        } else {
          app.quit();
          return;
        }
      }
    } else {
      // ── 本地模式（现有逻辑不变）──
      const agxOk = await checkAgxCli();
      if (!agxOk) {
        // ... 现有的弹框退出逻辑 ...
      }
      await startStudioServe();
      await waitServeReady();
    }

    registerIpc();
    createWindow();
    createTray();
  } catch (error) {
    // ... 现有的错误处理 ...
  }
});
```

### Task 2.2: 改造 IPC handler——根据模式返回不同的 base URL 和 token

**Files:**

- Modify: `desktop/electron/main.ts` (`registerIpc` 函数)

**Requirements:**

- FR-2.6: `get-api-base` IPC 远程模式返回 `remoteConfig.url`，本地模式返回 `http://127.0.0.1:<port>`
- FR-2.7: `get-api-auth-token` IPC 远程模式返回 `remoteConfig.token`，本地模式返回随机 token
- FR-2.8: `registerIpc()` 内所有直接用 `apiPort`/`apiToken` 构造 URL 的 IPC handler（约 20+ 个）同样走分支
- AC-1: `preload.ts` 和前端 React 代码**零改动**

**Step 1: 抽取 getStudioUrl / getStudioToken 辅助函数**

```typescript
function getStudioUrl(): string {
  return remoteConfig ? remoteConfig.url : `http://127.0.0.1:${apiPort}`;
}

function getStudioToken(): string {
  return remoteConfig ? remoteConfig.token : apiToken;
}
```

**Step 2: 替换 registerIpc 中所有硬编码**

将 `registerIpc()` 中所有的：

- ``http://127.0.0.1:${String(apiPort)}`` → `getStudioUrl()`
- `apiToken` → `getStudioToken()`

涉及的 IPC handler（逐个替换，不遗漏）：

- `get-api-base`
- `get-api-auth-token`
- `list-avatars`
- `create-avatar`
- `update-avatar`
- `delete-avatar`
- `list-sessions`
- `create-session`
- `rename-session`
- `delete-session`
- `delete-sessions-batch`
- `pin-session`
- `fork-session`
- `archive-sessions`
- `load-session-messages`
- `fork-avatar`
- `generate-avatar`
- `list-groups` / `create-group` / `update-group` / `delete-group`
- `load-config` / `load-email-config` / `load-mcp-status`
- `import-mcp-config` / `connect-mcp`
- `save-*` 系列
- `validate-key` / `fetch-models` / `health-check-model`
- `load-skills` / `load-skill-detail` / `refresh-skills`
- `load-bundles` / `install-bundle` / `uninstall-bundle`
- `search-registry` / `install-from-registry`

---

## Phase 3: 服务端 CORS 放行

### Task 3.1: server.py CORS 支持 Desktop Electron 远程连接

**Files:**

- Modify: `agenticx/studio/server.py`

**Requirements:**

- FR-3.1: CORS `allow_origins` 追加 `"app://"` 和 `"file://"` 以支持 Electron 打包后的 origin
- FR-3.2: 支持环境变量 `AGX_CORS_ORIGINS` 自定义额外 origins（逗号分隔）
- FR-3.3: 当 `AGX_DESKTOP_TOKEN` 非空时，仅放行携带正确 token 的请求（已有逻辑，不改）
- AC-1: 不改动 `_check_token` 逻辑
- AC-2: 本地开发 CORS（`localhost:5173`、`127.0.0.1:5173`）继续保留

**Step 1: 修改 CORS 配置**

```python
# server.py create_studio_app() 内
default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "null",
    "app://.",           # Electron packaged (custom protocol)
    "file://",           # Electron loadFile
]
extra = os.getenv("AGX_CORS_ORIGINS", "").strip()
if extra:
    default_origins.extend([o.strip() for o in extra.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=default_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Phase 4: agx serve 云部署增强

### Task 4.1: serve 命令新增 --token 参数

**Files:**

- Modify: `agenticx/cli/main.py` (`serve` 命令)

**Requirements:**

- FR-4.1: `agx serve` 新增 `--token` 可选参数，设置后自动写入 `AGX_DESKTOP_TOKEN` 环境变量
- FR-4.2: 不传 `--token` 时行为不变（可通过环境变量设置）
- FR-4.3: 启动时打印 token 提示（便于运维人员复制给客户配置 Desktop）
- AC-1: `--token` 和环境变量 `AGX_DESKTOP_TOKEN` 同时设置时，`--token` 优先

**Step 1: 修改 serve 函数签名**

```python
@app.command()
def serve(
    port: int = typer.Option(8000, "--port", "-p", help="监听端口"),
    host: str = typer.Option("0.0.0.0", "--host", help="监听地址"),
    reload: bool = typer.Option(False, "--reload", help="开发模式热重载"),
    token: str = typer.Option("", "--token", "-t", help="Desktop 认证 token"),
):
    """启动 Studio FastAPI 服务（SSE 事件流）"""
    _suppress_macos_dock_icon()
    try:
        from agenticx.studio.server import create_studio_app
        import uvicorn
    except ImportError as e:
        console.print(f"[bold red]错误:[/bold red] 缺少依赖: {e}")
        raise typer.Exit(1)

    if token:
        os.environ["AGX_DESKTOP_TOKEN"] = token

    effective_token = os.environ.get("AGX_DESKTOP_TOKEN", "").strip()
    app_inst = create_studio_app()
    console.print(f"[bold green]AgenticX Studio Server[/bold green] http://{host}:{port}")
    if effective_token:
        console.print(f"  Token: {effective_token[:8]}{'*' * (len(effective_token) - 8)}")
    else:
        console.print("  [yellow]Warning: no token set, API is unauthenticated[/yellow]")
    uvicorn.run(app_inst, host=host, port=port, reload=reload)
```

---

## Phase 5: Desktop 设置面板——"服务器连接"配置 UI

### Task 5.1: 新增"服务器连接"设置 Tab

**Files:**

- Identify: Desktop 设置面板组件（需先探索 `desktop/src/` 找到设置面板）
- Modify: 设置面板，新增 "Server / 服务器" tab

**Requirements:**

- FR-5.1: 设置面板新增"服务器连接"分区，包含：
  - 模式切换开关：本地 / 远程
  - 远程 URL 输入框（placeholder: `https://your-server:8080`）
  - 远程 Token 输入框（密码类型，可切换显隐）
  - "测试连接"按钮（调用 `pingRemoteServer` 逻辑）
  - 连接状态指示（成功/失败/未测试）
- FR-5.2: 保存时写入 `~/.agenticx/config.yaml` 的 `remote_server` 节
- FR-5.3: 切换模式后提示"需要重启 Machi 生效"
- AC-1: 现有设置 tab（Provider、MCP、Email 等）不受影响
- AC-2: 本地模式下远程配置区域灰显不可编辑

**Step 1: 新增 IPC handler**

在 `main.ts` 的 `registerIpc()` 中添加：

- `save-remote-server`: 将远程配置写入 config.yaml
- `test-remote-server`: ping 远程 URL 返回连通性结果

```typescript
ipcMain.handle("save-remote-server", async (_event, payload: {
  enabled: boolean;
  url: string;
  token: string;
}) => {
  const cfg = loadAgxConfig();
  cfg.remote_server = {
    enabled: payload.enabled,
    url: (payload.url || "").trim().replace(/\/+$/, ""),
    token: (payload.token || "").trim(),
  };
  saveAgxConfig(cfg);
  return { ok: true, restart_required: true };
});

ipcMain.handle("test-remote-server", async (_event, payload: {
  url: string;
  token: string;
}) => {
  const url = (payload.url || "").trim().replace(/\/+$/, "");
  if (!url) return { ok: false, error: "URL is required" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${url}/api/session`, {
      headers: { "x-agx-desktop-token": (payload.token || "").trim() },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
```

**Step 2: preload.ts 暴露新 API**

```typescript
saveRemoteServer: async (payload: { enabled: boolean; url: string; token: string }) =>
  ipcRenderer.invoke("save-remote-server", payload),
testRemoteServer: async (payload: { url: string; token: string }) =>
  ipcRenderer.invoke("test-remote-server", payload),
```

**Step 3: 在设置面板中新增 UI**

（具体组件位置需执行时探索 `desktop/src/` 目录结构确定）

---

## Phase 6: 远程模式下的功能降级处理

### Task 6.1: 标识并降级 Electron-only 功能

**Files:**

- Modify: `desktop/electron/main.ts`
- Modify: 前端相关组件（如有需要）

**Requirements:**

- FR-6.1: `choose-directory` IPC 在远程模式下返回错误提示，前端显示"远程模式不支持本地目录选择"
- FR-6.2: 新增 `get-connection-mode` IPC 返回当前模式（`"local"` | `"remote"`），供前端按需隐藏/禁用功能
- FR-6.3: 远程模式下 config 相关的 save-* IPC（如 `save-provider`、`save-email-config`）应转发到远程服务器而非写本地文件
- AC-1: 聊天、会话管理、分身、群聊等核心功能在远程模式下完全正常（这些已经通过 HTTP API 走的）
- AC-2: 不影响本地模式任何功能

**Step 1: 新增 connection-mode IPC**

```typescript
ipcMain.handle("get-connection-mode", async () =>
  remoteConfig ? "remote" : "local"
);
```

**Step 2: choose-directory 降级**

```typescript
ipcMain.handle("choose-directory", async () => {
  if (remoteConfig) {
    return { ok: false, error: "远程模式不支持本地目录选择" };
  }
  // ... 现有 dialog.showOpenDialog 逻辑 ...
});
```

**Step 3: config save 系列转发**

远程模式下 `save-provider` 等操作需要通过 HTTP API 转发到远程服务端。这要求服务端新增对应的 config 管理 API（当前 server.py 没有）。

> **决策点：** 初期可以简化——远程模式下 Provider/Email 配置由运维人员在服务端 config.yaml 管理，Desktop 只读展示。后续迭代再加 HTTP config API。

---

## Phase 7: 文档 + 部署指南

### Task 7.1: 编写云部署 + Desktop 远程连接文档

**Files:**

- Create: `docs/deployment/cloud-server-setup.md`

**Requirements:**

- FR-7.1: 文档覆盖：
  1. 云主机环境要求（OS、Python、内存）
  2. `pip install agenticx` + `agx serve` 部署步骤
  3. Token 设置与安全建议（HTTPS + 防火墙）
  4. Nginx 反向代理配置示例
  5. Desktop 端远程配置步骤（config.yaml 或设置面板）
  6. 故障排查清单

---

## 实施优先级与依赖

```
Phase 1 (类型 + 读取) ─┐
                        ├── Phase 2 (启动流程 + IPC) ── Phase 5 (设置 UI)
Phase 3 (CORS)  ────────┤
Phase 4 (serve --token) ┘                               │
                                                         └── Phase 6 (降级处理)
                                                         └── Phase 7 (文档)
```

**最小可用版本（MVP）= Phase 1 + 2 + 3 + 4**，预计 2-3 小时完成。
Phase 5-7 为完善体验，可后续迭代。

---

## 风险与注意事项


| 风险              | 缓解措施                                           |
| --------------- | ---------------------------------------------- |
| HTTPS 证书 / 混合内容 | Electron BrowserWindow 默认允许混合内容；建议生产环境用 HTTPS  |
| Token 明文存储      | config.yaml 权限 600；后续可加密存储                     |
| 网络延迟影响 SSE 流式   | SSE 本身支持断线重连；Desktop 已有 EventSource 处理         |
| 远程 MCP 管理       | MCP 在服务端管理，Desktop 远程模式下 MCP 设置面板为只读           |
| 文件上传 / 附件       | 需要走 HTTP multipart 上传到远端，当前 Desktop 有文件附加功能需验证 |


