"""
AgenticX Microsandbox Backend

基于 Microsandbox 的硬件级隔离沙箱后端，提供强安全隔离。

Microsandbox 是一个使用 libkrun 的轻量级虚拟机沙箱，提供:
- 硬件级隔离（基于 KVM/Hypervisor）
- 快速启动（毫秒级）
- 资源限制（CPU、内存、磁盘）
- 网络隔离
- 状态化代码执行（通过 namespace 参数）

前置条件：
- pip install microsandbox
- Linux with KVM support, or macOS with Hypervisor.framework
- microsandbox server running (msb server start)

参考: https://github.com/zerocore-ai/microsandbox
"""

import asyncio
import base64
import json
import os
import time
import logging
from typing import Optional, Dict, Any, List, Union

from ..base import SandboxBase
from ..types import (
    SandboxStatus,
    ExecutionResult,
    HealthStatus,
    FileInfo,
    ProcessInfo,
    SandboxError,
    SandboxTimeoutError,
    SandboxExecutionError,
    SandboxNotReadyError,
    SandboxBackendError,
)
from ..template import SandboxTemplate

logger = logging.getLogger(__name__)

# 尝试导入 microsandbox Python SDK
try:
    from microsandbox import PythonSandbox
    MICROSANDBOX_AVAILABLE = True
except ImportError:
    MICROSANDBOX_AVAILABLE = False
    PythonSandbox = None  # type: ignore


