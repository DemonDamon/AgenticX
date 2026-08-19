# Desktop Local Backend Startup Critical-Path Hardening Plan

Planned-with: GPT-5
Suggested-Impl-Model: GPT-5 Codex

> **实施交接说明：** 本计划面向未参与本次排查的实施者。请按任务顺序先补回归测试，再修改启动链路。不得用“单纯延长超时时间”替代启动关键路径治理。

## 目标

彻底消除 Desktop 本地后端在 Windows 等网络受限环境下偶发 `agx serve startup timeout` 的共性问题，使本地服务满足以下启动不变量：

1. 从子进程创建到 readiness 成功之间，启动关键路径不等待、不依赖任何公网请求；断网、DNS 污染、企业代理或无法访问代码托管站点都不能改变 readiness 结果。LiteLLM model cost map 在该阶段不得发起公网请求。
2. Desktop 只以一个无副作用的 HTTP readiness 接口作为“服务可用”依据，不再依赖日志文本，也不再通过会创建会话的 `/api/session` 探活。
3. MCP 恢复、IM 适配器、LongRun、Supervisor 等可选能力不得无限阻塞 FastAPI lifespan；失败或超时只能降级对应能力，不能拖死核心服务。
4. Windows 冷启动较慢时继续在启动页等待；真正失败时给出准确的阶段与可理解的重试入口，不再把所有超时误报为“请检查 agx 是否可用”。
5. Windows 安装包构建必须在“远程模型元数据地址不可达”的条件下完成真实 `agx-server.exe` 启动冒烟验证。

## 推荐实施模型拆分

| 子任务 | 推荐模型 | 原因 |
|---|---|---|
| LiteLLM 离线启动约束与 Python 回归测试 | Composer 2.5 Fast | 改动集中、验收断言明确 |
| FastAPI readiness 与 lifespan 边界 | GPT-5 Codex | 涉及异步生命周期、任务取消和副作用边界 |
| Electron readiness 状态机与错误分类 | GPT-5 Codex | 涉及 ChildProcess、计时器、HTTP 探针和竞态收口 |
| Windows 打包冒烟与最终跨栈验收 | GPT-5 Codex | 需要同时核对 PyInstaller、Electron 和 Windows 行为 |

## 根因与证据链

### 现场证据

故障日志同时出现：

```text
LiteLLM: Failed to fetch remote model cost map from
https://raw.githubusercontent.com/.../model_prices_and_context_window.json
The read operation timed out. Falling back to local backup.

INFO: Started server process [...]
INFO: Waiting for application startup.

GlobalMcpManager: skipping quarantined MCP server(s) on restore: [...]

Error: agx serve startup timeout
```

多次重新启动后可能成功。该现象排除了“agx 永久缺失”这一主因，更符合启动阶段外网超时、可选启动任务耗时和 Desktop readiness 竞态叠加。

### 代码证据

1. `agenticx/llms/litellm_provider.py` 在模块顶层执行 `import litellm`。
2. LiteLLM 在自身 `__init__` 中同步读取远程 model cost map；远程失败虽然会回退本地备份，但网络等待已经进入进程冷启动预算。
3. `agenticx/studio/server.py` 顶层导入 `ProviderResolver`，后者顶层导入 `LiteLLMProvider`，因此模型价格元数据请求发生在 Studio 可监听端口之前。
4. `agenticx/cli/main.py` 在模块装载阶段注册多个子命令，其中配置模块也会导入 `ProviderResolver`；因此仅在 `serve()` 函数内部设置环境变量已经太晚。
5. `desktop/electron/main.ts` 的 `startStudioServe()` 未设置 `LITELLM_LOCAL_MODEL_COST_MAP=true`。
6. `waitServeReady()` 使用固定 45 秒总超时，并每 500ms 调用 `/api/session`；单次 `fetch` 没有独立超时，`setInterval` 还可能产生重叠探针。
7. `/api/session` 的语义是“获取或创建会话”，探活会触发 workspace 初始化、会话创建和持久化副作用，不适合作为 readiness。
8. `waitServeReady()` 把 `AgenticX Studio Server` 或 `Uvicorn running` 日志文本视为成功；前者在 `uvicorn.run()` 之前输出，不能证明 lifespan 已完成。
9. 当前 MCP restore 已通过 `GlobalMcpManager.schedule_restore()` 放到后台，并且 quarantine 日志表示主动跳过历史失败项；该日志本身不是启动失败。实施时必须保留这一非阻塞语义并加固回归测试。
10. `_studio_lifespan()` 仍直接 `await` WeChat、LongRun 和 Supervisor 启动函数。当前实现通常很快，但缺少统一预算，未来或旧包中的任一可选启动函数都可能令 Uvicorn 长期停留在 `Waiting for application startup`。

