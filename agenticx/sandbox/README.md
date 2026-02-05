# AgenticX Sandbox 模块

## 概述

AgenticX Sandbox 模块是一个**统一抽象层（Adapter Layer）**，为不同的沙箱实现（如 OpenSandbox、Microsandbox、Docker 等）提供统一的 API 接口。这使得 AgenticX 可以灵活地接入各种 sandbox SDK，同时保持上层代码的一致性。

### 核心作用

1. **统一接口**：为不同的 sandbox 实现提供统一的 API，无需修改上层代码即可切换后端
2. **后端适配**：自动适配不同的 sandbox SDK（subprocess、microsandbox、docker 等）
3. **自动选择**：根据环境自动选择最佳可用后端
4. **工具集成**：与 AgenticX 工具系统深度集成，为 Agent 提供安全的代码执行能力

## 多后端支持

AgenticX Sandbox 支持三种后端实现，每种后端提供不同级别的隔离：

| 后端 | 隔离级别 | 使用场景 | 依赖要求 | 状态 |
|------|---------|---------|---------|------|
| **subprocess** | 进程级 | 开发/测试 | 无 | ✅ 已实现 |
| **microsandbox** | 硬件级（VM） | 生产推荐 | microsandbox SDK + 服务器 | ✅ 已实现 |
| **docker** | 容器级 | 降级方案 | Docker daemon | ✅ 已实现 |

---

## Microsandbox 后端

Microsandbox 是一个基于 libkrun 的轻量级虚拟机沙箱，提供硬件级隔离（VM-level isolation），启动时间 <200ms。

### 安装步骤

按顺序执行以下步骤：

#### 步骤 1: 安装 microsandbox CLI（三选一）

以下三种方式**任选一种**即可：

**方式 A: 一键安装脚本（推荐）**
```bash
curl -sSL https://get.microsandbox.dev | sh
```

**方式 B: 使用 Cargo 安装**（需要已安装 Rust 工具链）
```bash
cargo install microsandbox
```

**方式 C: 从源码构建**
```bash
git clone https://github.com/zerocore-ai/microsandbox.git
cd microsandbox
cargo build --release
sudo cp target/release/msb /usr/local/bin/
```

安装完成后，验证 CLI 是否可用：
```bash
msb --version
```

#### 步骤 2: 安装 Python SDK

```bash
pip install microsandbox
```

#### 步骤 3: 拉取 Python 运行时镜像

```bash
msb pull microsandbox/python
```

> 注：此步骤会下载约 200MB 的镜像，需要几分钟。如果跳过此步骤，首次启动沙箱时会自动拉取。

#### 步骤 4: 启动 microsandbox 服务器

**打开一个新的终端窗口**，运行：

```bash
msb server start --dev
```

> 重要：保持此终端窗口运行，不要关闭！服务器需要一直运行。

#### 步骤 5: 验证安装

**打开另一个终端窗口**，进入 AgenticX 项目目录，运行验证：

```bash
cd /path/to/AgenticX
python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox --verify
```

预期输出（成功时）:

```
========================================
Microsandbox 安装验证
========================================

[1/4] 检查 SDK
  ✅ SDK 已安装
[2/4] 检查服务器连接
  ✅ 服务器运行中 (http://127.0.0.1:5555)
[3/4] 创建并启动沙箱
  ✅ 沙箱启动成功
[4/4] 执行测试代码
  ✅ 代码执行成功，输出: Hello from Microsandbox!

========================================
✅ 验证通过！Microsandbox 已正确安装。
========================================
```

### 快速开始

验证安装通过后，运行演示脚本：

```bash
# 运行完整演示（基础 + 高级功能）
python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox

# 只运行基础演示
python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox --basic

# 只运行高级功能演示
python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox --advanced
```

演示内容：
- 基础：代码执行、数学计算、系统信息获取
- 高级：状态化执行、文件操作、资源指标、错误处理

> **注意**：在 macOS Apple Silicon 上，Shell 命令执行可能不可靠（见常见问题）。演示脚本已针对此限制进行适配，使用 Python 代码替代 Shell 命令。

### 在代码中使用

```python
import asyncio
from agenticx.sandbox.backends.microsandbox import MicrosandboxSandbox

async def main():
    # 使用 context manager 自动管理生命周期
    async with MicrosandboxSandbox() as sandbox:
        # 执行 Python 代码
        result = await sandbox.execute("print('Hello!')")
        print(result.stdout)
        
        # 状态化执行（变量在同一沙箱实例中持久化）
        await sandbox.execute("x = 42")
        result = await sandbox.execute("print(x)")  # 输出: 42
        
        # 获取系统信息（使用 Python 代码，兼容性更好）
        result = await sandbox.execute("""
import sys, platform
print(f"Python: {sys.version}")
print(f"Platform: {platform.system()} {platform.machine()}")
        """)
        print(result.stdout)

asyncio.run(main())
```

