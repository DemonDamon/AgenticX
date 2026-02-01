"""
AgenticX Microsandbox Backend

基于 Microsandbox 的硬件级隔离沙箱后端，提供强安全隔离。

Microsandbox 是一个使用 libkrun 的轻量级虚拟机沙箱，提供:
- 硬件级隔离（基于 KVM/Hypervisor）
- 快速启动（毫秒级）
- 资源限制（CPU、内存、磁盘）
- 网络隔离

前置条件：
- pip install microsandbox
- Linux with KVM support, or macOS with Hypervisor.framework

参考: https://github.com/ArcadeLabsInc/microsandbox
"""

import asyncio
import time
import logging
from typing import Optional, Dict, Any, List

from ..base import SandboxBase
from ..types import (
    SandboxStatus,
    ExecutionResult,
    HealthStatus,
    FileInfo,
    ProcessInfo,
    SandboxTimeoutError,
    SandboxExecutionError,
    SandboxNotReadyError,
    SandboxBackendError,
)
from ..template import SandboxTemplate

logger = logging.getLogger(__name__)

# 尝试导入 microsandbox
try:
    import microsandbox
    from microsandbox import Sandbox as MsbSandbox
    MICROSANDBOX_AVAILABLE = True
except ImportError:
    MICROSANDBOX_AVAILABLE = False
    MsbSandbox = None