### 当前误判路径

```mermaid
flowchart LR
  A["Desktop 创建 agx 子进程"] --> B["导入 LiteLLM"]
  B --> C["同步访问远程 model cost map"]
  C --> D["创建 FastAPI app"]
  D --> E["等待 lifespan 可选组件"]
  E --> F["Desktop 轮询 /api/session"]
  F --> G["45 秒总闸门"]
  G --> H["统一误报：检查 agx 是否可用"]
```

### 目标路径

```mermaid
flowchart LR
  A["Desktop 创建 agx 子进程"] --> B["强制使用随包本地 model cost map"]
  B --> C["仅执行本地核心初始化"]
  C --> D["可选组件有界启动或后台恢复"]
  D --> E["GET /api/health/ready 返回 200"]
  E --> F["Desktop 标记本地服务 ready"]
```

## 架构决策

### AD-1：客户端运行时不刷新远程价格表

本计划不把远程 model cost map 请求简单延后几秒，而是将其移出 Desktop/`agx serve` 的客户端运行时：

- 每个进程使用 LiteLLM 随 Python 包发布的本地备份。
- 模型价格与上下文元数据的新鲜度跟随 LiteLLM 依赖升级和应用发版更新。
- 新模型不在快照中时允许费用未知或沿用配置值；不得因此影响 Studio 启动，现有 provider 路由与 unknown-model 行为保持不变。
- 不在本计划中增加运行中热替换 `litellm.model_cost`，避免并发请求期间修改全局字典以及依赖 LiteLLM 私有 API。

如果未来产品明确需要小时级价格更新，应另做“服务 ready 后下载、校验、原子缓存、下次进程使用”的独立方案；该任务仍不得恢复启动期公网依赖。

### AD-2：readiness 必须无副作用

新增受 Desktop token 保护的 `GET /api/health/ready`。该接口只返回进程就绪信息，不创建会话、不访问模型、不连接 MCP、不写文件。

HTTP 200 且 JSON 同时满足 `ok === true`、`status === "ready"` 才算服务 ready。日志文本仅用于诊断，不参与成功判定。

### AD-3：本地探针绕过所有代理

Electron 本地 readiness 使用 Node `http.request()` 直连 `127.0.0.1`，不使用可能受代理配置影响的通用 `fetch`。每个探针有独立超时，探针串行执行，任何时刻最多一个请求在飞。

### AD-4：总超时是兜底，不是主修复

默认预算：

- Windows 发布包：90 秒；用于容纳首次解包、杀毒扫描和低性能磁盘。
- 其他本地模式：60 秒。
- 单次 readiness 探针：1.5 秒。
- 30 秒尚未 ready 时进入 `backend-slow` 启动页阶段，但继续等待，不弹窗、不重启子进程。

不得因为提高总超时而保留任何启动期公网请求。

## In Scope

- Desktop 本地后端在 Windows、macOS、Linux 上的启动关键路径。
- 直接执行 `agx serve` 与 PyInstaller `agx-server(.exe)` 的离线启动行为。
- LiteLLM 本地 model cost map 启动策略。
- FastAPI readiness endpoint。
- Electron 本地 readiness 探针、状态机、日志清理、错误分类与应用内重试。
- Studio lifespan 中可选启动步骤的超时与阶段日志。
- Windows 安装包离线启动冒烟测试。

## Out of Scope

- 不改变任何模型供应商请求、流式响应、重试或 fallback 语义。
- 不修改费用计算公式、历史 usage 数据或账单展示。
- 不修改 MCP quarantine 阈值、MCP 自动连接名单或用户配置。
- 不修改远程服务器模式的协议与兼容行为；本计划新增的 readiness 先用于本地后端。
- 不增加 Desktop 设置项或要求普通用户配置环境变量。
- 不做全局残留进程扫描或模糊匹配后强杀其他 `agx` 进程。
- 不实现客户端运行时的远程 model cost map 热更新。

## 文件落点

