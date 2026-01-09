"""
AgenticX Sandbox Base

沙箱系统的抽象基类，定义所有沙箱实现必须遵循的接口契约。

设计原则（来自 AgentRun-SDK-Python 研究）：
1. 配置与实例分离：Template 定义配置，Sandbox 是运行实例
2. 生命周期托管：通过 Context Manager 确保资源回收
3. 同步/异步双接口：几乎所有方法都提供双接口
4. 厂商中立：不依赖特定云服务
"""

from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List, TypeVar, Generic, Union
import asyncio
import time
import logging

from .types import (
    SandboxType,
    SandboxStatus,
    ExecutionResult,
    HealthStatus,
    FileInfo,
    ProcessInfo,
    SandboxError,
    SandboxTimeoutError,
    SandboxNotReadyError,
    SandboxBackendError,
    CodeLanguage,
)
from .template import SandboxTemplate

logger = logging.getLogger(__name__)

T = TypeVar("T", bound="SandboxBase")


class SandboxBase(ABC):
    """
    沙箱抽象基类
    
    定义所有沙箱实现必须遵循的接口契约。
    支持上下文管理器模式，确保资源正确释放。
    
    Example:
        >>> async with Sandbox.create(type=SandboxType.CODE_INTERPRETER) as sb:
        ...     result = await sb.execute("print('Hello')")
        ...     print(result.stdout)
    """
    
    def __init__(
        self,
        sandbox_id: Optional[str] = None,
        template: Optional[SandboxTemplate] = None,
        **kwargs,
    ):
        """
        初始化沙箱
        
        Args:
            sandbox_id: 沙箱唯一标识，None 则自动生成
            template: 沙箱配置模板
            **kwargs: 额外配置参数
        """
        self._sandbox_id = sandbox_id or self._generate_id()
        self._template = template or SandboxTemplate(name="default")
        self._status = SandboxStatus.PENDING
        self._created_at: Optional[float] = None
        self._last_activity: Optional[float] = None
        self._extra_config = kwargs
    
    @staticmethod
    def _generate_id() -> str:
        """生成唯一沙箱 ID"""
        import uuid
        return f"sb-{uuid.uuid4().hex[:12]}"
    
    @property
    def sandbox_id(self) -> str:
        """沙箱 ID"""
        return self._sandbox_id
    
    @property
    def template(self) -> SandboxTemplate:
        """沙箱模板"""
        return self._template
    
    @property
    def status(self) -> SandboxStatus:
        """当前状态"""
        return self._status
    
    @property
    def is_running(self) -> bool:
        """是否正在运行"""
        return self._status == SandboxStatus.RUNNING
    
    # ==================== 生命周期方法 ====================
    
    @abstractmethod
    async def start(self) -> None:
        """
        启动沙箱
        
        子类必须实现此方法以启动沙箱实例。
        """
        pass
    
    @abstractmethod
    async def stop(self) -> None:
        """
        停止沙箱
        
        子类必须实现此方法以停止沙箱实例。
        """
        pass
    
    async def restart(self) -> None:
        """
        重启沙箱
        """
        await self.stop()
        await self.start()
    
    # ==================== 代码执行 ====================
    
    @abstractmethod
    async def execute(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None,
        **kwargs,
    ) -> ExecutionResult:
        """
        执行代码
        
        Args:
            code: 要执行的代码
            language: 代码语言，默认 Python
            timeout: 执行超时（秒），None 则使用模板默认值
            **kwargs: 额外参数
            
        Returns:
            ExecutionResult: 执行结果
            
        Raises:
            SandboxTimeoutError: 执行超时
            SandboxExecutionError: 执行错误
            SandboxNotReadyError: 沙箱未就绪
        """
        pass
    
    def execute_sync(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None,
        **kwargs,
    ) -> ExecutionResult:
        """
        同步执行代码
        
        异步方法的同步包装器。
        """
        return asyncio.get_event_loop().run_until_complete(
            self.execute(code, language, timeout, **kwargs)
        )
    
    # ==================== 健康检查 ====================
    
    @abstractmethod
    async def check_health(self) -> HealthStatus:
        """
        检查沙箱健康状态
        
        Returns:
            HealthStatus: 健康状态
        """
        pass
    
    async def wait_ready(
        self,
        timeout: int = 60,
        poll_interval: float = 0.5,
        max_poll_interval: float = 5.0,
    ) -> None:
        """
        等待沙箱就绪
        
        使用指数退避策略轮询健康状态。
        
        Args:
            timeout: 最大等待时间（秒）
            poll_interval: 初始轮询间隔（秒）
            max_poll_interval: 最大轮询间隔（秒）
            
        Raises:
            SandboxTimeoutError: 等待超时
        """
        start_time = time.time()
        current_interval = poll_interval
        
        while time.time() - start_time < timeout:
            try:
                health = await self.check_health()
                if health.is_healthy:
                    logger.debug(f"Sandbox {self.sandbox_id} is ready")
                    return
            except Exception as e:
                logger.debug(f"Health check failed: {e}")
            
            await asyncio.sleep(current_interval)
            # 指数退避
            current_interval = min(current_interval * 1.5, max_poll_interval)
        
        raise SandboxTimeoutError(
            f"Sandbox {self.sandbox_id} not ready after {timeout}s",
            timeout=timeout,
        )
    
    # ==================== 上下文管理器 ====================
    
    async def __aenter__(self: T) -> T:
        """异步上下文管理器入口"""
        await self.start()
        await self.wait_ready(timeout=self._template.startup_timeout_seconds)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """异步上下文管理器退出"""
        try:
            await self.stop()
        except Exception as e:
            logger.warning(f"Error stopping sandbox {self.sandbox_id}: {e}")
    
    def __enter__(self: T) -> T:
        """同步上下文管理器入口"""
        asyncio.get_event_loop().run_until_complete(self.__aenter__())
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """同步上下文管理器退出"""
        asyncio.get_event_loop().run_until_complete(
            self.__aexit__(exc_type, exc_val, exc_tb)
        )
    
    # ==================== 文件操作（可选实现）====================
    
    async def read_file(self, path: str) -> str:
        """
        读取文件内容
        
        Args:
            path: 文件路径
            
        Returns:
            文件内容
        """
        raise NotImplementedError("File operations not supported by this sandbox")
    
    async def write_file(self, path: str, content: Union[str, bytes]) -> None:
        """
        写入文件
        
        Args:
            path: 文件路径
            content: 文件内容
        """
        raise NotImplementedError("File operations not supported by this sandbox")
    
    async def list_directory(self, path: str = "/") -> List[FileInfo]:
        """
        列出目录内容
        
        Args:
            path: 目录路径
            
        Returns:
            文件信息列表
        """
        raise NotImplementedError("File operations not supported by this sandbox")
    
    async def delete_file(self, path: str) -> None:
        """
        删除文件
        
        Args:
            path: 文件路径
        """
        raise NotImplementedError("File operations not supported by this sandbox")
    
    # ==================== 进程操作（可选实现）====================
    
    async def run_command(
        self,
        command: str,
        timeout: Optional[int] = None,
    ) -> ExecutionResult:
        """
        运行 Shell 命令
        
        Args:
            command: Shell 命令
            timeout: 超时时间
            
        Returns:
            执行结果
        """
        raise NotImplementedError("Process operations not supported by this sandbox")
    
    async def list_processes(self) -> List[ProcessInfo]:
        """
        列出所有进程
        
        Returns:
            进程信息列表
        """
        raise NotImplementedError("Process operations not supported by this sandbox")
    
    async def kill_process(self, pid: int) -> None:
        """
        终止进程
        
        Args:
            pid: 进程 ID
        """
        raise NotImplementedError("Process operations not supported by this sandbox")
    
    # ==================== 辅助方法 ====================
    
    def _update_activity(self) -> None:
        """更新最后活动时间"""
        self._last_activity = time.time()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "sandbox_id": self._sandbox_id,
            "status": self._status.value,
            "template": self._template.to_dict(),
            "created_at": self._created_at,
            "last_activity": self._last_activity,
        }
    
    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self._sandbox_id} status={self._status.value}>"


