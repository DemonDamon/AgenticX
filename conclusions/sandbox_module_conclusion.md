# AgenticX Sandbox 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-02-01 之后的变更）（新增 mcp_gateway/ in-workspace MCP 网关，内化自 AgentScope v2 P0）

## 目录路径
`/Users/damon/myWork/AgenticX/agenticx/sandbox`

## 模块概述

Sandbox 模块提供安全的代码执行沙箱系统，支持多后端（subprocess、microsandbox、docker、remote），基于 AgentRun-SDK-Python 研究内化，保持厂商中立设计。模块支持"三档模式"（local / docker / remote(k8s)）配置驱动的后端自动选择、远端 HTTP 后端、以及可选的 JSONL 操作审计落盘。**模块新增「in-workspace MCP 网关」（`mcp_gateway/`）：在沙箱/容器内运行 MCP server 进程并经小型 HTTP 网关暴露，使 MCP 工具的文件系统/网络副作用留在沙箱内而非落到宿主机。**

## 完整目录结构

```
agenticx/sandbox/
├── __init__.py          # 模块入口，导出核心 API
├── types.py             # 类型定义（枚举、数据类、异常）
├── base.py              # 沙箱抽象基类（含审计 hook 与三档模式后端选择工厂）
├── template.py          # 沙箱配置模板（backend 取值新增 remote）
├── code_interpreter.py  # 代码解释器实现
├── execd.py             # execd HTTP 客户端
├── jupyter_kernel.py   # Jupyter Kernel 状态化执行
├── audit.py             # JSONL 操作审计（SandboxAuditTrail / AuditEntry）
├── backends/
│   ├── __init__.py      # 后端子模块
│   ├── subprocess.py    # subprocess 后端
│   ├── microsandbox.py  # microsandbox 后端
│   ├── docker.py        # Docker 容器后端
│   └── remote.py        # 远端 HTTP 后端（RemoteSandbox，K8s/Docker host）
├── mcp_gateway/         # [新增] in-workspace MCP 网关（内化自 AgentScope v2 P0）
│   ├── __init__.py      # 导出 GatewayState / MCPBackend / InMemoryMCPBackend / build_gateway_app / GatewayClient
│   ├── gateway_app.py   # 容器侧 FastAPI 网关 app + MCPBackend 协议 + InMemoryMCPBackend
│   └── client.py        # 宿主侧 GatewayClient（HTTP 门面，可注入 httpx 传输）
└── tools/
    └── __init__.py      # 沙箱工具子模块
```

---

## 核心组件

### types.py - 类型定义

**枚举类型**：
- `SandboxType`: 沙箱类型（CODE_INTERPRETER, SHELL, CONTAINER）
- `SandboxStatus`: 沙箱状态（PENDING, STARTING, RUNNING, STOPPING, STOPPED, ERROR）
- `CodeLanguage`: 代码语言（PYTHON, SHELL, JAVASCRIPT 等）

**数据类**：
- `ExecutionResult`: 执行结果，包含 stdout/stderr/exit_code/duration_ms
- `HealthStatus`: 健康状态
- `FileInfo`: 文件信息
- `ProcessInfo`: 进程信息

**异常体系**：
- `SandboxError`: 基础异常
- `SandboxTimeoutError`: 超时异常
- `SandboxExecutionError`: 执行异常
- `SandboxResourceError`: 资源异常
- `SandboxNotReadyError`: 未就绪异常
- `SandboxBackendError`: 后端异常
- `ExecdConnectionError`: execd 连接错误
- `ExecdExecutionError`: execd 执行错误
- `ExecdTimeoutError`: execd 超时错误
- `JupyterKernelError`: Jupyter kernel 错误
- `JupyterKernelNotAvailableError`: Jupyter kernel 不可用

### base.py - 抽象基类

**SandboxBase**：所有沙箱实现的基类
- 生命周期方法：`start()`, `stop()`, `restart()`
- 代码执行：`execute(code, language, timeout)`
- 文件操作：`upload_file()`, `download_file()`, `list_files()`
- 进程管理：`list_processes()`, `kill_process()`
- 健康检查：`health_check()`
- 上下文管理器：支持 `async with` 模式

**Sandbox**：工厂类
- `Sandbox.create(type, template, backend)`: 根据配置创建沙箱实例
- `_select_backend()`: **[更新] 三档模式后端自动选择**，优先级 `remote > microsandbox > docker > subprocess`；可由 `~/.agenticx/config.yaml` 的 `sandbox.mode`（local / docker / microsandbox / remote(k8s/docker+k8s)）覆盖，目标后端不可用时按序回退（如 remote 不可达 → docker → subprocess）