### 新增

- `desktop/electron/backend-startup.ts`
  - 本地 readiness HTTP 探针、等待状态机、超时解析、错误证据和日志清理。
- `desktop/tests/backend-startup.test.ts`
  - Electron 后端启动状态机的确定性单元测试。
- `tests/test_litellm_offline_startup.py`
  - 隔离子进程验证 AgenticX/Studio 导入不访问公网。
- `tests/test_studio_readiness.py`
  - readiness 无副作用、token 校验与 lifespan 非阻塞回归测试。

### 修改

- `agenticx/__init__.py`
  - 在任何 AgenticX LLM 模块导入前设置离线优先默认值。
- `agenticx/llms/litellm_provider.py`
  - 在 `import litellm` 前增加防御性默认值，保证独立导入路径同样离线。
- `packaging/pyinstaller/agx_serve_entry.py`
  - 发布版后端入口无条件强制本地 model cost map，并检查随包备份可读。
- `agenticx/studio/server.py`
  - 新增 readiness endpoint；给可选 lifespan 步骤增加预算和阶段日志。
- `agenticx/runtime/global_mcp_manager.py`
  - 保持 restore fire-and-forget，并在关闭时取消尚未完成的 restore task。
- `desktop/electron/main.ts`
  - 注入离线启动环境；接入新的 readiness helper；修正启动错误文案并支持应用内重试。
- `desktop/electron/splash.ts`
  - 增加 `backend-slow` stage 类型。
- `desktop/electron/splash-preload.ts`
  - 同步 `backend-slow` stage 类型。
- `desktop/electron/splash.html`
  - 增加“首次启动较慢，仍在初始化本地引擎…”文案。
- `desktop/package.json`
  - 增加聚焦的 `test:backend-startup` 脚本。
- `packaging/build_windows_installer.ps1`
  - 使用 readiness endpoint 做离线冷启动 smoke，并输出启动耗时。
- `tests/test_smoke_mcp_crash_guard_lifespan.py`
  - 保留 crash guard 先于 MCP restore 的断言，并补充 restore 不阻塞 readiness 的断言；若新文件已覆盖，可仅保留原测试不重复堆叠。

## 功能需求与验收标准

### FR-1：任何 AgenticX/Studio 启动入口默认使用本地 LiteLLM 元数据

#### 实施锚点 A：`agenticx/__init__.py`

位置：文件最顶部，`import sys as _sys` 附近，且必须位于 `.core`、`.llms` 等导出之前。

Before：

```python
import sys as _sys
from pathlib import Path as _Path
```

After 意图：

```python
import os as _os
import sys as _sys
from pathlib import Path as _Path

# Importing AgenticX must never make an outbound metadata request by default.
_os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "true")
```

这里使用 `setdefault`，允许高级库使用者在启动 Python 进程前显式选择其他行为；Desktop 发布包不得依赖该可覆盖默认值，见锚点 C/D。

#### 实施锚点 B：`agenticx/llms/litellm_provider.py`

位置：当前第 1～3 行、`import litellm` 之前。

After 意图：

```python
import os

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "true")
import litellm  # type: ignore  # noqa: E402
```

该防御层用于保护测试、动态加载或未来绕开 `agenticx.__init__` 的导入方式。

#### 实施锚点 C：`packaging/pyinstaller/agx_serve_entry.py`

位置：标准库 import 之后、任何 `agenticx.*` import 之前，与现有 `AGX_LOCAL_KNOWLEDGE_ENABLED` 设置相邻。

```python
# Packaged Studio startup is offline-first; model metadata is bundled.
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "true"
```

发布版入口必须覆盖外部进程环境中错误设置的 `false`，保证安装包行为稳定。

#### 实施锚点 D：`desktop/electron/main.ts`

位置：`startStudioServe()` 内构造子进程 `env` 的对象。

```ts
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: augmentedPath,
  LITELLM_LOCAL_MODEL_COST_MAP: "true",
  // existing AGX_* values...
};
```

#### 验收标准