class MicrosandboxSandbox(SandboxBase):
    """
    基于 Microsandbox 的硬件级隔离沙箱
    
    提供真正的虚拟机级别隔离，适合执行不可信代码。
    使用 zerocore-ai/microsandbox Python SDK 实现。
    
    Features:
        - 硬件级隔离（microVM）
        - 状态化代码执行（变量跨执行持久化）
        - 资源指标收集（CPU、内存、磁盘）
        - Shell 命令执行
    
    Example:
        >>> async with MicrosandboxSandbox() as sb:
        ...     result = await sb.execute("x = 1 + 1")
        ...     result = await sb.execute("print(x)")  # 状态化执行
        ...     print(result.stdout)
        2
    
    Note:
        需要安装 microsandbox: pip install microsandbox
        需要 Linux KVM 或 macOS Hypervisor.framework 支持
        需要 microsandbox 服务器运行中
    """
    
    def __init__(
        self,
        sandbox_id: Optional[str] = None,
        template: Optional[SandboxTemplate] = None,
        server_url: Optional[str] = None,
        api_key: Optional[str] = None,
        namespace: Optional[str] = None,
        image: Optional[str] = None,
        startup_timeout: float = 300.0,
        **kwargs,
    ):
        """
        初始化 Microsandbox 沙箱
        
        Args:
            sandbox_id: 沙箱 ID（可选，自动生成）
            template: 沙箱模板（定义 CPU、内存等配置）
            server_url: Microsandbox 服务器 URL（可选，默认从 MSB_SERVER_URL 环境变量读取或 http://127.0.0.1:5555）
            api_key: API 密钥（可选，默认从 MSB_API_KEY 环境变量读取）
            namespace: 命名空间，用于状态隔离（可选，默认 "default"）
            image: Docker 镜像（可选，默认 "microsandbox/python"）
            startup_timeout: 启动超时（秒），首次启动需要拉取镜像可能需要较长时间，默认 300 秒
            **kwargs: 额外参数
        """
        if not MICROSANDBOX_AVAILABLE:
            raise SandboxBackendError(
                "Microsandbox is not installed. Install with: pip install microsandbox",
                backend="microsandbox"
            )
        
        super().__init__(sandbox_id=sandbox_id, template=template, **kwargs)
        
        # 配置参数
        self._server_url = server_url or os.environ.get("MSB_SERVER_URL", "http://127.0.0.1:5555")
        self._api_key = api_key or os.environ.get("MSB_API_KEY")
        self._namespace = namespace or kwargs.get("namespace", "default")
        self._image = image or "microsandbox/python"
        self._startup_timeout = startup_timeout  # 首次启动可能需要拉取镜像
        
        # SDK 实例（在 start() 中创建）
        self._python_sandbox: Optional[PythonSandbox] = None
    
    def _map_error(self, error: Exception) -> SandboxError:
        """
        将 microsandbox SDK 错误映射到 AgenticX 异常体系
        
        microsandbox SDK 使用:
        - RuntimeError: 一般执行错误、服务器错误、JSON-RPC 错误
        - TimeoutError: 超时错误（启动超时、执行超时）
        
        Args:
            error: 原始异常
            
        Returns:
            SandboxError: AgenticX 异常
        """
        if isinstance(error, TimeoutError):
            return SandboxTimeoutError(
                f"Microsandbox operation timed out: {error}",
                timeout=getattr(error, 'timeout', 0),
            )
        elif isinstance(error, RuntimeError):
            error_msg = str(error).lower()
            if "not started" in error_msg:
                return SandboxNotReadyError(f"Sandbox not ready: {error}")
            elif "failed to execute" in error_msg or "execution" in error_msg:
                return SandboxExecutionError(
                    f"Execution failed: {error}",
                    exit_code=1,
                    stderr=str(error),
                )
            else:
                return SandboxBackendError(
                    f"Microsandbox backend error: {error}",
                    backend="microsandbox"
                )
        else:
            return SandboxBackendError(
                f"Unexpected microsandbox error: {error}",
                backend="microsandbox"
            )
    
    async def start(self) -> None:
        """
        启动 Microsandbox 沙箱
        
        创建 PythonSandbox 实例，建立 HTTP session，并启动沙箱。
        
        Raises:
            SandboxBackendError: 启动失败
        """
        if self._status == SandboxStatus.RUNNING:
            logger.debug(f"Microsandbox {self.sandbox_id} is already running")
            return
        
        self._status = SandboxStatus.CREATING
        logger.info(f"Starting Microsandbox sandbox {self.sandbox_id}")
        
        try:
            # 动态导入 aiohttp（microsandbox SDK 依赖）
            import aiohttp  # type: ignore[import-untyped]
            
            # 创建 PythonSandbox 实例
            self._python_sandbox = PythonSandbox(
                server_url=self._server_url,
                namespace=self._namespace,
                name=self.sandbox_id,
                api_key=self._api_key,
            )
            
            # 创建 HTTP session（SDK 需要）
            # 设置较长的总超时时间，因为首次启动可能需要拉取镜像
            timeout = aiohttp.ClientTimeout(total=600)  # 10 分钟总超时
            self._python_sandbox._session = aiohttp.ClientSession(timeout=timeout)
            
            # 启动沙箱
            # 配置：image, memory(MB), cpus, timeout(秒)
            # 注意：首次启动需要拉取镜像，可能需要较长时间（5-10 分钟）
            startup_timeout = self._startup_timeout
            if self._template and hasattr(self._template, 'startup_timeout_seconds'):
                startup_timeout = max(startup_timeout, self._template.startup_timeout_seconds)
            
            await self._python_sandbox.start(
                image=self._image,
                memory=self._template.memory_mb if self._template else 512,
                cpus=self._template.cpu if self._template else 1.0,
                timeout=startup_timeout,
            )
            
            self._status = SandboxStatus.RUNNING
            self._created_at = time.time()
            logger.info(f"Microsandbox {self.sandbox_id} started successfully")
            
        except Exception as e:
            self._status = SandboxStatus.ERROR
            logger.error(f"Failed to start Microsandbox {self.sandbox_id}: {e}")
            
            # 清理可能创建的 session
            if self._python_sandbox and hasattr(self._python_sandbox, '_session') and self._python_sandbox._session:
                try:
                    await self._python_sandbox._session.close()
                except Exception:
                    pass
                self._python_sandbox._session = None
            
            raise self._map_error(e)
    
    async def stop(self) -> None:
        """
        停止 Microsandbox 沙箱
        
        停止沙箱实例并清理 HTTP session。
        """
        if self._status == SandboxStatus.STOPPED:
            return
        
        self._status = SandboxStatus.STOPPING
        logger.info(f"Stopping Microsandbox {self.sandbox_id}")
        
        try:
            if self._python_sandbox:
                # 停止沙箱
                await self._python_sandbox.stop()
                
                # 清理 HTTP session
                if hasattr(self._python_sandbox, '_session') and self._python_sandbox._session:
                    await self._python_sandbox._session.close()
                    self._python_sandbox._session = None
                
                self._python_sandbox = None
            
            self._status = SandboxStatus.STOPPED
            logger.info(f"Microsandbox {self.sandbox_id} stopped")
            
        except Exception as e:
            logger.warning(f"Error stopping Microsandbox {self.sandbox_id}: {e}")
            # 即使有错误，也设置为 STOPPED
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
        
        支持状态化执行：同一个沙箱实例内的多次执行共享状态（变量、函数、import）。
        
        Args:
            code: 要执行的代码
            language: 代码语言（"python" 或 "shell"）
            timeout: 执行超时（秒），默认使用模板配置
            **kwargs: 额外参数
            
        Returns:
            ExecutionResult: 执行结果
            
        Raises:
            SandboxNotReadyError: 沙箱未运行
            SandboxTimeoutError: 执行超时
            SandboxExecutionError: 执行失败
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError(f"Microsandbox {self.sandbox_id} is not running")
        
        if not self._python_sandbox:
            raise SandboxNotReadyError("Sandbox instance not initialized")
        
        self._update_activity()
        actual_timeout = timeout or (self._template.timeout_seconds if self._template else 30)
        start_time = time.time()
        
        try:
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
        except (SandboxTimeoutError, SandboxExecutionError, SandboxNotReadyError):
            # 重新抛出 AgenticX 异常
            raise
        except Exception as e:
            raise self._map_error(e)
    
    async def _execute_python(self, code: str) -> ExecutionResult:
        """
        执行 Python 代码
        
        使用 microsandbox SDK 的 PythonSandbox.run() 方法。
        状态化执行：变量跨执行持久化（通过 namespace）。
        
        Args:
            code: Python 代码
            
        Returns:
            ExecutionResult: 执行结果
        """
        try:
            # 使用 microsandbox SDK 执行代码
            execution = await self._python_sandbox.run(code)
            
            # 获取输出（注意：output() 和 error() 是异步方法）
            stdout = await execution.output()
            stderr = await execution.error()
            has_error = execution.has_error()  # 同步方法
            
            return ExecutionResult(
                stdout=stdout,
                stderr=stderr,
                exit_code=1 if has_error else 0,
                success=not has_error,
            )
            
        except Exception as e:
            raise self._map_error(e)
    
    async def _execute_shell(self, command: str) -> ExecutionResult:
        """
        执行 Shell 命令
        
        使用 microsandbox SDK 的 command.run() 方法。
        
        Args:
            command: Shell 命令
            
        Returns:
            ExecutionResult: 执行结果
        """
        try:
            # 使用 microsandbox SDK 的 command 接口
            cmd_execution = await self._python_sandbox.command.run(command)
            
            # 获取输出
            stdout = await cmd_execution.output()
            stderr = await cmd_execution.error()
            exit_code = cmd_execution.exit_code if hasattr(cmd_execution, 'exit_code') else 0
            
            return ExecutionResult(
                stdout=stdout,
                stderr=stderr,
                exit_code=exit_code,
                success=exit_code == 0,
            )
            
        except Exception as e:
            raise self._map_error(e)
    
    async def check_health(self) -> HealthStatus:
        """
        检查 Microsandbox 健康状态
        
        Returns:
            HealthStatus: 健康状态
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
    
    async def get_metrics(self) -> Dict[str, Any]:
        """
        获取资源使用指标
        
        使用 microsandbox SDK 的 metrics 属性获取 CPU、内存、磁盘使用情况。
        
        Returns:
            Dict[str, Any]: 资源指标字典
            {
                "cpu_percent": Optional[float],  # CPU 使用率（0-100）
                "memory_mb": Optional[int],      # 内存使用（MiB）
                "disk_bytes": Optional[int],     # 磁盘使用（bytes）
                "is_running": bool,              # 是否运行中
            }
            
        Raises:
            SandboxNotReadyError: 沙箱未运行
        """
        if self._status != SandboxStatus.RUNNING or not self._python_sandbox:
            raise SandboxNotReadyError("Sandbox is not running")
        
        try:
            # metrics 是属性，不是方法
            # 所有 metrics 方法都是异步的
            cpu_usage = await self._python_sandbox.metrics.cpu()
            memory_usage = await self._python_sandbox.metrics.memory()
            disk_usage = await self._python_sandbox.metrics.disk()
            is_running = await self._python_sandbox.metrics.is_running()
            
            return {
                "cpu_percent": cpu_usage,
                "memory_mb": memory_usage,
                "disk_bytes": disk_usage,
                "is_running": is_running,
            }
            
        except Exception as e:
            logger.warning(f"Failed to get metrics: {e}")
            return {
                "cpu_percent": None,
                "memory_mb": None,
                "disk_bytes": None,
                "is_running": self._status == SandboxStatus.RUNNING,
            }
    
    async def read_file(self, path: str) -> str:
        """
        读取沙箱中的文件
        
        使用 Python 代码读取文件（因为 microsandbox/python 镜像不包含 shell 工具）。
        
        Args:
            path: 文件路径
            
        Returns:
            str: 文件内容
            
        Raises:
            SandboxNotReadyError: 沙箱未运行
            FileNotFoundError: 文件不存在
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 Python 代码读取文件，因为极简镜像可能没有 cat 命令
        code = f'''
import json
try:
    with open({repr(path)}, 'r') as f:
        content = f.read()
    print(json.dumps({{"success": True, "content": content}}))
except FileNotFoundError:
    print(json.dumps({{"success": False, "error": "FileNotFoundError"}}))
except Exception as e:
    print(json.dumps({{"success": False, "error": str(e)}}))
'''
        result = await self._execute_python(code)
        if not result.success:
            raise FileNotFoundError(f"Failed to read file: {path}")
        
        try:
            data = json.loads(result.stdout.strip())
            if data.get("success"):
                return data["content"]
            else:
                raise FileNotFoundError(f"File not found: {path} ({data.get('error', 'unknown error')})")
        except json.JSONDecodeError:
            # 如果无法解析 JSON，返回原始输出
            return result.stdout
    
    async def write_file(self, path: str, content: Union[str, bytes]) -> None:
        """
        写入文件到沙箱
        
        使用 Python 代码写入文件（因为 microsandbox/python 镜像不包含 shell 工具）。
        
        Args:
            path: 文件路径
            content: 文件内容
            
        Raises:
            SandboxNotReadyError: 沙箱未运行
            SandboxExecutionError: 写入失败
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        if isinstance(content, bytes):
            content = content.decode("utf-8")
        
        # 使用 Python 代码写入文件，因为极简镜像可能没有 shell 工具
        # 使用 base64 编码内容以避免转义问题
        encoded_content = base64.b64encode(content.encode('utf-8')).decode('ascii')
        
        code = f'''
import base64
import os
import json
try:
    content = base64.b64decode({repr(encoded_content)}).decode('utf-8')
    os.makedirs(os.path.dirname({repr(path)}) or '.', exist_ok=True)
    with open({repr(path)}, 'w') as f:
        f.write(content)
    print(json.dumps({{"success": True}}))
except Exception as e:
    print(json.dumps({{"success": False, "error": str(e)}}))
'''
        result = await self._execute_python(code)
        if not result.success:
            raise SandboxExecutionError(f"Failed to write file: {path}")
    
    async def list_directory(self, path: str = "/") -> List[FileInfo]:
        """
        列出目录内容
        
        使用 Python 代码列出目录（因为 microsandbox/python 镜像不包含 shell 工具）。
        
        Args:
            path: 目录路径
            
        Returns:
            List[FileInfo]: 文件信息列表
            
        Raises:
            SandboxNotReadyError: 沙箱未运行
            FileNotFoundError: 目录不存在
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 Python 代码列出目录
        code = f'''
import os
import stat
import json
try:
    path = {repr(path)}
    files = []
    for name in os.listdir(path):
        full_path = os.path.join(path, name)
        try:
            st = os.stat(full_path)
            is_dir = stat.S_ISDIR(st.st_mode)
            mode = stat.filemode(st.st_mode)
            files.append({{"path": full_path, "size": st.st_size, "is_dir": is_dir, "permissions": mode}})
        except:
            files.append({{"path": full_path, "size": 0, "is_dir": False, "permissions": ""}})
    print(json.dumps({{"success": True, "files": files}}))
except FileNotFoundError:
    print(json.dumps({{"success": False, "error": "Directory not found"}}))
except Exception as e:
    print(json.dumps({{"success": False, "error": str(e)}}))
'''
        result = await self._execute_python(code)
        
        if not result.success:
            raise FileNotFoundError(f"Directory not found: {path}")
        
        try:
            data = json.loads(result.stdout.strip())
            if not data.get("success"):
                raise FileNotFoundError(f"Directory not found: {path}")
            
            files = []
            for f in data.get("files", []):
                files.append(FileInfo(
                    path=f["path"],
                    size=f.get("size", 0),
                    is_dir=f.get("is_dir", False),
                    permissions=f.get("permissions", ""),
                ))
            return files
        except json.JSONDecodeError:
            raise FileNotFoundError(f"Failed to list directory: {path}")
    
    async def delete_file(self, path: str) -> None:
        """
        删除文件
        
        使用 Python 代码删除文件（因为 microsandbox/python 镜像不包含 shell 工具）。
        
        Args:
            path: 文件路径
            
        Raises:
            SandboxNotReadyError: 沙箱未运行
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 Python 代码删除文件
        code = f'''
import os
import shutil
import json
try:
    if os.path.isdir({repr(path)}):
        shutil.rmtree({repr(path)})
    elif os.path.exists({repr(path)}):
        os.remove({repr(path)})
    print(json.dumps({{"success": True}}))
except Exception as e:
    print(json.dumps({{"success": False, "error": str(e)}}))
'''
        await self._execute_python(code)
    
    async def run_command(
        self,
        command: str,
        timeout: Optional[int] = None,
    ) -> ExecutionResult:
        """
        运行 Shell 命令
        
        使用 microsandbox SDK 的 command.run() 方法。
        
        Args:
            command: Shell 命令
            timeout: 超时时间（秒）
            
        Returns:
            ExecutionResult: 执行结果
        """
        return await self.execute(command, language="shell", timeout=timeout)
    
    async def list_processes(self) -> List[ProcessInfo]:
        """
        列出沙箱中的进程
        
        使用 Python 代码获取进程列表（因为 microsandbox/python 镜像可能没有 ps 命令）。
        
        Returns:
            List[ProcessInfo]: 进程信息列表
            
        Raises:
            SandboxNotReadyError: 沙箱未运行
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 Python 代码获取进程信息
        code = '''
import os
import json
processes = []
try:
    # 尝试读取 /proc 目录（Linux）
    if os.path.exists('/proc'):
        for pid_dir in os.listdir('/proc'):
            if pid_dir.isdigit():
                try:
                    pid = int(pid_dir)
                    cmdline_path = f'/proc/{pid}/cmdline'
                    if os.path.exists(cmdline_path):
                        with open(cmdline_path, 'r') as f:
                            cmdline = f.read().replace('\\x00', ' ').strip()
                        if cmdline:
                            processes.append({"pid": pid, "command": cmdline, "status": "running"})
                except:
                    pass
    print(json.dumps({"success": True, "processes": processes}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e), "processes": []}))
'''
        result = await self._execute_python(code)
        
        processes = []
        try:
            data = json.loads(result.stdout.strip())
            for p in data.get("processes", []):
                processes.append(ProcessInfo(
                    pid=p.get("pid", 0),
                    command=p.get("command", ""),
                    status=p.get("status", "unknown"),
                    cpu_percent=p.get("cpu_percent", 0.0),
                    memory_mb=p.get("memory_mb", 0.0),
                ))
        except:
            pass
        
        return processes
    
    async def kill_process(self, pid: int, signal: int = 15) -> None:
        """
        终止进程
        
        使用 Python 代码终止进程（因为 microsandbox/python 镜像可能没有 kill 命令）。
        
        Args:
            pid: 进程 ID
            signal: 信号（默认 SIGTERM=15）
            
        Raises:
            SandboxNotReadyError: 沙箱未运行
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 Python os.kill() 终止进程
        code = f'''
import os
import signal
import json
try:
    os.kill({pid}, {signal})
    print(json.dumps({{"success": True}}))
except ProcessLookupError:
    print(json.dumps({{"success": False, "error": "Process not found"}}))
except PermissionError:
    print(json.dumps({{"success": False, "error": "Permission denied"}}))
except Exception as e:
    print(json.dumps({{"success": False, "error": str(e)}}))
'''
        result = await self._execute_python(code)
        if not result.success:
            logger.warning(f"Failed to kill process {pid}: {result.stderr}")
    
    @property
    def namespace(self) -> str:
        """获取命名空间"""
        return self._namespace
    
    @property
    def server_url(self) -> str:
        """获取服务器 URL"""
        return self._server_url


def is_microsandbox_available() -> bool:
    """
    检查 Microsandbox Python SDK 是否可用
    
    Returns:
        bool: 是否可用
    """
    return MICROSANDBOX_AVAILABLE