**审计 hook**：`SandboxBase` 构造函数新增可选 `audit_trail` 参数，内部 `_audit_record()` 在 execute / run_command 成功路径将操作、code 哈希、退出码、耗时、后端、语言写入审计

设计原则（来自 AgentRun-SDK-Python）：
1. 配置与实例分离：Template 定义配置，Sandbox 是运行实例
2. 生命周期托管：通过 Context Manager 确保资源回收
3. 同步/异步双接口
4. 厂商中立

### template.py - 配置模板

**SandboxTemplate**：沙箱配置模板
- 资源配置：cpu, memory_mb, disk_mb
- 执行配置：timeout_seconds, max_processes
- 网络配置：network_enabled, allowed_hosts
- 后端选择：backend (auto/subprocess/microsandbox/docker/remote)

**预定义模板**：
- `DEFAULT_CODE_INTERPRETER_TEMPLATE`: 默认代码解释器（1 CPU, 2GB 内存）
- `LIGHTWEIGHT_TEMPLATE`: 轻量级（0.5 CPU, 512MB 内存）
- `HIGH_PERFORMANCE_TEMPLATE`: 高性能（4 CPU, 8GB 内存）

### code_interpreter.py - 代码解释器

**CodeInterpreterSandbox**：专门用于代码执行的沙箱实现
- 支持 Python 和 Shell 代码执行
- 自动检测和安装依赖
- 会话状态保持

**便捷函数**：
- `execute_code(code, language, timeout)`: 快速执行代码

### backends/ - 后端实现

#### subprocess.py
**SubprocessSandbox**：基于子进程的沙箱后端
- 使用 `asyncio.create_subprocess_exec` 执行代码
- 支持超时和资源限制
- 适用于本地开发和测试

#### microsandbox.py
**MicrosandboxSandbox**：基于 microsandbox 的容器级沙箱
- 轻量级虚拟机隔离
- 更强的安全性
- 支持网络隔离

#### docker.py
**DockerSandbox**：基于 Docker 容器的沙箱后端
- 容器级隔离（进程、网络、文件系统）
- 支持自定义镜像（默认 `python:3.11-slim`）
- 支持资源限制（CPU、内存）
- 支持网络配置（bridge/host/none）
- 支持 Docker CLI 和 Python SDK 两种方式
- 自动容器清理（`auto_remove`）
- 前置条件：Docker 已安装并运行，可选安装 `docker` Python SDK

#### remote.py
**RemoteSandbox**：基于远端 HTTP 的沙箱后端
- 将执行委派给远端 microsandbox / Docker host / 任意 HTTP 兼容沙箱 API，使本机无需安装 Docker 即可获得 Docker+K8s 档隔离
- 典型部署：microsandbox server 运行在 K8s Pod 中，通过 Service/Ingress 暴露端口（默认 `http://127.0.0.1:5555`）
- 关键参数：`server_url`、`api_key`、`namespace`、`image`（默认 `microsandbox/python`）、`fallback_backend`（默认 `docker`）、`connect_timeout`
- 远端不可达时可回退到 `fallback_backend`

### mcp_gateway/ - in-workspace MCP 网关（新增，内化自 AgentScope v2 P0）

**模块功能**：在沙箱/容器内运行 MCP server 进程并通过小型 HTTP 网关对外暴露，使 MCP 工具的文件系统/网络副作用留在沙箱内、不污染宿主机 `~/.agenticx/`。

**技术实现**：选择性内化自 AgentScope 2.0 `workspace/_mcp_gateway/` 与 `workspace/_gateway_client.py`（Apache-2.0, commit `6d7189c`）；AGX 改造点：(1) 网关经 `MCPBackend` 协议与具体 MCP 实现解耦——生产可前置 AGX 自有 `MCPHub`，测试/本地用 `InMemoryMCPBackend`；(2) 宿主侧 `GatewayClient` 支持注入 `httpx.AsyncClient`，可在进程内 ASGI 传输上免 Docker 冒烟测试。