- 清除调用进程中的 `LITELLM_LOCAL_MODEL_COST_MAP` 后，导入 `agenticx`、`agenticx.cli.main` 或 `agenticx.studio.server` 均不调用 `httpx.get()` 获取 model cost map。
- 设置不可达的 `LITELLM_MODEL_COST_MAP_URL` 后，`agx serve` 和 `agx-server.exe` 的启动耗时不受该 URL 影响。
- 日志中不再出现启动期 `Failed to fetch remote model cost map`。
- LiteLLM provider 的普通 completion/stream 测试保持通过。
- 关闭远程元数据刷新不得新增模型请求拒绝路径；本地快照缺项时沿用当前 provider 对 unknown model 的既有行为，Studio readiness 不受影响。

### FR-2：PyInstaller 包必须包含可用的 LiteLLM 本地备份

#### 实施锚点：`packaging/pyinstaller/agx_serve_entry.py::_check_desktop_runtime()`

在现有 `numpy`、PDF 和可选 `socksio` 检查后增加：

```python
from importlib.resources import files

raw = files("litellm").joinpath(
    "model_prices_and_context_window_backup.json"
).read_text(encoding="utf-8")
payload = json.loads(raw)
if not isinstance(payload, dict) or len(payload) < 50:
    missing.append("litellm local model cost map is missing or invalid")
```

不要硬编码外部绝对路径，不要在检查中访问网络。

#### 验收标准

- `agx-server.exe --check-desktop-runtime` 在正常包中退出 0。
- 删除或漏打该 data file 的测试构建必须在打包 smoke 阶段失败，而不是交给客户启动时发现。
- `packaging/pyinstaller/agx_serve.spec` 现有 `collect_data_files("litellm")` 必须保留；只有测试证明当前收集规则不足时才调整 spec。

### FR-3：新增无副作用的 Studio readiness endpoint

#### 实施锚点：`agenticx/studio/server.py::create_studio_app()`

位置：内部 `_check_token()` 定义之后、业务路由之前。

```python
@app.get("/api/health/ready")
async def studio_ready(
    x_agx_desktop_token: str | None = Header(default=None),
) -> dict[str, Any]:
    _check_token(x_agx_desktop_token)
    return {
        "ok": True,
        "status": "ready",
        "pid": os.getpid(),
    }
```

禁止在该处理器中调用 `ensure_workspace()`、`manager.create()`、ProviderResolver、MCP connect 或任何外部服务。

#### 验收标准

- lifespan 完成后，正确 token 返回 HTTP 200 和准确 JSON。
- 配置 Desktop token 时，缺失/错误 token 返回现有的 HTTP 401。
- 连续调用 10 次不改变 `SessionManager` 的会话数量，不创建 session 目录或消息文件。
- readiness 端点不需要配置模型、API Key、MCP 或 IM 绑定。
- `/api/session` 业务语义保持不变，但不再被 Desktop 本地启动探针调用。

### FR-4：可选 lifespan 步骤必须有预算、可降级、可定位

#### 实施锚点：`agenticx/studio/server.py::_studio_lifespan()`

在 `create_studio_app()` 内增加局部 helper，统一记录 `begin/end/timeout/error` 和耗时：

```python
async def _run_optional_startup(
    name: str,
    awaitable: Any,
    *,
    timeout_s: float,
) -> Any | None:
    started = time.monotonic()
    app.state.startup_phase = name
    logger.info("studio_startup phase=%s state=begin", name)
    try:
        result = await asyncio.wait_for(awaitable, timeout=timeout_s)
    except asyncio.TimeoutError:
        logger.warning("studio_startup phase=%s state=timeout", name)
        return None
    except Exception as exc:
        logger.warning("studio_startup phase=%s state=error error=%s", name, exc)
        return None
    finally:
        logger.info(
            "studio_startup phase=%s state=end duration_ms=%d",
            name,
            int((time.monotonic() - started) * 1000),
        )
    return result
```

具体预算：

- `WeChatILinkAdapter.start()`：1 秒。
- `maybe_start_longrun(app)`：3 秒。
- `maybe_start_supervisor(...)`：1 秒。

MCP 要求：

- `GlobalMcpManager.load_or_init()` 仍只做本地配置装载。
- `schedule_restore()` 仍为 fire-and-forget，不得改成 `await restore_from_last_session()`。
- `GlobalMcpManager.close_all()` 在关闭 hub 前取消并 await 尚未结束的 `_restore_task`，防止测试和优雅关闭遗留任务。

`app.state.startup_phase` 在进入 `yield` 前设置为 `ready`。

#### 验收标准

