"""
AgenticX Subprocess Sandbox Backend

基于子进程的简单沙箱后端，提供基本的进程隔离。

特点：
- 无需额外依赖
- 快速启动
- 适合开发和测试环境

限制：
- 隔离级别较低（仅进程级）
- 不适合执行不可信代码

警告：此后端不提供强安全隔离，生产环境请使用 microsandbox 或 docker 后端。
"""

import asyncio
import sys
import os
import time
import tempfile
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path

from ..base import SandboxBase
from ..types import (
    SandboxStatus,
    ExecutionResult,
    HealthStatus,
    FileInfo,
    SandboxTimeoutError,
    SandboxExecutionError,
    SandboxNotReadyError,
    CodeLanguage,
)
from ..template import SandboxTemplate

logger = logging.getLogger(__name__)


class SubprocessSandbox(SandboxBase):
    """
    基于子进程的沙箱实现
    
    使用 asyncio.create_subprocess_exec 创建隔离的子进程执行代码。
    
    Example:
        >>> async with SubprocessSandbox() as sb:
        ...     result = await sb.execute("print('Hello')")
        ...     print(result.stdout)
        Hello
    """
    
    def __init__(
        self,
        sandbox_id: Optional[str] = None,
        template: Optional[SandboxTemplate] = None,
        working_dir: Optional[str] = None,
        **kwargs,
    ):
        """
        初始化子进程沙箱
        
        Args:
            sandbox_id: 沙箱 ID
            template: 沙箱模板
            working_dir: 工作目录，None 则使用临时目录
            **kwargs: 额外参数
        """
        super().__init__(sandbox_id=sandbox_id, template=template, **kwargs)
        
        self._working_dir = working_dir
        self._temp_dir: Optional[tempfile.TemporaryDirectory] = None
        self._python_path = sys.executable
        self._environment: Dict[str, str] = {}
    
    @property
    def working_dir(self) -> str:
        """工作目录"""
        if self._working_dir:
            return self._working_dir
        if self._temp_dir:
            return self._temp_dir.name
        return tempfile.gettempdir()
    
    async def start(self) -> None:
        """
        启动沙箱
        
        创建临时工作目录并准备执行环境。
        """
        if self._status == SandboxStatus.RUNNING:
            logger.debug(f"Sandbox {self.sandbox_id} is already running")
            return
        
        self._status = SandboxStatus.CREATING
        logger.debug(f"Starting subprocess sandbox {self.sandbox_id}")
        
        try:
            # 创建临时工作目录
            if not self._working_dir:
                self._temp_dir = tempfile.TemporaryDirectory(
                    prefix=f"agenticx_sandbox_{self.sandbox_id}_"
                )
            
            # 准备环境变量
            self._environment = os.environ.copy()
            self._environment.update(self._template.environment)
            self._environment["AGENTICX_SANDBOX_ID"] = self.sandbox_id
            
            self._status = SandboxStatus.RUNNING
            self._created_at = time.time()
            logger.info(f"Subprocess sandbox {self.sandbox_id} started")
            
        except Exception as e:
            self._status = SandboxStatus.ERROR
            logger.error(f"Failed to start sandbox {self.sandbox_id}: {e}")
            raise
    
    async def stop(self) -> None:
        """
        停止沙箱
        
        清理临时目录和资源。
        """
        if self._status == SandboxStatus.STOPPED:
            return
        
        self._status = SandboxStatus.STOPPING
        logger.debug(f"Stopping subprocess sandbox {self.sandbox_id}")
        
        try:
            # 清理临时目录
            if self._temp_dir:
                self._temp_dir.cleanup()
                self._temp_dir = None
            
            self._status = SandboxStatus.STOPPED
            logger.info(f"Subprocess sandbox {self.sandbox_id} stopped")
            
        except Exception as e:
            logger.warning(f"Error stopping sandbox {self.sandbox_id}: {e}")
            self._status = SandboxStatus.STOPPED
    
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
            language: 代码语言（当前仅支持 python）
            timeout: 执行超时（秒）
            **kwargs: 额外参数
            
        Returns:
            ExecutionResult: 执行结果
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError(f"Sandbox {self.sandbox_id} is not running")
        
        self._update_activity()
        
        # 确定超时时间
        actual_timeout = timeout or self._template.timeout_seconds
        
        # 根据语言选择执行方式
        if language.lower() in ("python", "py"):
            return await self._execute_python(code, actual_timeout, **kwargs)
        elif language.lower() in ("shell", "bash", "sh"):
            return await self._execute_shell(code, actual_timeout, **kwargs)
        else:
            raise ValueError(f"Unsupported language: {language}")
    
    async def _execute_python(
        self,
        code: str,
        timeout: int,
        **kwargs,
    ) -> ExecutionResult:
        """执行 Python 代码"""
        start_time = time.time()
        
        # 创建临时脚本文件
        script_path = Path(self.working_dir) / f"script_{int(time.time() * 1000)}.py"
        
        try:
            # 写入代码到临时文件
            script_path.write_text(code, encoding="utf-8")
            
            # 创建子进程
            process = await asyncio.create_subprocess_exec(
                self._python_path,
                str(script_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.working_dir,
                env=self._environment,
            )
            
            try:
                # 等待执行完成（带超时）
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout,
                )
                
                duration_ms = (time.time() - start_time) * 1000
                
                return ExecutionResult(
                    stdout=stdout.decode("utf-8", errors="replace"),
                    stderr=stderr.decode("utf-8", errors="replace"),
                    exit_code=process.returncode or 0,
                    success=process.returncode == 0,
                    duration_ms=duration_ms,
                    language="python",
                )
                
            except asyncio.TimeoutError:
                # 超时，终止进程
                process.kill()
                await process.wait()
                raise SandboxTimeoutError(
                    f"Execution timed out after {timeout}s",
                    timeout=timeout,
                )
                
        finally:
            # 清理临时脚本文件
            if script_path.exists():
                try:
                    script_path.unlink()
                except Exception:
                    pass
    
    async def _execute_shell(
        self,
        command: str,
        timeout: int,
        **kwargs,
    ) -> ExecutionResult:
        """执行 Shell 命令"""
        start_time = time.time()
        
        # 创建子进程
        process = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.working_dir,
            env=self._environment,
        )
        
        try:
            # 等待执行完成（带超时）
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout,
            )
            
            duration_ms = (time.time() - start_time) * 1000
            
            return ExecutionResult(
                stdout=stdout.decode("utf-8", errors="replace"),
                stderr=stderr.decode("utf-8", errors="replace"),
                exit_code=process.returncode or 0,
                success=process.returncode == 0,
                duration_ms=duration_ms,
                language="shell",
            )
            
        except asyncio.TimeoutError:
            # 超时，终止进程
            process.kill()
            await process.wait()
            raise SandboxTimeoutError(
                f"Execution timed out after {timeout}s",
                timeout=timeout,
            )
    
    async def check_health(self) -> HealthStatus:
        """
        检查沙箱健康状态
        
        通过执行简单的 Python 代码验证沙箱可用性。
        """
        start_time = time.time()
        
        if self._status != SandboxStatus.RUNNING:
            return HealthStatus(
                status="unhealthy",
                message=f"Sandbox is not running (status: {self._status.value})",
            )
        
        try:
            # 执行简单的健康检查代码
            result = await self.execute(
                "print('health_check_ok')",
                language="python",
                timeout=5,
            )
            
            latency_ms = (time.time() - start_time) * 1000
            
            if result.success and "health_check_ok" in result.stdout:
                return HealthStatus(
                    status="ok",
                    message="Sandbox is healthy",
                    latency_ms=latency_ms,
                )
            else:
                return HealthStatus(
                    status="unhealthy",
                    message=f"Health check failed: {result.stderr}",
                    latency_ms=latency_ms,
                )
                
        except Exception as e:
            return HealthStatus(
                status="unhealthy",
                message=f"Health check error: {str(e)}",
                latency_ms=(time.time() - start_time) * 1000,
            )
    
    async def read_file(self, path: str) -> str:
        """读取文件内容"""
        full_path = Path(self.working_dir) / path.lstrip("/")
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        return full_path.read_text(encoding="utf-8")
    
    async def write_file(self, path: str, content: str) -> None:
        """写入文件"""
        full_path = Path(self.working_dir) / path.lstrip("/")
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")
    
    async def list_directory(self, path: str = "/") -> List[FileInfo]:
        """列出目录内容"""
        full_path = Path(self.working_dir) / path.lstrip("/")
        if not full_path.exists():
            raise FileNotFoundError(f"Directory not found: {path}")
        
        files = []
        for item in full_path.iterdir():
            stat = item.stat()
            files.append(FileInfo(
                path=str(item.relative_to(self.working_dir)),
                size=stat.st_size,
                is_dir=item.is_dir(),
            ))
        return files
    
    async def delete_file(self, path: str) -> None:
        """删除文件"""
        full_path = Path(self.working_dir) / path.lstrip("/")
        if full_path.exists():
            if full_path.is_dir():
                import shutil
                shutil.rmtree(full_path)
            else:
                full_path.unlink()
    
    async def run_command(
        self,
        command: str,
        timeout: Optional[int] = None,
    ) -> ExecutionResult:
        """运行 Shell 命令"""
        return await self.execute(command, language="shell", timeout=timeout)