**关键组件**：
- `gateway_app.py`（容器侧 FastAPI app）：
  - `MCPBackend`（`@runtime_checkable` Protocol）：抽象上游 MCP 机制，定义 `add` / `remove` / `list_servers` / `list_tools` / `call_tool`
  - `InMemoryMCPBackend`：以纯 Python 可调用（同步/异步均可）为后端的测试/演示实现，支持 `register_server()` 预注册工具 handler 与 schema
  - `GatewayState`：持有网关的 auth token 与 backend
  - `build_gateway_app(state)`：构建 FastAPI app，端点 `GET /health`（无鉴权）、`GET/POST /mcps`、`DELETE /mcps/{name}`、`GET /mcps/{name}/tools`、`POST /mcps/{name}/tools/{tool}`；除 `/health` 外当配置 token 时要求 `Authorization: Bearer <token>`（空 token 关闭鉴权以向后兼容）
- `client.py`（宿主侧）：
  - `GatewayClient`：与容器侧网关通信的门面，提供 `health()` / `list_mcps()` / `add_mcp()` / `remove_mcp()` / `list_tools()` / `call_tool()`；可注入共享 `httpx.AsyncClient`（注入时不由其关闭，否则每次调用创建一次性 client）；`call_tool` 对 4xx/5xx 以 `{"state": "error", ...}` chunk 形式返回，便于 agent 循环对失败进行推理而非崩溃
  - `GatewayToolError` 异常

**业务逻辑**：将 MCP 的执行隔离推进到「网关化」层级——MCP 工具运行在沙箱进程内，宿主仅通过受 Bearer 鉴权的 HTTP 网关调用，副作用被封闭在沙箱中。

**依赖关系**：`gateway_app.py` 依赖 `fastapi`；`client.py` 依赖 `httpx`；与具体 MCP 实现通过 `MCPBackend` 协议解耦。

### audit.py - JSONL 操作审计

**SandboxAuditTrail**：append-only JSONL 审计日志，支持按文件大小自动轮转（默认 50MB，默认目录 `~/.agenticx/sandbox/audit`）
- `record()`: 记录单次操作（对 code 做 SHA256 截断哈希，不落明文代码）
- `query()`: 按 `sandbox_id` / `operation` 过滤查询，支持 `limit`

**AuditEntry**（数据类）：单条审计记录，含 timestamp / sandbox_id / operation / code_hash / exit_code / duration_ms / backend / language / error / metadata，支持 `to_json()` / `from_json()`

### execd.py - Execd HTTP 客户端

**ExecdClient**：封装 execd daemon 的 HTTP API 客户端
- 代码执行：`execute_code()` 支持状态化 Jupyter kernel（通过 `context_id`）
- 命令执行：`run_command()` 支持前台/后台执行
- 文件操作：`read_file()`, `write_file()`, `list_files()`, `delete_file()`
- SSE 流式输出解析：`execute_code_stream()` 返回异步迭代器
- 健康检查：`health_check()`
- 上下文管理：支持 `async with` 模式
- 重试机制：支持自动重试和超时配置
- 默认端口：`DEFAULT_EXECD_PORT = 44772`

**数据类**：
- `CodeExecutionResult`: 代码执行结果（stdout/stderr/result/exit_code/context_id）
- `CommandExecutionResult`: 命令执行结果（支持后台进程 PID）
- `CodeContext`: 代码执行上下文（用于状态化执行）
- `FileEntry`: 文件条目信息
- `SupportedLanguage`: 支持的编程语言枚举（python/javascript/typescript/java/go/bash/shell）

### jupyter_kernel.py - Jupyter Kernel 状态化执行

**JupyterKernelManager**：管理 Jupyter kernel 的生命周期
- 会话管理：`create_session()`, `delete_session()`, `list_sessions()`
- 状态化代码执行：`execute()` 支持变量、函数、import 跨执行持久化
- 多语言支持：支持 Python、JavaScript 等 kernel
- 默认 kernel：`python3`
- 超时配置：启动超时和执行超时
- 前置条件：需要安装 `jupyter_client` 和 `ipykernel`

**StatefulCodeInterpreter**：状态化代码解释器封装
- 基于 `JupyterKernelManager` 的高级封装
- 自动管理 kernel 会话生命周期
- 提供类似 REPL 的交互式执行体验
- 支持表达式求值和代码块执行

**数据类**：
- `KernelSession`: Kernel 会话信息（session_id/kernel_name/execution_count/is_alive）

**工具函数**：
- `is_jupyter_available()`: 检查 Jupyter 是否可用

---

## 使用示例

### 基础用法
```python
from agenticx.sandbox import Sandbox, SandboxType

async with Sandbox.create(type=SandboxType.CODE_INTERPRETER) as sb:
    result = await sb.execute("print('Hello, AgenticX!')")
    print(result.stdout)  # Hello, AgenticX!
```