- 将任一可选启动 coroutine mock 为永不返回时，Studio 最迟在对应预算后仍能进入 ready。
- 该能力的失败只产生一次高信号 warning，不把异常传播成整个 Studio 启动失败。
- MCP restore mock 为永不返回时，readiness 仍能及时返回 200。
- shutdown 后没有 `Task was destroyed but it is pending` 或未回收 MCP restore task。
- 日志可以从最后一个 `studio_startup phase=...` 明确判断卡在哪一步。

### FR-5：提取可测试的 Electron 本地 readiness 状态机

#### 新文件：`desktop/electron/backend-startup.ts`

必须提供以下导出，名称可微调，但职责不可重新塞回 `main.ts` 私有闭包：

```ts
export type BackendProbeResult =
  | { kind: "ready"; statusCode: 200 }
  | { kind: "http_error"; statusCode: number }
  | { kind: "timeout" }
  | { kind: "network_error"; code?: string; message: string };

export type BackendStartupFailureCode =
  | "spawn_failed"
  | "exited_before_ready"
  | "readiness_timeout"
  | "readiness_auth_failed";

export class BackendStartupError extends Error {
  code: BackendStartupFailureCode;
  elapsedMs: number;
  lastProbe?: BackendProbeResult;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}

export function resolveBackendStartupTimeoutMs(input: {
  platform: NodeJS.Platform;
  packaged: boolean;
  override?: string;
}): number;

export function probeLocalBackendReady(input: {
  port: number;
  token: string;
  timeoutMs?: number;
}): Promise<BackendProbeResult>;

export function waitForLocalBackendReady(input: {
  child: ChildProcess;
  port: number;
  token: string;
  totalTimeoutMs: number;
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
  probe?: typeof probeLocalBackendReady;
  onSlow?: () => void;
}): Promise<void>;
```

实现约束：

- `probeLocalBackendReady()` 使用 `node:http` 的 `request()`，host 固定为 `127.0.0.1`，path 固定为 `/api/health/ready`。
- 在 request 自身设置 1.5 秒 timeout；timeout 后 `request.destroy()` 并返回 `{kind:"timeout"}`。
- 读取并解析有限大小响应体；超过 64 KiB 立即失败，避免无界缓冲。
- 只接受 HTTP 200、`ok: true`、`status: "ready"`。
- `waitForLocalBackendReady()` 使用顺序循环：一次 probe 结束后再等待 interval 并发起下一次；禁止 `setInterval` 叠加 async probe。
- child `error`/`exit` 必须立即终止等待并给出 typed error。
- 收到 401 时可立即报 `readiness_auth_failed`，无需等满总预算。
- 30 秒调用一次 `onSlow()`，只调用一次。
- `AgenticX Studio Server`、`Uvicorn running` 等 stdout/stderr 文本不得触发 ready。
- 所有 timer、request 和 ChildProcess listener 在成功、失败、超时三条路径都必须清理。
- override 超时值应限制在 15～180 秒；无效值回退平台默认值。

#### 验收标准

- 前三次 `network_error`、第四次 `ready` 时成功返回。
- 单次 probe 永不响应时，每 1.5 秒被中断且不会重叠，最终按总预算失败。
- child 在等待中退出时立即返回 `exited_before_ready`，包含 exit code/signal。
- 仅输出日志 marker、HTTP 尚未 ready 时不得误判成功。
- HTTP 401 产生 `readiness_auth_failed`。
- Windows packaged 默认 90 秒；其他默认 60 秒；override 正确 clamp。
- 使用 Vitest fake timers 后测试稳定，不依赖真实网络与真实 Electron。

### FR-6：`main.ts` 只负责组装，不再自行实现竞态探针

#### 实施锚点 A：`desktop/electron/main.ts::waitServeReady()`

删除当前 `pingReady()`、`setInterval()`、日志 marker `onData/onErrData` 的成功判断。改为调用 `waitForLocalBackendReady()`，并把现有 stdout/stderr 环形尾部附加到 typed error 的展示证据中。

伪代码：

```ts
async function waitServeReady(): Promise<void> {
  if (!serveProcess) throw new BackendStartupError(/* spawn_failed */);
  await waitForLocalBackendReady({
    child: serveProcess,
    port: apiPort,
    token: apiToken,
    totalTimeoutMs: resolveBackendStartupTimeoutMs({
      platform: process.platform,
      packaged: app.isPackaged,
      override: process.env.AGX_DESKTOP_STARTUP_TIMEOUT_MS,
    }),
    onSlow: () => updateSplashStage("backend-slow"),
  });
}
```

