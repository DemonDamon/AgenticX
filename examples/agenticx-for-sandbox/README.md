# AgenticX Sandbox 示例

这是一个 OpenSandbox 风格的示例，展示如何使用 `agenticx/sandbox` 模块实现安全的代码执行环境。

## 简介

AgenticX Sandbox 是一个**客户端库**，提供了类似 OpenSandbox SDK 的 API，支持在隔离环境中执行代码。该模块支持多种后端，从简单的子进程隔离到 Docker 容器和硬件级隔离。

### 与 OpenSandbox 的区别

**OpenSandbox** 是一个完整的服务端平台：
- 包含服务器（Runtime Layer）管理沙箱生命周期
- 包含 execd daemon（Go 实现的 HTTP daemon）注入到容器中
- SDK 只是客户端库，连接到服务器

**我们的模块** 是一个客户端库：
- 直接在本地运行，**无需服务器**
- 支持多种后端（subprocess、docker、microsandbox）
- **microsandbox** 是一个**可选的第三方库**，不是必需依赖

### 主要功能

- 安全的代码执行环境
- 文件操作（读写）
- Shell 命令执行
- Python 代码解释器
- 多后端支持（subprocess、docker、microsandbox）

## 安装和依赖

### 基础依赖

AgenticX Sandbox 模块已经包含在 AgenticX 项目中，无需额外安装。确保你已经安装了 AgenticX 项目的依赖：

```bash
pip install -r requirements.txt
```

### 后端依赖（可选）

AgenticX Sandbox 支持三种后端，每种后端有不同的依赖要求：

#### 1. Subprocess 后端（推荐，默认）

**无需额外安装** - 这是最简单的后端，使用 Python 子进程进行隔离。

- ✅ 无需额外依赖
- ✅ 开箱即用
- ✅ **默认后端**，总是可用
- ⚠️ 隔离级别较低（适合开发和测试）

#### 2. Docker 后端

需要 Docker daemon 运行：

```bash
# 确保 Docker 已安装并运行
docker --version

# 如果 Docker 未运行，启动 Docker Desktop 或 Docker daemon
```

- ✅ 容器级隔离
- ⚠️ 需要 Docker daemon 运行
- ⚠️ 启动时间较长

#### 3. Microsandbox 后端（可选，最安全）

**可选安装** - 这是一个独立的第三方库（https://github.com/zerocore-ai/microsandbox），提供硬件级隔离：

```bash
pip install microsandbox
```

- ✅ 硬件级隔离（基于 KVM/Hypervisor）
- ✅ 快速启动（毫秒级）
- ⚠️ 需要 Linux KVM 或 macOS Hypervisor.framework 支持
- ⚠️ **这是可选的**，不是必需依赖

**重要说明**：
- microsandbox 是一个独立的第三方库，我们只是把它作为一个**可选后端**集成
- **不是必需依赖**：如果你不需要硬件级隔离，完全可以使用 subprocess 后端，无需安装任何额外依赖
- 我们的模块**不依赖** microsandbox，它只是一个可选后端

## 后端选择

### 自动选择（默认）

默认情况下，系统会自动选择最佳可用后端，优先级为：

1. **microsandbox** - 如果已安装 microsandbox（可选）
2. **docker** - 如果 Docker daemon 运行中
3. **subprocess** - **默认选项**（总是可用，无需额外安装）

**推荐**：对于快速开始，直接使用 `backend="subprocess"`，无需安装任何额外依赖。

### 手动指定后端

你可以在代码中明确指定后端：

```python
# 使用 subprocess 后端（推荐用于快速开始）
sandbox = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    backend="subprocess"  # 明确指定后端
)

# 使用 docker 后端
sandbox = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    backend="docker"
)

# 使用 microsandbox 后端（需要先安装 microsandbox）
sandbox = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    backend="microsandbox"
)

# 自动选择（默认）
sandbox = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    backend="auto"  # 或省略此参数
)
```

## 快速开始

### 示例脚本

本目录包含两个主要示例脚本：

| 脚本 | 用途 | 说明 |
|------|------|------|
| `sandbox_demo.py` | 测试后端、验证安装 | 统一的演示脚本，支持多种后端和功能 |
| `opensandbox_style_example.py` | 学习 Sandbox API | OpenSandbox 风格的完整 API 演示 |

### 运行 sandbox_demo.py（推荐）

这是最简单的开始方式，支持自动检测后端和多种运行模式：

```bash
# 自动检测最佳后端，运行完整演示
python examples/agenticx-for-sandbox/sandbox_demo.py

# 指定 subprocess 后端（无需额外安装）
python examples/agenticx-for-sandbox/sandbox_demo.py --backend subprocess

# 指定 microsandbox 后端
python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox

# 验证 microsandbox 安装
python examples/agenticx-for-sandbox/sandbox_demo.py --backend microsandbox --verify

# 只运行基础功能演示
python examples/agenticx-for-sandbox/sandbox_demo.py --basic

# 只运行高级功能演示
python examples/agenticx-for-sandbox/sandbox_demo.py --advanced
```

