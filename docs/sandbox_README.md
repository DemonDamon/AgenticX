# AgenticX 安全沙箱系统

AgenticX 安全沙箱系统提供多层级的代码执行隔离能力，确保 Agent 可以安全地执行不可信代码。

## 核心特性

- **多后端支持**: subprocess（开发）、microsandbox（推荐）、docker（降级）
- **统一 API**: 所有后端使用相同的接口
- **上下文管理器**: 自动资源清理
- **健康检查**: 内置健康检查机制
- **可配置模板**: 预定义和自定义资源配置

## 快速开始

### 基本使用

```python
from agenticx.sandbox import Sandbox, SandboxType

async with Sandbox.create(type=SandboxType.CODE_INTERPRETER) as sb:
    result = await sb.execute("print('Hello, AgenticX!')")
    print(result.stdout)  # 输出: Hello, AgenticX!
```

### 使用 CodeInterpreterSandbox

```python
from agenticx.sandbox import CodeInterpreterSandbox

async with CodeInterpreterSandbox() as interpreter:
    # 执行 Python 代码
    result = await interpreter.run("x = 1 + 1")
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

## 后端选择

### 自动选择（推荐）

```python
# 自动选择最安全的可用后端
sb = Sandbox.create(backend="auto")
```

优先级: microsandbox > docker > subprocess

### 指定后端

```python
# 使用 subprocess 后端（开发环境）
sb = Sandbox.create(backend="subprocess")

# 使用 microsandbox 后端（推荐用于生产）
sb = Sandbox.create(backend="microsandbox")

# 使用 docker 后端（降级方案）
sb = Sandbox.create(backend="docker")
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

# 高性能模板（更多资源，支持网络）
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
    environment={"MY_VAR": "value"},
)

sb = Sandbox.create(template=template)
```

### 保存和加载模板

```python
# 保存模板
template.save()  # 保存到 ~/.agenticx/sandbox/templates/

# 加载模板
loaded = SandboxTemplate.load("my-template")

# 通过名称使用
sb = Sandbox.create(template_name="my-template")
```

## 与 ToolExecutor 集成

```python
from agenticx.tools.executor import ToolExecutor, SandboxConfig

# 配置沙箱
config = SandboxConfig(
    backend="subprocess",
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

## 文件操作

```python
async with CodeInterpreterSandbox() as interpreter:
    # 写入文件
    await interpreter.write_file("data.txt", "Hello World")
    
    # 读取文件
    content = await interpreter.read_file("data.txt")
    print(content)  # 输出: Hello World
```

## 错误处理

```python
from agenticx.sandbox import (
    SandboxError,
    SandboxTimeoutError,
    SandboxExecutionError,
    SandboxNotReadyError,
)

try:
    async with CodeInterpreterSandbox() as interpreter:
        result = await interpreter.run("import time; time.sleep(100)", timeout=5)
except SandboxTimeoutError as e:
    print(f"执行超时: {e.timeout}s")
except SandboxExecutionError as e:
    print(f"执行错误: {e.stderr}")
except SandboxNotReadyError:
    print("沙箱未就绪")
except SandboxError as e:
    print(f"沙箱错误: {e}")
```

## 健康检查

```python
async with CodeInterpreterSandbox() as interpreter:
    health = await interpreter.health_check()
    
    if health.is_healthy:
        print("沙箱健康")
    else:
        print(f"沙箱不健康: {health.message}")
```

## 安全考虑

1. **生产环境**: 强烈建议使用 `microsandbox` 后端
2. **subprocess 后端**: 仅适用于开发和测试，不提供强隔离
3. **网络访问**: 默认禁用，按需启用
4. **资源限制**: 合理配置 CPU、内存限制

## 架构图

```
┌─────────────────────────────────────────┐
│           CodeInterpreterSandbox        │
│  (高级 API, 会话管理, 健康检查)          │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│              Sandbox Factory            │
│      (后端选择, 模板管理)                │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌────▼────┐   ┌────▼────┐
│Subprocess│ │Microsandbox│ │ Docker │
│ Backend │ │  Backend  │ │Backend │
└─────────┘ └───────────┘ └─────────┘
```