#### 实施锚点 B：日志清理

在 `backend-startup.ts` 或现有日志格式化点增加 `stripAnsiAndControls()`：

- 移除 ANSI CSI/OSC 控制序列。
- 保留换行和可打印文本。
- stdout/stderr 各最多展示最后 1200 个字符。
- 不在面向用户的主 message 中暴露 token、完整环境变量或绝对用户目录。

#### 验收标准

- 本地启动不再请求 `/api/session`。
- 本地环回探针不受 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 或系统代理影响。
- 日志 warning 不会被当作 readiness，也不会单独触发失败。
- 错误详情中不再出现截图中的 ANSI 方框乱码。

### FR-7：慢启动与失败重试在应用内完成

#### 实施锚点 A：Splash stage

同步修改：

- `desktop/electron/splash.ts::SplashStage`
- `desktop/electron/splash-preload.ts::SplashStage`
- `desktop/electron/splash.html` 的 stage 映射

新增：

```text
backend-slow：首次启动较慢，仍在初始化本地引擎…
```

该阶段只更新文案和进度，不弹确认框、不启动第二个后端进程。

#### 实施锚点 B：`desktop/electron/main.ts::startLocalBackendFlow()`

将一次性失败退出改为应用内重试循环：

1. `startStudioServe()`。
2. `waitServeReady()`。
3. 成功后正常 `markStudioReady()`。
4. typed error 时先停止并等待当前 child `close`；不得在旧 child 尚存时创建新 child。
5. 显示主题一致的 Electron message box：按钮仅为“重试启动”“退出”。
6. 用户选择重试后重新选择端口并启动一个新 child；选择退出才 `app.quit()`。

错误文案映射：

| code | 主文案 | 详情重点 |
|---|---|---|
| `spawn_failed` | 本地服务未能启动 | 后端程序路径或系统拦截信息 |
| `exited_before_ready` | 本地服务初始化过程中已退出 | exit code、signal、日志尾部 |
| `readiness_timeout` | 本地服务初始化时间过长 | 已等待秒数、最后探针状态、最后启动 phase |
| `readiness_auth_failed` | 本地服务身份校验失败 | token 不一致，不建议用户重装 agx |

禁止继续使用统一主文案“无法启动本地服务，请检查 agx 是否可用”。“缺少 agx CLI”仍由现有 `checkAgxCli()` 独立分支处理。

#### 验收标准

- 慢但最终 ready 的 child 不会被 30 秒阈值重启。
- 超时后点击“重试启动”不退出 Desktop，且任意时刻最多存在一个由当前 app 持有的后端 child。
- 重试成功后只执行一次 `markStudioReady()`、飞书进程和微信 sidecar 启动。
- 用户点击退出后 child 被终止，计时器和监听器全部清理。
- 第二个应用实例仍受现有 `requestSingleInstanceLock()` 保护。

### FR-8：Windows 安装包必须做离线真实冷启动验证

#### 实施锚点：`packaging/build_windows_installer.ps1`

现有 smoke 使用 `/api/session` 且最多等待 60 秒。修改为：

1. 启动 `agx-server.exe` 前临时设置：

```powershell
$env:LITELLM_LOCAL_MODEL_COST_MAP = 'false'
$env:LITELLM_MODEL_COST_MAP_URL = 'http://192.0.2.1/unreachable-model-map.json'
```

测试地址使用 RFC 5737 TEST-NET，不使用真实第三方服务。发布入口必须覆盖 `false` 并使用本地备份。务必在 `finally` 恢复这两个环境变量原值。

2. 探测 `http://127.0.0.1:${FreePort}/api/health/ready`。
3. 记录从 `Start-Process` 到 HTTP 200 的毫秒数。
4. 30 秒内未 ready 则失败并输出进程 exit 状态；正常 Windows CI 冷启动目标小于 20 秒。
5. 在 `finally` 停止 smoke child。

#### 验收标准

- 不可达 model map URL 不增加启动耗时，也不出现在 stderr warning 中。
- smoke 不创建任何默认会话。
- 缺失 LiteLLM 本地备份时，在 `--check-desktop-runtime` 阶段明确失败。
- Windows bundled build、Desktop TypeScript build 和聚焦测试全部通过。

