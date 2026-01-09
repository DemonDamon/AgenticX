"""
AgenticX Code Interpreter Sandbox

提供代码解释器沙箱的高级 API，支持：
- 自动后端选择
- 会话状态管理
- 健康检查与重试
- 上下文管理器

Example:
    >>> from agenticx.sandbox import CodeInterpreterSandbox
    >>> 
    >>> async with CodeInterpreterSandbox() as interpreter:
    ...     result = await interpreter.run("x = 1 + 1")
    ...     result = await interpreter.run("print(x)")  # 输出: 2
"""

import asyncio
import time
import logging
from typing import Optional, Dict, Any, List, TypeVar
from contextlib import asynccontextmanager

from .base import Sandbox, SandboxBase
from .types import (
    SandboxType,
    SandboxStatus,
    ExecutionResult,
    HealthStatus,
    SandboxError,
    SandboxTimeoutError,
    SandboxNotReadyError,
    CodeLanguage,
)
from .template import SandboxTemplate

logger = logging.getLogger(__name__)

T = TypeVar("T", bound="CodeInterpreterSandbox")


class CodeInterpreterSandbox:
    """
    代码解释器沙箱
    
    提供交互式代码执行环境，支持会话状态保持。
    
    特点：
    - 自动后端选择（优先使用最安全的可用后端）
    - 健康检查与自动重启
    - 指数退避重试
    - 执行历史追踪
    
    Example:
        >>> async with CodeInterpreterSandbox() as interpreter:
        ...     # 执行代码并保持状态
        ...     await interpreter.run("import pandas as pd")
        ...     await interpreter.run("df = pd.DataFrame({'a': [1,2,3]})")
        ...     result = await interpreter.run("print(df.sum())")
    """
    
    DEFAULT_HEALTH_CHECK_INTERVAL = 30  # 秒
    MAX_RETRIES = 3
    
    def __init__(
        self,
        template: Optional[SandboxTemplate] = None,
        template_name: Optional[str] = None,
        backend: str = "auto",
        auto_restart: bool = True,
        health_check_interval: Optional[int] = None,
        **kwargs,
    ):
        """
        初始化代码解释器
        
        Args:
            template: 沙箱模板
            template_name: 预定义模板名称
            backend: 后端选择 ("auto", "subprocess", "microsandbox", "docker")
            auto_restart: 是否自动重启失败的沙箱
            health_check_interval: 健康检查间隔（秒）
            **kwargs: 传递给后端的额外参数
        """
        self._template = template
        self._template_name = template_name
        self._backend = backend
        self._auto_restart = auto_restart
        self._health_check_interval = health_check_interval or self.DEFAULT_HEALTH_CHECK_INTERVAL
        self._kwargs = kwargs
        
        # 内部状态
        self._sandbox: Optional[SandboxBase] = None
        self._session_vars: Dict[str, Any] = {}
        self._execution_history: List[ExecutionResult] = []
        self._startup_time: Optional[float] = None
        self._last_health_check: Optional[float] = None
        self._is_initialized = False
    
    @property
    def sandbox(self) -> Optional[SandboxBase]:
        """底层沙箱实例"""
        return self._sandbox
    
    @property
    def is_ready(self) -> bool:
        """是否就绪"""
        return (
            self._sandbox is not None 
            and self._sandbox.status == SandboxStatus.RUNNING
        )
    
    @property
    def execution_count(self) -> int:
        """执行次数"""
        return len(self._execution_history)
    
    @property
    def execution_history(self) -> List[ExecutionResult]:
        """执行历史"""
        return self._execution_history.copy()
    
    @property
    def uptime_seconds(self) -> float:
        """运行时间（秒）"""
        if self._startup_time is None:
            return 0.0
        return time.time() - self._startup_time
    
    async def start(self) -> None:
        """
        启动代码解释器
        
        创建并初始化底层沙箱。
        """
        if self._is_initialized:
            logger.debug("CodeInterpreterSandbox already initialized")
            return
        
        logger.info("Starting CodeInterpreterSandbox...")
        
        # 创建沙箱
        self._sandbox = Sandbox.create(
            type=SandboxType.CODE_INTERPRETER,
            template=self._template,
            template_name=self._template_name,
            backend=self._backend,
            **self._kwargs,
        )
        
        # 启动沙箱
        await self._sandbox.start()
        
        # 等待就绪（带健康检查）
        await self._wait_until_ready()
        
        self._startup_time = time.time()
        self._is_initialized = True
        logger.info(f"CodeInterpreterSandbox started with backend: {self._backend}")
    
    async def stop(self) -> None:
        """
        停止代码解释器
        
        清理沙箱资源。
        """
        if self._sandbox:
            logger.info("Stopping CodeInterpreterSandbox...")
            await self._sandbox.stop()
            self._sandbox = None
        
        self._is_initialized = False
        self._startup_time = None
        logger.info("CodeInterpreterSandbox stopped")
    
    async def restart(self) -> None:
        """
        重启代码解释器
        
        停止并重新启动沙箱。
        """
        logger.info("Restarting CodeInterpreterSandbox...")
        await self.stop()
        await self.start()
    
    async def run(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None,
        retry: bool = True,
    ) -> ExecutionResult:
        """
        执行代码
        
        Args:
            code: 要执行的代码
            language: 代码语言 (python, shell)
            timeout: 执行超时（秒）
            retry: 失败时是否重试
            
        Returns:
            ExecutionResult: 执行结果
            
        Raises:
            SandboxNotReadyError: 沙箱未就绪
            SandboxTimeoutError: 执行超时
        """
        if not self.is_ready:
            if self._auto_restart:
                await self.start()
            else:
                raise SandboxNotReadyError("CodeInterpreterSandbox is not ready")
        
        # 执行代码（带重试）
        last_error: Optional[Exception] = None
        retries = self.MAX_RETRIES if retry else 1
        
        for attempt in range(retries):
            try:
                result = await self._sandbox.execute(
                    code=code,
                    language=language,
                    timeout=timeout,
                )
                
                # 记录执行历史
                self._execution_history.append(result)
                
                return result
                
            except SandboxTimeoutError:
                # 超时不重试
                raise
            except Exception as e:
                last_error = e
                logger.warning(
                    f"Execution attempt {attempt + 1}/{retries} failed: {e}"
                )
                
                if attempt < retries - 1:
                    # 指数退避
                    delay = (2 ** attempt) * 0.5
                    await asyncio.sleep(delay)
                    
                    # 尝试重启沙箱
                    if self._auto_restart:
                        try:
                            await self.restart()
                        except Exception as restart_error:
                            logger.error(f"Failed to restart sandbox: {restart_error}")
        
        # 所有重试都失败
        raise last_error or SandboxError("Execution failed after all retries")
    
    async def run_python(self, code: str, timeout: Optional[int] = None) -> ExecutionResult:
        """执行 Python 代码的便捷方法"""
        return await self.run(code, language="python", timeout=timeout)
    
    async def run_shell(self, command: str, timeout: Optional[int] = None) -> ExecutionResult:
        """执行 Shell 命令的便捷方法"""
        return await self.run(command, language="shell", timeout=timeout)
    
    async def health_check(self) -> HealthStatus:
        """
        执行健康检查
        
        Returns:
            HealthStatus: 健康状态
        """
        if not self._sandbox:
            return HealthStatus(
                status="unhealthy",
                message="Sandbox not initialized",
            )
        
        health = await self._sandbox.check_health()
        self._last_health_check = time.time()
        return health
    
    async def read_file(self, path: str) -> str:
        """读取沙箱中的文件"""
        if not self.is_ready:
            raise SandboxNotReadyError("CodeInterpreterSandbox is not ready")
        return await self._sandbox.read_file(path)
    
    async def write_file(self, path: str, content: str) -> None:
        """写入文件到沙箱"""
        if not self.is_ready:
            raise SandboxNotReadyError("CodeInterpreterSandbox is not ready")
        await self._sandbox.write_file(path, content)
    
    async def _wait_until_ready(
        self,
        timeout: int = 60,
        check_interval: float = 0.5,
    ) -> None:
        """
        等待沙箱就绪
        
        使用指数退避进行健康检查。
        
        Args:
            timeout: 最大等待时间（秒）
            check_interval: 初始检查间隔（秒）
        """
        start_time = time.time()
        current_interval = check_interval
        max_interval = 5.0
        
        while time.time() - start_time < timeout:
            try:
                health = await self._sandbox.check_health()
                if health.status == "ok":
                    logger.debug("Sandbox is ready")
                    return
                logger.debug(f"Sandbox not ready: {health.message}")
            except Exception as e:
                logger.debug(f"Health check failed: {e}")
            
            # 指数退避
            await asyncio.sleep(current_interval)
            current_interval = min(current_interval * 1.5, max_interval)
        
        raise SandboxTimeoutError(
            f"Sandbox did not become ready within {timeout}s",
            timeout=timeout,
        )
    
    async def __aenter__(self: T) -> T:
        """进入上下文管理器"""
        await self.start()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """退出上下文管理器"""
        await self.stop()
    
    def __repr__(self) -> str:
        status = "ready" if self.is_ready else "not_ready"
        return (
            f"CodeInterpreterSandbox("
            f"status={status}, "
            f"backend={self._backend}, "
            f"executions={self.execution_count})"
        )


# 便捷函数
async def execute_code(
    code: str,
    language: str = "python",
    timeout: int = 30,
    backend: str = "auto",
) -> ExecutionResult:
    """
    一次性执行代码
    
    便捷函数，自动创建沙箱、执行代码、清理资源。
    
    Args:
        code: 要执行的代码
        language: 代码语言
        timeout: 执行超时（秒）
        backend: 后端选择
        
    Returns:
        ExecutionResult: 执行结果
        
    Example:
        >>> result = await execute_code("print(1 + 1)")
        >>> print(result.stdout)
        2
    """
    async with CodeInterpreterSandbox(backend=backend) as interpreter:
        return await interpreter.run(code, language=language, timeout=timeout)
