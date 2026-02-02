# AgenticX Sandbox 模块

## 概述

AgenticX Sandbox 模块是一个**统一抽象层（Adapter Layer）**，为不同的沙箱实现（如 OpenSandbox、Microsandbox、Docker 等）提供统一的 API 接口。这使得 AgenticX 可以灵活地接入各种 sandbox SDK，同时保持上层代码的一致性。

### 核心作用

1. **统一接口**：为不同的 sandbox 实现提供统一的 API，无需修改上层代码即可切换后端
2. **后端适配**：自动适配不同的 sandbox SDK（subprocess、microsandbox、docker 等）
3. **自动选择**：根据环境自动选择最佳可用后端
4. **工具集成**：与 AgenticX 工具系统深度集成，为 Agent 提供安全的代码执行能力

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

## 多后端支持

AgenticX Sandbox 支持三种后端实现，每种后端提供不同级别的隔离：

| 后端 | 隔离级别 | 使用场景 | 依赖要求 | 状态 |
|------|---------|---------|---------|------|
| **subprocess** | 进程级 | 开发/测试 | 无 | ✅ 已实现 |
| **microsandbox** | 硬件级（VM） | 生产推荐 | `pip install microsandbox` | ⚠️ 需要更新 |
| **docker** | 容器级 | 降级方案 | Docker daemon | ✅ 已实现 |

### 后端选择策略

系统会根据环境自动选择最佳后端，优先级为：**microsandbox > docker > subprocess**

```python
# 自动选择（推荐）
sb = Sandbox.create(backend="auto")  # 或省略 backend 参数

# 手动指定后端
sb = Sandbox.create(backend="subprocess")  # 开发环境
sb = Sandbox.create(backend="microsandbox")  # 生产环境
sb = Sandbox.create(backend="docker")  # 降级方案
```

## 快速开始

### 基本使用

```python
from agenticx.sandbox import Sandbox, SandboxType

# 创建沙箱并执行代码
async with Sandbox.create(type=SandboxType.CODE_INTERPRETER) as sb:
    result = await sb.execute("print('Hello, AgenticX!')")
    print(result.stdout)  # 输出: Hello, AgenticX!
```

### 使用 CodeInterpreterSandbox（状态化执行）

```python
from agenticx.sandbox import CodeInterpreterSandbox

async with CodeInterpreterSandbox() as interpreter:
    # 执行代码并保持状态
    await interpreter.run("x = 1 + 1")
    result = await interpreter.run("print(x)")  # 输出: 2
    
    # 执行 Shell 命令
    result = await interpreter.run_shell("ls -la")
```

### 一次性执行

```python
from agenticx.sandbox import execute_code

result = await execute_code("print(sum(range(10)))")
print(result.stdout)  # 输出: 45
```

## 配置模板

### 使用预定义模板

```python
from agenticx.sandbox import (
    Sandbox,
    DEFAULT_CODE_INTERPRETER_TEMPLATE,
    LIGHTWEIGHT_TEMPLATE,
    HIGH_PERFORMANCE_TEMPLATE,
)

# 轻量级模板（快速启动，低资源）
sb = Sandbox.create(template=LIGHTWEIGHT_TEMPLATE)

# 高性能模板（更多资源）
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
    backend="microsandbox",  # 指定后端
)

sb = Sandbox.create(template=template)
```

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

#### 可选方法（文件操作）

```python
async def read_file(self, path: str) -> str:
    """读取文件内容"""
    
async def write_file(self, path: str, content: Union[str, bytes]) -> None:
    """写入文件"""
    
async def list_directory(self, path: str = "/") -> List[FileInfo]:
    """列出目录内容"""
    
async def delete_file(self, path: str) -> None:
    """删除文件"""
```

#### 可选方法（进程操作）

```python
async def run_command(
    self,
    command: str,
    timeout: Optional[int] = None,
) -> ExecutionResult:
    """运行 Shell 命令"""
    
async def list_processes(self) -> List[ProcessInfo]:
    """列出所有进程"""
    
async def kill_process(self, pid: int) -> None:
    """终止进程"""
```

### Sandbox（工厂类）

```python
@classmethod
def create(
    cls,
    type: SandboxType = SandboxType.CODE_INTERPRETER,
    template: Optional[SandboxTemplate] = None,
    template_name: Optional[str] = None,
    backend: str = "auto",
    **kwargs,
) -> SandboxBase:
    """创建沙箱实例"""
```

## 与工具系统集成

Sandbox 模块与 AgenticX 的工具系统深度集成：

### 在 ToolExecutor 中使用

```python
from agenticx.tools.executor import ToolExecutor, SandboxConfig

# 配置沙箱
config = SandboxConfig(
    backend="microsandbox",
    timeout_seconds=60,
    cpu=1.0,
    memory_mb=1024,
)

# 创建执行器
executor = ToolExecutor(sandbox_config=config)

# 在沙箱中执行代码
async with executor:
    result = await executor.execute_code_in_sandbox(
        code="print('Safe execution!')",
        language="python",
    )
    print(result.stdout)
```

### 使用 SandboxCodeInterpreterTool

```python
from agenticx.tools import SandboxCodeInterpreterTool

# 创建工具
tool = SandboxCodeInterpreterTool(backend="microsandbox")

# 在 Agent 中使用
result = await tool.execute(code="print('Hello')")
```

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

## 扩展新后端

要添加新的后端实现，只需：

1. 继承 `SandboxBase` 抽象基类
2. 实现必需的方法（`start`, `stop`, `execute`, `check_health`）
3. 可选实现文件操作和进程操作方法
4. 在 `Sandbox._create_sandbox()` 中注册新后端

示例：

```python
from agenticx.sandbox.base import SandboxBase
from agenticx.sandbox.types import ExecutionResult, HealthStatus

class MyCustomSandbox(SandboxBase):
    async def start(self) -> None:
        # 实现启动逻辑
        pass
    
    async def stop(self) -> None:
        # 实现停止逻辑
        pass
    
    async def execute(self, code: str, language: str = "python", **kwargs) -> ExecutionResult:
        # 实现代码执行逻辑
        pass
    
    async def check_health(self) -> HealthStatus:
        # 实现健康检查逻辑
        pass
```

## 安全考虑

1. **生产环境**：强烈建议使用 `microsandbox` 后端（硬件级隔离）
2. **subprocess 后端**：仅适用于开发和测试，不提供强隔离
3. **网络访问**：默认禁用，按需启用
4. **资源限制**：合理配置 CPU、内存限制，防止资源耗尽

## 相关文档

- [Sandbox 模块详细文档](../../docs/sandbox_README.md)
- [Sandbox 架构设计文档](../../docs/adr/ADR-001-sandbox-system.md)
- [Sandbox 模块代码摘要](../../conclusions/sandbox_module_conclusion.md)
- [使用示例](../../examples/agenticx-for-sandbox/README.md)

## 许可证

与 AgenticX 项目相同。