## 测试设计

### `tests/test_litellm_offline_startup.py`

使用全新 Python 子进程，避免当前 pytest 进程已导入 LiteLLM 导致假阳性。

测试 1：`agenticx` import 不联网。

```python
code = r"""
import os
os.environ.pop("LITELLM_LOCAL_MODEL_COST_MAP", None)
import httpx
def forbidden(*args, **kwargs):
    raise AssertionError("startup attempted outbound HTTP")
httpx.get = forbidden
import agenticx
assert os.environ["LITELLM_LOCAL_MODEL_COST_MAP"].lower() == "true"
"""
```

测试 2：相同隔离方式导入 `agenticx.cli.main`。

测试 3：相同隔离方式导入 `agenticx.studio.server`。

测试 4：`agenticx.llms.litellm_provider` 防御性设置在独立导入路径成立。

所有 subprocess：

- 设定 20 秒 test timeout，超时即失败。
- 捕获 stdout/stderr，断言不存在远程 model cost map warning。
- 使用测试虚拟环境的 `sys.executable`，不得调用系统裸 `python`。

### `tests/test_studio_readiness.py`

至少覆盖：

- 正确 token readiness 200。
- 错误 token 401。
- 连续探活不创建 session。
- `restore_from_last_session()` 永不返回时 readiness 仍成功。
- WeChat/LongRun/Supervisor 任一启动超时时仍 ready，并记录对应 warning。
- lifespan 关闭后 MCP restore task 已取消。

### `desktop/tests/backend-startup.test.ts`

至少覆盖 FR-5 与 FR-7 列出的所有状态机 AC。测试通过依赖注入的 `probe` 和 fake ChildProcess/EventEmitter 完成，不监听真实端口。

## 实施任务顺序

### Task 1：先建立失败回归测试

- [ ] 新增 `tests/test_litellm_offline_startup.py`。
- [ ] 新增 `tests/test_studio_readiness.py` 中 readiness/token/无 session 副作用测试。
- [ ] 新增 `desktop/tests/backend-startup.test.ts` 的状态机测试骨架。
- [ ] 确认改代码前：导入联网测试、readiness 404、日志 marker 误判或 `/api/session` 副作用中的相应测试失败。

### Task 2：切断启动期 LiteLLM 公网依赖

- [ ] 修改 `agenticx/__init__.py`。
- [ ] 修改 `agenticx/llms/litellm_provider.py`。
- [ ] 修改 `packaging/pyinstaller/agx_serve_entry.py`。
- [ ] 修改 `desktop/electron/main.ts` child env。
- [ ] 跑 Python 隔离导入测试和已有 LiteLLM provider 测试。

### Task 3：增加 readiness endpoint

- [ ] 在 `_check_token()` 后注册 `/api/health/ready`。
- [ ] 补 token 与无副作用测试。
- [ ] 保持 `/api/session` 原业务行为不变。

### Task 4：加固 lifespan

- [ ] 增加有界可选启动 helper 和 phase 日志。
- [ ] 给 WeChat、LongRun、Supervisor 应用明确预算。
- [ ] 保持 MCP restore 后台语义。
- [ ] 在 `close_all()` 中取消 restore task。
- [ ] 跑 readiness、MCP quarantine、MCP crash guard 测试。

### Task 5：实现 Electron readiness helper

- [ ] 新增 `backend-startup.ts`。
- [ ] 实现 Node loopback HTTP probe 和顺序等待循环。
- [ ] 实现 typed errors、ANSI 清理和平台预算。
- [ ] 完成 fake timer 单元测试。

### Task 6：接入 Desktop 启动与恢复 UX

- [ ] `main.ts` 移除旧 `waitServeReady()` 内部探针和日志成功判断。
- [ ] 接入 `/api/health/ready`。
- [ ] 增加 `backend-slow` splash stage。
- [ ] 增加应用内“重试启动/退出”流程。
- [ ] 确保重试前等待旧 child 关闭。

### Task 7：加固 Windows 打包 smoke

- [ ] `_check_desktop_runtime()` 校验 LiteLLM backup JSON。
- [ ] Windows smoke 注入不可达 URL。
- [ ] 改用 `/api/health/ready` 并记录耗时。
- [ ] 验证环境变量在 `finally` 恢复、smoke child 总能回收。

### Task 8：全量验证与 no-scope-creep 审核