class Sandbox:
    """
    沙箱工厂类
    
    提供统一的沙箱创建接口，根据配置自动选择后端。
    
    Example:
        >>> async with Sandbox.create(type=SandboxType.CODE_INTERPRETER) as sb:
        ...     result = await sb.execute("print('Hello')")
    """
    
    @classmethod
    def create(
        cls,
        type: SandboxType = SandboxType.CODE_INTERPRETER,
        template: Optional[SandboxTemplate] = None,
        template_name: Optional[str] = None,
        backend: str = "auto",
        **kwargs,
    ) -> SandboxBase:
        """
        创建沙箱实例
        
        Args:
            type: 沙箱类型
            template: 沙箱模板
            template_name: 模板名称（从文件加载）
            backend: 后端选择
            **kwargs: 额外参数
            
        Returns:
            沙箱实例
        """
        # 加载或创建模板
        if template is None:
            if template_name:
                template = SandboxTemplate.load(template_name)
            else:
                template = SandboxTemplate(name="default", type=type)
        
        # 确定后端
        actual_backend = backend if backend != "auto" else template.backend
        if actual_backend == "auto":
            actual_backend = cls._select_backend()
        
        # 创建沙箱实例
        return cls._create_sandbox(actual_backend, template, **kwargs)
    
    @classmethod
    def _select_backend(cls) -> str:
        """
        自动选择最佳后端
        
        优先级：microsandbox > docker > subprocess
        """
        # 检查 microsandbox
        if cls._is_microsandbox_available():
            return "microsandbox"
        
        # 检查 docker
        if cls._is_docker_available():
            return "docker"
        
        # 降级到 subprocess
        logger.warning("No isolation backend available, using subprocess (less secure)")
        return "subprocess"
    
    @classmethod
    def _is_microsandbox_available(cls) -> bool:
        """检查 microsandbox 是否可用（需要 msbserver 和后端模块）"""
        try:
            import shutil
            if shutil.which("msbserver") is None:
                return False
            # 检查后端模块是否存在
            from .backends.microsandbox import MicrosandboxSandbox
            return True
        except ImportError:
            return False
        except Exception:
            return False
    
    @classmethod
    def _is_docker_available(cls) -> bool:
        """检查 docker 是否可用（需要 docker 命令和后端模块）"""
        try:
            import shutil
            if shutil.which("docker") is None:
                return False
            # 检查后端模块是否存在
            from .backends.docker import DockerSandbox
            return True
        except ImportError:
            return False
        except Exception:
            return False
    
    @classmethod
    def _create_sandbox(
        cls,
        backend: str,
        template: SandboxTemplate,
        **kwargs,
    ) -> SandboxBase:
        """
        根据后端创建沙箱实例
        """
        if backend == "subprocess":
            from .backends.subprocess import SubprocessSandbox
            return SubprocessSandbox(template=template, **kwargs)
        
        elif backend == "microsandbox":
            try:
                from .backends.microsandbox import MicrosandboxSandbox
                return MicrosandboxSandbox(template=template, **kwargs)
            except ImportError:
                raise SandboxBackendError(
                    "Microsandbox backend not available. Install with: pip install microsandbox",
                    backend="microsandbox"
                )
        
        elif backend == "docker":
            try:
                from .backends.docker import DockerSandbox
                return DockerSandbox(template=template, **kwargs)
            except ImportError:
                raise SandboxBackendError(
                    "Docker backend not available yet",
                    backend="docker"
                )
        
        else:
            raise ValueError(f"Unknown backend: {backend}")