### 运行 opensandbox_style_example.py

如果你想学习 Sandbox API 的使用方式：

```bash
# 从项目根目录运行
python examples/agenticx-for-sandbox/opensandbox_style_example.py

# 或者进入目录后运行
cd examples/agenticx-for-sandbox
python opensandbox_style_example.py
```

**提示**：如果不想安装额外依赖，可以修改代码使用 `subprocess` 后端：

```python
# 在 Sandbox.create() 中
sandbox = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    template=template,
    backend="subprocess",  # 明确指定 subprocess
)
```

## 常见问题

### 1. Docker daemon 未运行错误

**错误信息：**
```
SandboxBackendError: Docker run failed: docker: Cannot connect to the Docker daemon...
```

**解决方案：**

**方案 A：启动 Docker（如果你想使用 Docker 后端）**
```bash
# macOS: 启动 Docker Desktop
# Linux: 启动 Docker daemon
sudo systemctl start docker
```

**方案 B：使用 subprocess 后端（推荐）**

修改代码，明确指定使用 `subprocess` 后端：

```python
# 在 Sandbox.create() 中
sandbox = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    template=template,
    backend="subprocess",  # 明确指定 subprocess
)

# 在 CodeInterpreterSandbox() 中
interpreter = CodeInterpreterSandbox(backend="subprocess")
```

### 2. Microsandbox 后端不可用

**错误信息：**
```
SandboxBackendError: Microsandbox backend not available...
```

**解决方案：**

**方案 A：安装 microsandbox（如果你想使用硬件级隔离）**
```bash
pip install microsandbox
```

**方案 B：使用其他后端（推荐）**

microsandbox 是**可选的**，不是必需依赖。你可以使用 subprocess 或 docker 后端：

```python
# 使用 subprocess 后端（推荐，无需额外安装）
sandbox = Sandbox.create(
    type=SandboxType.CODE_INTERPRETER,
    backend="subprocess"
)
```

### 3. 文件路径问题

**问题：** 在不同后端之间共享文件

**说明：** `CodeInterpreterSandbox` 创建独立的沙箱实例，文件共享取决于后端和工作目录。使用绝对路径（如 `/tmp/`）可以确保文件在不同沙箱实例间可访问（如果它们运行在同一系统上）。

## API 使用说明

### 基本用法

```python
from agenticx.sandbox import Sandbox, SandboxType

# 创建沙箱
async with Sandbox.create(type=SandboxType.CODE_INTERPRETER) as sandbox:
    # 执行 Shell 命令
    result = await sandbox.run_command("echo 'Hello'")
    print(result.stdout)
    
    # 写入文件
    await sandbox.write_file("/tmp/test.txt", "Hello World")
    
    # 读取文件
    content = await sandbox.read_file("/tmp/test.txt")
    print(content)
    
    # 执行 Python 代码
    result = await sandbox.execute("print('Hello from Python')")
    print(result.stdout)
```

### CodeInterpreterSandbox 用法

```python
from agenticx.sandbox import CodeInterpreterSandbox

# 创建代码解释器（支持状态保持）
async with CodeInterpreterSandbox() as interpreter:
    # 执行代码并保持状态
    await interpreter.run("x = 10")
    await interpreter.run("y = 20")
    result = await interpreter.run("print(x + y)")
    print(result.stdout)  # 输出: 30
```

### 更多示例

**sandbox_demo.py** - 统一的后端演示脚本，包括：
- 自动检测可用后端
- 基本用法演示（代码执行、Shell 命令）
- 高级功能演示（状态化执行、文件操作、资源指标）
- microsandbox 安装验证（通过 `--verify` 参数）

**opensandbox_style_example.py** - 完整的 API 示例，展示：
- 基本沙箱操作
- 文件操作
- 代码执行
- CodeInterpreterSandbox 高级用法

## 后端对比

| 后端 | 隔离级别 | 启动速度 | 依赖要求 | 推荐场景 |
|------|---------|---------|---------|---------|
| **subprocess** | 低 | 快 | **无** | **开发、测试（推荐）** |
| **docker** | 中 | 慢 | Docker daemon | 生产环境 |
| **microsandbox** | 高 | 快 | microsandbox 包（可选） | 高安全要求 |

## 相关文档

- [AgenticX Sandbox 模块文档](../../docs/sandbox_README.md)
- [Sandbox 架构设计文档](../../docs/adr/ADR-001-sandbox-system.md)
- [其他示例](../../examples/sandbox_example.py)
- [OpenSandbox 架构文档](../../research/codedeepresearch/OpenSandbox/upstream/docs/architecture.md)

## 许可证

与 AgenticX 项目相同。