- [ ] 执行聚焦 Python 测试。
- [ ] 执行 Desktop Vitest 与 TypeScript build。
- [ ] 在 Windows 真实安装包上完成离线、慢网、代理和 MCP 状态矩阵。
- [ ] 确认没有修改模型调用、MCP 配置、远程模式或历史会话语义。

## 验证命令

Python（使用项目支持的 Python 3.12 虚拟环境）：

```bash
python -m pytest -q \
  tests/test_litellm_offline_startup.py \
  tests/test_studio_readiness.py \
  tests/test_smoke_mcp_crash_guard_lifespan.py \
  tests/test_mcp_restore_quarantine.py \
  tests/test_global_mcp_manager.py \
  tests/test_smoke_litellm_reasoning_stream.py
```

Desktop：

```bash
npm --prefix desktop exec -- vitest run \
  tests/backend-startup.test.ts \
  tests/windows-installer-config.test.ts
npm --prefix desktop run build
```

Windows bundled smoke：

```powershell
pwsh -NoProfile -File packaging/build_windows_installer.ps1
```

## 手工验收矩阵

| 场景 | 预期 |
|---|---|
| 完全断网启动 Windows 安装包 | 首次启动成功；无远程 model cost map warning |
| DNS 无法解析远程 model map 域名 | 与正常网络启动耗时近似 |
| 设置 HTTP/HTTPS/SOCKS 代理 | 127.0.0.1 readiness 仍成功 |
| 5 个 MCP 已 quarantine | 启动成功；仅有一条跳过日志 |
| 一个未 quarantine MCP 永不响应 | 核心服务先 ready；MCP 后台超时/隔离 |
| 首次解包或杀毒扫描导致 40～70 秒冷启动 | 启动页进入慢启动文案，最终自动进入主界面 |
| 后端进程在 ready 前退出 | 明确显示“初始化过程中已退出”，可应用内重试 |
| readiness token 不匹配 | 显示身份校验失败，不提示重装 agx |
| 连续点击重试 | 当前 app 任意时刻最多一个本地后端 child |
| 连续探活 10 次 | 不产生空会话、不写 messages.json |

## 非功能验收标准

- NFR-1：启动关键路径中被 `await` 的公网 HTTP/DNS 请求数为 0；后台可选集成的网络失败不得延迟或改变 readiness。
- NFR-2：本地 readiness 探针并发数最大为 1。
- NFR-3：Windows 正常 CI bundled cold start 目标小于 20 秒，Desktop 容错上限 90 秒。
- NFR-4：任何可选 lifespan 步骤都具有明确最大等待预算。
- NFR-5：所有失败路径都清理 timer、HTTP request、ChildProcess listener 和后台 restore task。
- NFR-6：用户可见错误不包含 ANSI 控制乱码、token 或完整敏感环境信息。
- NFR-7：现有聊天、模型 provider、MCP quarantine、session 创建和远程服务器模式回归通过。

## 风险与回滚边界

### 风险 1：本地价格快照不够新

影响仅限费用/能力元数据可能滞后；模型调用本身不得依赖该数据是否命中。若业务确实依赖最新价格，应通过发版更新依赖快照，不恢复客户端启动期联网。

### 风险 2：新增 readiness endpoint 的兼容性

本计划先只替换本地后端探针。远程旧服务仍沿用现有探测逻辑，避免同时扩大协议兼容范围。

### 风险 3：可选 lifespan 超时后能力晚于主界面可用

可选能力超时即本次启动降级，并通过日志与设置状态反映；不得在超时 coroutine 仍运行的情况下重复启动同一组件。

### 风险 4：应用内重试产生重复子进程

重试必须以收到旧 child `close` 或确认其已退出为前置条件。若无法确认，保持失败态并退出，不可盲目创建第二个 child。

## Definition of Done

- 所有 FR/NFR 的自动化测试通过。
- Windows 安装包在断网和不可达远程 model map 条件下首次启动成功。
- Desktop 本地启动只探测 `/api/health/ready`，不再探测 `/api/session`，不依赖日志 marker。
- MCP restore 和其他可选能力无法阻塞核心 readiness。
- 失败弹窗能区分缺少程序、进程退出、初始化超时和 token 错误，并支持应用内安全重试。
- 实施 diff 不包含 Out of Scope 中列出的模型调用、远程模式、MCP 配置或会话语义改动。