### 使用模板
```python
from agenticx.sandbox import Sandbox, SandboxTemplate, SandboxType

template = SandboxTemplate(
    name="custom",
    type=SandboxType.CODE_INTERPRETER,
    cpu=2.0,
    memory_mb=4096,
    timeout_seconds=600,
)

async with Sandbox.create(template=template) as sb:
    result = await sb.execute("import numpy; print(numpy.__version__)")
```

### 指定后端
```python
from agenticx.sandbox import Sandbox, SandboxType

# 使用 subprocess 后端
sb = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    backend="subprocess"
)

# 使用 microsandbox 后端（更安全）
sb = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    backend="microsandbox"
)

# 使用 Docker 后端（容器级隔离）
sb = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    backend="docker",
    image="python:3.11-slim"
)
```

### 使用 ExecdClient
```python
from agenticx.sandbox import ExecdClient, create_execd_client

# 创建客户端
async with ExecdClient("http://localhost:44772") as client:
    # 状态化代码执行
    result1 = await client.execute_code("x = 1 + 1", language="python")
    result2 = await client.execute_code("print(x)", language="python", context_id=result1.context_id)
    
    # 命令执行
    cmd_result = await client.run_command("ls -la", background=False)
    
    # 文件操作
    await client.write_file("/tmp/test.txt", "Hello World")
    content = await client.read_file("/tmp/test.txt")
    files = await client.list_files("/tmp")

# 便捷创建函数
client = await create_execd_client(port=44772)
```

### 使用 Jupyter Kernel 状态化执行
```python
from agenticx.sandbox import JupyterKernelManager, StatefulCodeInterpreter

# 使用 JupyterKernelManager
async with JupyterKernelManager() as km:
    # 创建会话
    session_id = await km.create_session("python3")
    
    # 状态化执行（变量持久化）
    result1 = await km.execute("x = 1 + 1", session_id)
    result2 = await km.execute("print(x)", session_id)  # 输出: 2
    
    # 函数定义持久化
    await km.execute("def greet(name): return f'Hello, {name}!'", session_id)
    result3 = await km.execute("print(greet('World'))", session_id)  # 输出: Hello, World!

# 使用 StatefulCodeInterpreter（更高级封装）
async with StatefulCodeInterpreter() as interpreter:
    result = await interpreter.execute("import numpy as np")
    result = await interpreter.execute("arr = np.array([1, 2, 3])")
    result = await interpreter.execute("print(arr.mean())")  # 输出: 2.0
```

---

## 与 Tools 模块集成

Sandbox 模块与 `agenticx.tools.executor` 深度集成：

```python
from agenticx.tools import ToolExecutor
from agenticx.tools.executor import SandboxConfig

# 配置高级沙箱
config = SandboxConfig(
    backend="subprocess",
    timeout_seconds=60,
    memory_mb=1024,
)

executor = ToolExecutor(sandbox_config=config)

# 在沙箱中执行代码
result = await executor.execute_code_in_sandbox("print('Safe execution!')")
```

---

## 设计来源

本模块设计内化自 AgentRun-SDK-Python 和 OpenSandbox 项目的研究成果，主要借鉴：
- 多后端抽象设计（subprocess/microsandbox/docker）
- Template/Instance 分离模式
- 生命周期管理机制
- 类型安全的异常体系
- execd daemon HTTP API 设计（参考 OpenSandbox）
- Jupyter kernel 状态化执行模式

**三档模式增强（plan: 2026-03-23-sandbox-three-tier-mode）**：新增 `sandbox.mode` / `remote_url` / `audit_log_dir` 配置，工厂按 `remote > microsandbox > docker > subprocess` 自动选择；新增 `RemoteSandbox` 远端后端与 `SandboxAuditTrail` JSONL 审计；CLI 侧 `agx sandbox status` 可展示各后端探测结果与当前 auto 选择（实现位于 `agenticx/cli`）。

**in-workspace MCP 网关（plan: 2026-05-29-agx-absorb-agentscope-v2-p0，commit `f8234a92`）**：内化自 AgentScope 2.0 的 `_mcp_gateway` + `_gateway_client`，新增 `mcp_gateway/`——容器侧 FastAPI 网关（`MCPBackend` 协议解耦上游、`InMemoryMCPBackend` 用于测试、Bearer 鉴权）与宿主侧 `GatewayClient`（可注入 httpx 传输、免 Docker 冒烟测试），让 MCP 工具进程在沙箱内运行、副作用封闭于沙箱。