class MicrosandboxSandbox(SandboxBase):
    """
    基于 Microsandbox 的硬件级隔离沙箱
    
    提供真正的虚拟机级别隔离，适合执行不可信代码。
    
    Example:
        >>> async with MicrosandboxSandbox() as sb:
        ...     result = await sb.execute("print('Secure execution!')")
        ...     print(result.stdout)
        Secure execution!
    
    Note:
        需要安装 microsandbox: pip install microsandbox
        需要 Linux KVM 或 macOS Hypervisor.framework 支持
    """
    
    def __init__(
        self,
        sandbox_id: Optional[str] = None,
        template: Optional[SandboxTemplate] = None,
        server_url: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs,
    ):
        """
        初始化 Microsandbox 沙箱
        
        Args:
            sandbox_id: 沙箱 ID
            template: 沙箱模板
            server_url: Microsandbox 服务器 URL（可选）
            api_key: API 密钥（可选）
            **kwargs: 额外参数
        """
        if not MICROSANDBOX_AVAILABLE:
            raise SandboxBackendError(
                "Microsandbox is not installed. Install with: pip install microsandbox",
                backend="microsandbox"
            )
        
        super().__init__(sandbox_id=sandbox_id, template=template, **kwargs)
        
        self._server_url = server_url
        self._api_key = api_key
        self._msb_sandbox: Optional[MsbSandbox] = None
        self._session_id: Optional[str] = None
    
    async def start(self) -> None:
        """
        启动 Microsandbox 沙箱
        
        连接到 Microsandbox 服务器并创建沙箱实例。
        """
        if self._status == SandboxStatus.RUNNING:
            logger.debug(f"Microsandbox {self.sandbox_id} is already running")
            return
        
        self._status = SandboxStatus.CREATING
        logger.info(f"Starting Microsandbox sandbox {self.sandbox_id}")
        
        try:
            # 创建 Microsandbox 实例
            # 使用 microsandbox SDK 的 API
            self._msb_sandbox = MsbSandbox(
                name=self.sandbox_id,
                cpu=self._template.cpu,
                memory=f"{self._template.memory_mb}M",
            )
            
            # 启动沙箱
            await self._msb_sandbox.start()
            
            self._status = SandboxStatus.RUNNING
            self._created_at = time.time()
            logger.info(f"Microsandbox {self.sandbox_id} started successfully")
            
        except Exception as e:
            self._status = SandboxStatus.ERROR
            logger.error(f"Failed to start Microsandbox {self.sandbox_id}: {e}")
            raise SandboxBackendError(
                f"Failed to start Microsandbox: {e}",
                backend="microsandbox"
            )
    
    async def stop(self) -> None:
        """
        停止 Microsandbox 沙箱
        
        销毁沙箱实例并释放资源。
        """
        if self._status == SandboxStatus.STOPPED:
            return
        
        self._status = SandboxStatus.STOPPING
        logger.info(f"Stopping Microsandbox {self.sandbox_id}")
        
        try:
            if self._msb_sandbox:
                await self._msb_sandbox.stop()
                self._msb_sandbox = None
            
            self._status = SandboxStatus.STOPPED
            logger.info(f"Microsandbox {self.sandbox_id} stopped")
            
        except Exception as e:
            logger.warning(f"Error stopping Microsandbox {self.sandbox_id}: {e}")
            self._status = SandboxStatus.STOPPED
    
    async def execute(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None,
        **kwargs,
    ) -> ExecutionResult:
        """
        在 Microsandbox 中执行代码
        
        Args:
            code: 要执行的代码
            language: 代码语言
            timeout: 执行超时（秒）
            **kwargs: 额外参数
            
        Returns:
            ExecutionResult: 执行结果
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError(f"Microsandbox {self.sandbox_id} is not running")
        
        self._update_activity()
        actual_timeout = timeout or self._template.timeout_seconds
        start_time = time.time()
        
        try:
            # 使用 Microsandbox SDK 执行代码
            if language.lower() in ("python", "py"):
                result = await asyncio.wait_for(
                    self._execute_python(code),
                    timeout=actual_timeout,
                )
            elif language.lower() in ("shell", "bash", "sh"):
                result = await asyncio.wait_for(
                    self._execute_shell(code),
                    timeout=actual_timeout,
                )
            else:
                raise ValueError(f"Unsupported language: {language}")
            
            duration_ms = (time.time() - start_time) * 1000
            result.duration_ms = duration_ms
            result.language = language
            
            return result
            
        except asyncio.TimeoutError:
            raise SandboxTimeoutError(
                f"Execution timed out after {actual_timeout}s",
                timeout=actual_timeout,
            )
        except Exception as e:
            raise SandboxExecutionError(
                f"Execution failed: {e}",
                exit_code=1,
                stderr=str(e),
            )
    
    async def _execute_python(self, code: str) -> ExecutionResult:
        """执行 Python 代码"""
        try:
            # 使用 microsandbox 的 Python 执行接口
            response = await self._msb_sandbox.run_python(code)
            
            return ExecutionResult(
                stdout=response.get("stdout", ""),
                stderr=response.get("stderr", ""),
                exit_code=response.get("exit_code", 0),
                success=response.get("exit_code", 0) == 0,
            )
        except AttributeError:
            # 如果 SDK 不支持 run_python，使用通用 run 方法
            response = await self._msb_sandbox.run(f"python3 -c '{code}'")
            return ExecutionResult(
                stdout=response.get("stdout", ""),
                stderr=response.get("stderr", ""),
                exit_code=response.get("exit_code", 0),
                success=response.get("exit_code", 0) == 0,
            )
    
    async def _execute_shell(self, command: str) -> ExecutionResult:
        """执行 Shell 命令"""
        response = await self._msb_sandbox.run(command)
        
        return ExecutionResult(
            stdout=response.get("stdout", ""),
            stderr=response.get("stderr", ""),
            exit_code=response.get("exit_code", 0),
            success=response.get("exit_code", 0) == 0,
        )
    
    async def check_health(self) -> HealthStatus:
        """
        检查 Microsandbox 健康状态
        """
        start_time = time.time()
        
        if self._status != SandboxStatus.RUNNING:
            return HealthStatus(
                status="unhealthy",
                message=f"Sandbox is not running (status: {self._status.value})",
            )
        
        try:
            # 执行简单的健康检查
            result = await self.execute("print('ok')", language="python", timeout=5)
            latency_ms = (time.time() - start_time) * 1000
            
            if result.success and "ok" in result.stdout:
                return HealthStatus(
                    status="ok",
                    message="Microsandbox is healthy",
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
        """读取沙箱中的文件"""
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        result = await self.execute(f"cat '{path}'", language="shell")
        if not result.success:
            raise FileNotFoundError(f"File not found: {path}")
        return result.stdout
    
    async def write_file(self, path: str, content: str) -> None:
        """写入文件到沙箱"""
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 heredoc 写入文件
        escaped_content = content.replace("'", "'\\''")
        await self.execute(
            f"cat > '{path}' << 'AGENTICX_EOF'\n{content}\nAGENTICX_EOF",
            language="shell"
        )
    
    async def list_directory(self, path: str = "/") -> List[FileInfo]:
        """列出目录内容"""
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        result = await self.execute(
            f"ls -la '{path}' | tail -n +2",
            language="shell"
        )
        
        if not result.success:
            raise FileNotFoundError(f"Directory not found: {path}")
        
        files = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split()
            if len(parts) >= 9:
                is_dir = parts[0].startswith("d")
                name = " ".join(parts[8:])
                size = int(parts[4]) if parts[4].isdigit() else 0
                files.append(FileInfo(
                    path=f"{path.rstrip('/')}/{name}",
                    size=size,
                    is_dir=is_dir,
                    permissions=parts[0],
                ))
        
        return files
    
    async def delete_file(self, path: str) -> None:
        """删除文件"""
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        await self.execute(f"rm -rf '{path}'", language="shell")
    
    async def run_command(
        self,
        command: str,
        timeout: Optional[int] = None,
    ) -> ExecutionResult:
        """运行 Shell 命令"""
        return await self.execute(command, language="shell", timeout=timeout)
    
    async def list_processes(self) -> List[ProcessInfo]:
        """
        列出沙箱中的进程
        
        Returns:
            进程信息列表
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 ps 命令获取进程列表
        result = await self.execute(
            "ps aux --no-headers 2>/dev/null || ps aux | tail -n +2",
            language="shell",
            timeout=10,
        )
        
        processes = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split(None, 10)
            if len(parts) >= 11:
                try:
                    pid = int(parts[1])
                    cpu_percent = float(parts[2])
                    mem_percent = float(parts[3])
                    command = parts[10]
                    processes.append(ProcessInfo(
                        pid=pid,
                        command=command,
                        status="running",
                        cpu_percent=cpu_percent,
                        memory_mb=mem_percent,
                    ))
                except (ValueError, IndexError):
                    continue
        
        return processes
    
    async def kill_process(self, pid: int, signal: int = 15) -> None:
        """
        终止进程
        
        Args:
            pid: 进程 ID
            signal: 信号（默认 SIGTERM=15）
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        result = await self.execute(f"kill -{signal} {pid}", language="shell")
        if not result.success:
            logger.warning(f"Failed to kill process {pid}: {result.stderr}")


def is_microsandbox_available() -> bool:
    """检查 Microsandbox 是否可用"""
    return MICROSANDBOX_AVAILABLE
