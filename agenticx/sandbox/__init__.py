"""
AgenticX Sandbox Module

提供安全的代码执行沙箱系统，支持多后端（subprocess、microsandbox、docker）。

基于 AgentRun-SDK-Python 研究内化，保持厂商中立。

Example:
    >>> from agenticx.sandbox import Sandbox, SandboxType
    >>> 
    >>> async with Sandbox.create(type=SandboxType.CODE_INTERPRETER) as sb:
    ...     result = await sb.execute("print('Hello, AgenticX!')")
    ...     print(result.stdout)
    Hello, AgenticX!
"""

from .types import (
    # 枚举
    SandboxType,
    SandboxStatus,
    CodeLanguage,
    # 数据类
    ExecutionResult,
    HealthStatus,
    FileInfo,
    ProcessInfo,
    # 异常
    SandboxError,
    SandboxTimeoutError,
    SandboxExecutionError,
    SandboxResourceError,
    SandboxNotReadyError,
    SandboxBackendError,
    ExecdConnectionError,
    ExecdExecutionError,
    ExecdTimeoutError,
)

from .template import (
    SandboxTemplate,
    # 预定义模板
    DEFAULT_CODE_INTERPRETER_TEMPLATE,
    LIGHTWEIGHT_TEMPLATE,
    HIGH_PERFORMANCE_TEMPLATE,
)

from .base import (
    SandboxBase,
    Sandbox,
)

from .code_interpreter import (
    CodeInterpreterSandbox,
    execute_code,
)

from .execd import (
    ExecdClient,
    CodeExecutionResult,
    CommandExecutionResult,
    CodeContext,
    FileEntry,
    SupportedLanguage,
    create_execd_client,
    DEFAULT_EXECD_PORT,
)

from .jupyter_kernel import (
    JupyterKernelManager,
    StatefulCodeInterpreter,
    KernelSession,
    JupyterKernelError,
    JupyterKernelNotAvailableError,
    is_jupyter_available,
)

__all__ = [
    # 核心类
    "Sandbox",
    "SandboxBase",
    "SandboxTemplate",
    # execd 客户端
    "ExecdClient",
    "CodeExecutionResult",
    "CommandExecutionResult",
    "CodeContext",
    "FileEntry",
    "SupportedLanguage",
    "create_execd_client",
    "DEFAULT_EXECD_PORT",
    # Jupyter Kernel 状态化执行
    "JupyterKernelManager",
    "StatefulCodeInterpreter",
    "KernelSession",
    "JupyterKernelError",
    "JupyterKernelNotAvailableError",
    "is_jupyter_available",
    # 枚举
    "SandboxType",
    "SandboxStatus",
    "CodeLanguage",
    # 数据类
    "ExecutionResult",
    "HealthStatus",
    "FileInfo",
    "ProcessInfo",
    # 异常
    "SandboxError",
    "SandboxTimeoutError",
    "SandboxExecutionError",
    "SandboxResourceError",
    "SandboxNotReadyError",
    "SandboxBackendError",
    "ExecdConnectionError",
    "ExecdExecutionError",
    "ExecdTimeoutError",
    # 预定义模板
    "DEFAULT_CODE_INTERPRETER_TEMPLATE",
    "LIGHTWEIGHT_TEMPLATE",
    "HIGH_PERFORMANCE_TEMPLATE",
    # 高级 API
    "CodeInterpreterSandbox",
    "execute_code",
]

__version__ = "0.1.0"