> **macOS Apple Silicon 注意**：Shell 命令执行（`language="shell"`）在 Apple Silicon 上可能不可靠。建议使用 Python 代码完成相同功能。例如，用 `import os; print(os.listdir('.'))` 替代 `ls`。

### 常见问题

#### Q: 启动超时怎么办？

首次启动需要拉取 Python 镜像（约 200MB），可能需要几分钟。解决方法：

1. 提前拉取镜像：`msb pull microsandbox/python`
2. 增加启动超时：`MicrosandboxSandbox(startup_timeout=600.0)`

#### Q: 如何检查服务器状态？

```bash
curl http://127.0.0.1:5555/api/v1/health
```

#### Q: 如何设置 API 密钥？

```bash
# 启动服务器时设置
msb server start --api-key your-secret-key

# 在代码中使用
sandbox = MicrosandboxSandbox(api_key="your-secret-key")

# 或通过环境变量
export MSB_API_KEY="your-secret-key"
```

#### Q: 支持哪些操作系统？

- **Linux**: 需要 KVM 支持（`/dev/kvm` 可访问）✅ 推荐
- **macOS Intel**: 需要 Hypervisor.framework 支持（macOS 10.10+）✅ 支持
- **macOS Apple Silicon**: ⚠️ 已知问题（Portal 502 错误），详见 [GitHub issue #292](https://github.com/zerocore-ai/microsandbox/issues/292)
- **Windows**: 目前不支持

**macOS Apple Silicon 用户注意**：如果遇到 "502 Bad Gateway" 错误，这是 microsandbox 在 Apple Silicon 上的已知问题。建议：
1. 使用 `subprocess` 后端进行开发测试（无需额外安装）
2. 在生产环境使用 Linux 服务器
3. 关注 [GitHub issue #292](https://github.com/zerocore-ai/microsandbox/issues/292) 等待官方修复

### 更多信息

- [microsandbox 官方文档](https://docs.microsandbox.dev/)
- [microsandbox GitHub](https://github.com/zerocore-ai/microsandbox)

---

## 其他后端

### Subprocess 后端（开发/测试）

**特点：**
- ✅ 无需额外安装，开箱即用
- ✅ 适合开发和测试
- ⚠️ 仅提供进程级隔离，不提供强安全隔离
- ⚠️ 不适合执行不可信代码

**快速开始：**

运行示例脚本：
```bash
python examples/agenticx-for-sandbox/sandbox_demo.py --backend subprocess
```

在代码中使用：
```python
from agenticx.sandbox.backends.subprocess import SubprocessSandbox

async with SubprocessSandbox() as sandbox:
    result = await sandbox.execute("print('Hello!')")
    print(result.stdout)
```

### Docker 后端（容器隔离）

需要 Docker 运行中：

```python
from agenticx.sandbox.backends.docker import DockerSandbox

async with DockerSandbox() as sandbox:
    result = await sandbox.execute("print('Hello!')")
```

### 后端自动选择

```python
from agenticx.sandbox import Sandbox

# 自动选择最佳可用后端（优先级：microsandbox > docker > subprocess）
sb = Sandbox.create(backend="auto")

# 手动指定后端
sb = Sandbox.create(backend="subprocess")   # 开发环境
sb = Sandbox.create(backend="microsandbox") # 生产环境
sb = Sandbox.create(backend="docker")       # 降级方案
```

---

## 架构设计

```
┌─────────────────────────────────────────┐
│      AgenticX 应用层                     │
│   (Agents, Tools, Workflows)            │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│      Sandbox 统一抽象层                  │
│   ┌─────────────────────────────────┐   │
│   │  SandboxBase (抽象基类)          │   │
│   │  - execute()                    │   │
│   │  - start() / stop()             │   │
│   │  - check_health()               │   │
│   │  - 文件/进程操作（可选）          │   │
│   └─────────────────────────────────┘   │
│   ┌─────────────────────────────────┐   │
│   │  Sandbox (工厂类)                │   │
│   │  - create()                     │   │
│   │  - 自动后端选择                  │   │
│   └─────────────────────────────────┘   │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌─────▼─────┐  ┌───▼────┐
│Subproc│   │Micro-     │  │Docker  │
│ess    │   │sandbox    │  │        │
│Backend│   │Backend    │  │Backend │
└───────┘   └───────────┘  └────────┘
```

### 设计原则

1. **配置与实例分离**：Template 定义配置，Sandbox 是运行实例
2. **生命周期托管**：通过 Context Manager 确保资源回收
3. **同步/异步双接口**：提供 `execute()` 和 `execute_sync()`
4. **厂商中立**：不依赖特定云服务，可以接入任何 sandbox SDK

---

## 核心 API

### SandboxBase（抽象基类）

所有后端实现必须继承 `SandboxBase` 并实现以下方法：

#### 生命周期方法

```python
async def start(self) -> None:
    """启动沙箱"""
    
async def stop(self) -> None:
    """停止沙箱"""
    
async def restart(self) -> None:
    """重启沙箱"""
```

#### 代码执行

```python
async def execute(
    self,
    code: str,
    language: str = "python",
    timeout: Optional[int] = None,
    **kwargs,
) -> ExecutionResult:
    """执行代码，返回 ExecutionResult"""
```

#### 健康检查

```python
async def check_health(self) -> HealthStatus:
    """检查沙箱健康状态"""
```

#### 可选方法

```python
# 文件操作
async def read_file(self, path: str) -> str
async def write_file(self, path: str, content: Union[str, bytes]) -> None
async def list_directory(self, path: str = "/") -> List[FileInfo]
async def delete_file(self, path: str) -> None

# 进程操作
async def run_command(self, command: str, timeout: Optional[int] = None) -> ExecutionResult
async def list_processes(self) -> List[ProcessInfo]
async def kill_process(self, pid: int) -> None
```

---

## 配置模板

### 使用预定义模板

```python
from agenticx.sandbox import (
    Sandbox,
    DEFAULT_CODE_INTERPRETER_TEMPLATE,
    LIGHTWEIGHT_TEMPLATE,
    HIGH_PERFORMANCE_TEMPLATE,
)

# 轻量级模板
sb = Sandbox.create(template=LIGHTWEIGHT_TEMPLATE)

# 高性能模板
sb = Sandbox.create(template=HIGH_PERFORMANCE_TEMPLATE)
```

### 自定义模板

```python
from agenticx.sandbox import SandboxTemplate, SandboxType

template = SandboxTemplate(
    name="my-template",
    type=SandboxType.CODE_INTERPRETER,
    cpu=2.0,
    memory_mb=4096,
    timeout_seconds=600,
    network_enabled=True,
    backend="microsandbox",
)

sb = Sandbox.create(template=template)
```

---

## 错误处理

```python
from agenticx.sandbox import (
    SandboxError,
    SandboxTimeoutError,
    SandboxExecutionError,
    SandboxNotReadyError,
    SandboxBackendError,
)

try:
    async with Sandbox.create() as sb:
        result = await sb.execute("import time; time.sleep(100)", timeout=5)
except SandboxTimeoutError as e:
    print(f"执行超时: {e.timeout}s")
except SandboxExecutionError as e:
    print(f"执行错误: {e.stderr}")
except SandboxNotReadyError:
    print("沙箱未就绪")
except SandboxBackendError as e:
    print(f"后端错误: {e.backend}")
except SandboxError as e:
    print(f"沙箱错误: {e}")
```

---

## 示例脚本

| 脚本 | 说明 | 运行命令 |
|------|------|----------|
| `sandbox_demo.py` | **统一演示脚本**：支持多后端、验证安装、基础/高级演示 | `python examples/agenticx-for-sandbox/sandbox_demo.py` |
| `opensandbox_style_example.py` | OpenSandbox API 风格示例 | `python examples/agenticx-for-sandbox/opensandbox_style_example.py` |

### sandbox_demo.py 使用方式

```bash
# 自动检测后端，运行完整演示
python examples/agenticx-for-sandbox/sandbox_demo.py

# 指定后端
python examples/agenticx-for-sandbox/sandbox_demo.py --backend subprocess
python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox

# 验证 microsandbox 安装
python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox --verify

# 只运行基础/高级演示
python examples/agenticx-for-sandbox/sandbox_demo.py --basic
python examples/agenticx-for-sandbox/sandbox_demo.py --advanced
```

---

## 安全考虑

1. **生产环境**：强烈建议使用 `microsandbox` 后端（硬件级隔离）
2. **subprocess 后端**：仅适用于开发和测试，不提供强隔离
3. **网络访问**：默认禁用，按需启用
4. **资源限制**：合理配置 CPU、内存限制，防止资源耗尽

---

## 相关文档

- [Sandbox 架构设计文档](../../docs/adr/ADR-001-sandbox-system.md)
- [使用示例目录](../../examples/agenticx-for-sandbox/)

## 许可证

与 AgenticX 项目相同。
