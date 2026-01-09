"""
AgenticX Sandbox Types

定义沙箱系统的核心类型和数据模型。

基于 AgentRun-SDK-Python 研究内化，保持厂商中立。
"""

from enum import Enum
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime


class SandboxType(str, Enum):
    """沙箱类型枚举"""
    
    CODE_INTERPRETER = "code_interpreter"
    """代码解释器沙箱 - 支持 Python 代码执行"""
    
    BROWSER = "browser"
    """浏览器沙箱 - 支持 Web 自动化 (P1)"""
    
    AIO = "aio"
    """All-in-One 沙箱 - 组合多种能力"""


class SandboxStatus(str, Enum):
    """沙箱状态枚举"""
    
    PENDING = "pending"
    """等待创建"""
    
    CREATING = "creating"
    """正在创建"""
    
    RUNNING = "running"
    """运行中"""
    
    STOPPING = "stopping"
    """正在停止"""
    
    STOPPED = "stopped"
    """已停止"""
    
    ERROR = "error"
    """错误状态"""


class CodeLanguage(str, Enum):
    """支持的代码语言"""
    
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    SHELL = "shell"
    BASH = "bash"


@dataclass
class ExecutionResult:
    """
    代码执行结果
    
    封装沙箱代码执行的完整结果，包括输出、错误和元数据。
    """
    
    stdout: str = ""
    """标准输出"""
    
    stderr: str = ""
    """标准错误"""
    
    exit_code: int = 0
    """退出码，0 表示成功"""
    
    success: bool = True
    """是否成功执行"""
    
    duration_ms: float = 0.0
    """执行耗时（毫秒）"""
    
    language: str = "python"
    """执行的代码语言"""
    
    truncated: bool = False
    """输出是否被截断"""
    
    metadata: Dict[str, Any] = field(default_factory=dict)
    """额外元数据"""
    
    @property
    def output(self) -> str:
        """获取主要输出（优先 stdout，其次 stderr）"""
        return self.stdout if self.stdout else self.stderr
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "stdout": self.stdout,
            "stderr": self.stderr,
            "exit_code": self.exit_code,
            "success": self.success,
            "duration_ms": self.duration_ms,
            "language": self.language,
            "truncated": self.truncated,
            "metadata": self.metadata,
        }


@dataclass
class HealthStatus:
    """
    沙箱健康状态
    """
    
    status: str = "unknown"
    """状态：ok, unhealthy, unknown"""
    
    message: str = ""
    """状态消息"""
    
    latency_ms: float = 0.0
    """健康检查延迟（毫秒）"""
    
    checked_at: datetime = field(default_factory=datetime.now)
    """检查时间"""
    
    @property
    def is_healthy(self) -> bool:
        """是否健康"""
        return self.status == "ok"


@dataclass
class FileInfo:
    """
    文件信息
    """
    
    path: str
    """文件路径"""
    
    size: int = 0
    """文件大小（字节）"""
    
    is_dir: bool = False
    """是否为目录"""
    
    modified_at: Optional[datetime] = None
    """修改时间"""
    
    permissions: str = ""
    """权限字符串"""


@dataclass
class ProcessInfo:
    """
    进程信息
    """
    
    pid: int
    """进程 ID"""
    
    command: str
    """命令"""
    
    status: str = "running"
    """状态"""
    
    cpu_percent: float = 0.0
    """CPU 使用率"""
    
    memory_mb: float = 0.0
    """内存使用（MB）"""
    
    started_at: Optional[datetime] = None
    """启动时间"""


class SandboxError(Exception):
    """沙箱基础异常"""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class SandboxTimeoutError(SandboxError):
    """沙箱超时异常"""
    
    def __init__(self, message: str = "Sandbox operation timed out", timeout: float = 0):
        super().__init__(message, {"timeout": timeout})
        self.timeout = timeout


class SandboxExecutionError(SandboxError):
    """沙箱执行错误"""
    
    def __init__(
        self,
        message: str,
        exit_code: int = 1,
        stdout: str = "",
        stderr: str = "",
    ):
        super().__init__(message, {
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
        })
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr


class SandboxResourceError(SandboxError):
    """沙箱资源错误（OOM、磁盘满等）"""
    
    def __init__(self, message: str, resource_type: str = "unknown"):
        super().__init__(message, {"resource_type": resource_type})
        self.resource_type = resource_type


class SandboxNotReadyError(SandboxError):
    """沙箱未就绪错误"""
    pass


class SandboxBackendError(SandboxError):
    """沙箱后端错误"""
    
    def __init__(self, message: str, backend: str = "unknown"):
        super().__init__(message, {"backend": backend})
        self.backend = backend
