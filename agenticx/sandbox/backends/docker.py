"""
AgenticX Docker Sandbox Backend

基于 Docker 容器的沙箱后端，提供容器级隔离。

特点：
- 容器级隔离（进程、网络、文件系统）
- 支持自定义镜像
- 支持资源限制（CPU、内存）
- 支持网络配置

前置条件：
- Docker 已安装并运行
- pip install docker（可选，用于 Python SDK）

参考: OpenSandbox server/src/services/docker.py
"""

import asyncio
import time
import logging
import shutil
import json
from typing import Optional, Dict, Any, List
from pathlib import Path

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

# 检查 docker 命令是否可用
DOCKER_CLI_AVAILABLE = shutil.which("docker") is not None

# 检查 docker Python SDK 是否可用
try:
    import docker
    DOCKER_SDK_AVAILABLE = True
except ImportError:
    DOCKER_SDK_AVAILABLE = False
    docker = None


class DockerSandbox(SandboxBase):
    """
    基于 Docker 容器的沙箱实现
    
    提供容器级别的隔离，适合执行不可信代码。
    
    Example:
        >>> async with DockerSandbox(image="python:3.11-slim") as sb:
        ...     result = await sb.execute("print('Hello from Docker!')")
        ...     print(result.stdout)
        Hello from Docker!
    
    Note:
        需要 Docker 已安装并运行。
        可选安装 docker Python SDK: pip install docker
    """
    
    DEFAULT_IMAGE = "python:3.11-slim"
    DEFAULT_WORKDIR = "/workspace"
    CONTAINER_NAME_PREFIX = "agenticx_sandbox_"
    
    def __init__(
        self,
        sandbox_id: Optional[str] = None,
        template: Optional[SandboxTemplate] = None,
        image: Optional[str] = None,
        working_dir: Optional[str] = None,
        network_mode: str = "bridge",
        auto_remove: bool = True,
        **kwargs,
    ):
        """
        初始化 Docker 沙箱
        
        Args:
            sandbox_id: 沙箱 ID
            template: 沙箱模板
            image: Docker 镜像名称
            working_dir: 容器内工作目录
            network_mode: 网络模式（bridge, host, none）
            auto_remove: 容器停止后是否自动删除
            **kwargs: 额外参数
        """
        if not DOCKER_CLI_AVAILABLE:
            raise SandboxBackendError(
                "Docker CLI not found. Please install Docker.",
                backend="docker"
            )
        
        super().__init__(sandbox_id=sandbox_id, template=template, **kwargs)
        
        self._image = image or self.DEFAULT_IMAGE
        self._working_dir = working_dir or self.DEFAULT_WORKDIR
        self._network_mode = network_mode
        self._auto_remove = auto_remove
        
        # 容器状态
        self._container_id: Optional[str] = None
        self._container_name = f"{self.CONTAINER_NAME_PREFIX}{self.sandbox_id}"
        
        # Docker 客户端（优先使用 SDK，否则使用 CLI）
        self._docker_client = None
        self._use_sdk = DOCKER_SDK_AVAILABLE
    
    @property
    def container_id(self) -> Optional[str]:
        """容器 ID"""
        return self._container_id
    
    @property
    def container_name(self) -> str:
        """容器名称"""
        return self._container_name
    
    @property
    def image(self) -> str:
        """镜像名称"""
        return self._image
    
    async def start(self) -> None:
        """
        启动 Docker 容器
        """
        if self._status == SandboxStatus.RUNNING:
            logger.debug(f"Docker sandbox {self.sandbox_id} is already running")
            return
        
        self._status = SandboxStatus.CREATING
        logger.info(f"Starting Docker sandbox {self.sandbox_id} with image {self._image}")
        
        try:
            if self._use_sdk:
                await self._start_with_sdk()
            else:
                await self._start_with_cli()
            
            self._status = SandboxStatus.RUNNING
            self._created_at = time.time()
            logger.info(f"Docker sandbox {self.sandbox_id} started (container: {self._container_id})")
            
        except Exception as e:
            self._status = SandboxStatus.ERROR
            logger.error(f"Failed to start Docker sandbox {self.sandbox_id}: {e}")
            raise SandboxBackendError(
                f"Failed to start Docker container: {e}",
                backend="docker"
            )
    
    async def _start_with_sdk(self) -> None:
        """使用 Docker SDK 启动容器"""
        self._docker_client = docker.from_env()
        
        # 构建容器配置
        container_config = {
            "image": self._image,
            "name": self._container_name,
            "detach": True,
            "tty": True,
            "stdin_open": True,
            "working_dir": self._working_dir,
            "network_mode": self._network_mode,
            "auto_remove": self._auto_remove,
        }
        
        # 资源限制
        if self._template:
            mem_limit = f"{self._template.memory_mb}m"
            nano_cpus = int(self._template.cpu * 1e9)
            container_config["mem_limit"] = mem_limit
            container_config["nano_cpus"] = nano_cpus
        
        # 环境变量
        env_vars = self._template.environment.copy() if self._template else {}
        env_vars["AGENTICX_SANDBOX_ID"] = self.sandbox_id
        container_config["environment"] = env_vars
        
        # 创建并启动容器
        loop = asyncio.get_event_loop()
        container = await loop.run_in_executor(
            None,
            lambda: self._docker_client.containers.run(**container_config)
        )
        
        self._container_id = container.id[:12]
    
    async def _start_with_cli(self) -> None:
        """使用 Docker CLI 启动容器"""
        # 构建 docker run 命令
        cmd = [
            "docker", "run",
            "-d",  # detach
            "-t",  # tty
            "-i",  # interactive
            "--name", self._container_name,
            "-w", self._working_dir,
            "--network", self._network_mode,
        ]
        
        # 资源限制
        if self._template:
            cmd.extend(["--memory", f"{self._template.memory_mb}m"])
            cmd.extend(["--cpus", str(self._template.cpu)])
        
        # 环境变量
        env_vars = self._template.environment.copy() if self._template else {}
        env_vars["AGENTICX_SANDBOX_ID"] = self.sandbox_id
        for key, value in env_vars.items():
            cmd.extend(["-e", f"{key}={value}"])
        
        if self._auto_remove:
            cmd.append("--rm")
        
        # 镜像
        cmd.append(self._image)
        
        # 保持容器运行的命令
        cmd.extend(["tail", "-f", "/dev/null"])
        
        # 执行命令
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            raise SandboxBackendError(
                f"Docker run failed: {stderr.decode()}",
                backend="docker"
            )
        
        self._container_id = stdout.decode().strip()[:12]
    
    async def stop(self) -> None:
        """
        停止 Docker 容器
        """
        if self._status == SandboxStatus.STOPPED:
            return
        
        self._status = SandboxStatus.STOPPING
        logger.info(f"Stopping Docker sandbox {self.sandbox_id}")
        
        try:
            if self._container_id:
                if self._use_sdk and self._docker_client:
                    await self._stop_with_sdk()
                else:
                    await self._stop_with_cli()
            
            self._status = SandboxStatus.STOPPED
            self._container_id = None
            logger.info(f"Docker sandbox {self.sandbox_id} stopped")
            
        except Exception as e:
            logger.warning(f"Error stopping Docker sandbox {self.sandbox_id}: {e}")
            self._status = SandboxStatus.STOPPED
    
    async def _stop_with_sdk(self) -> None:
        """使用 Docker SDK 停止容器"""
        try:
            loop = asyncio.get_event_loop()
            container = await loop.run_in_executor(
                None,
                lambda: self._docker_client.containers.get(self._container_id)
            )
            await loop.run_in_executor(None, lambda: container.stop(timeout=10))
            if not self._auto_remove:
                await loop.run_in_executor(None, container.remove)
        except Exception as e:
            logger.warning(f"Error stopping container with SDK: {e}")
    
    async def _stop_with_cli(self) -> None:
        """使用 Docker CLI 停止容器"""
        # 停止容器
        process = await asyncio.create_subprocess_exec(
            "docker", "stop", "-t", "10", self._container_id,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await process.communicate()
        
        # 删除容器（如果不是自动删除）
        if not self._auto_remove:
            process = await asyncio.create_subprocess_exec(
                "docker", "rm", "-f", self._container_id,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await process.communicate()
    
    async def execute(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None,
        **kwargs,
    ) -> ExecutionResult:
        """
        在 Docker 容器中执行代码
        
        Args:
            code: 要执行的代码
            language: 代码语言
            timeout: 执行超时（秒）
            **kwargs: 额外参数
            
        Returns:
            ExecutionResult: 执行结果
        """
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError(f"Docker sandbox {self.sandbox_id} is not running")
        
        self._update_activity()
        actual_timeout = timeout or self._template.timeout_seconds
        
        if language.lower() in ("python", "py"):
            return await self._execute_python(code, actual_timeout)
        elif language.lower() in ("shell", "bash", "sh"):
            return await self._execute_shell(code, actual_timeout)
        else:
            raise ValueError(f"Unsupported language: {language}")
    
    async def _execute_python(self, code: str, timeout: int) -> ExecutionResult:
        """执行 Python 代码"""
        # 将代码传递给 python -c
        # 使用 base64 编码避免引号问题
        import base64
        encoded_code = base64.b64encode(code.encode()).decode()
        
        cmd = f"python3 -c \"import base64; exec(base64.b64decode('{encoded_code}').decode())\""
        return await self._docker_exec(cmd, timeout, language="python")
    
    async def _execute_shell(self, command: str, timeout: int) -> ExecutionResult:
        """执行 Shell 命令"""
        return await self._docker_exec(command, timeout, language="shell")
    
    async def _docker_exec(
        self,
        command: str,
        timeout: int,
        language: str = "shell",
    ) -> ExecutionResult:
        """在容器中执行命令"""
        start_time = time.time()
        
        if self._use_sdk and self._docker_client:
            return await self._exec_with_sdk(command, timeout, language, start_time)
        else:
            return await self._exec_with_cli(command, timeout, language, start_time)
    
    async def _exec_with_sdk(
        self,
        command: str,
        timeout: int,
        language: str,
        start_time: float,
    ) -> ExecutionResult:
        """使用 Docker SDK 执行命令"""
        try:
            loop = asyncio.get_event_loop()
            container = await loop.run_in_executor(
                None,
                lambda: self._docker_client.containers.get(self._container_id)
            )
            
            exec_result = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: container.exec_run(
                        ["sh", "-c", command],
                        workdir=self._working_dir,
                    )
                ),
                timeout=timeout,
            )
            
            duration_ms = (time.time() - start_time) * 1000
            output = exec_result.output.decode("utf-8", errors="replace")
            exit_code = exec_result.exit_code
            
            return ExecutionResult(
                stdout=output if exit_code == 0 else "",
                stderr=output if exit_code != 0 else "",
                exit_code=exit_code,
                success=exit_code == 0,
                duration_ms=duration_ms,
                language=language,
            )
            
        except asyncio.TimeoutError:
            raise SandboxTimeoutError(
                f"Execution timed out after {timeout}s",
                timeout=timeout,
            )
    
    async def _exec_with_cli(
        self,
        command: str,
        timeout: int,
        language: str,
        start_time: float,
    ) -> ExecutionResult:
        """使用 Docker CLI 执行命令"""
        try:
            process = await asyncio.create_subprocess_exec(
                "docker", "exec", "-w", self._working_dir,
                self._container_id,
                "sh", "-c", command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            
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
                language=language,
            )
            
        except asyncio.TimeoutError:
            # 尝试终止执行
            process.kill()
            raise SandboxTimeoutError(
                f"Execution timed out after {timeout}s",
                timeout=timeout,
            )
    
    async def check_health(self) -> HealthStatus:
        """
        检查 Docker 容器健康状态
        """
        start_time = time.time()
        
        if self._status != SandboxStatus.RUNNING:
            return HealthStatus(
                status="unhealthy",
                message=f"Sandbox is not running (status: {self._status.value})",
            )
        
        try:
            result = await self.execute("echo 'health_check_ok'", language="shell", timeout=5)
            latency_ms = (time.time() - start_time) * 1000
            
            if result.success and "health_check_ok" in result.stdout:
                return HealthStatus(
                    status="ok",
                    message="Docker sandbox is healthy",
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
        """读取容器中的文件"""
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 cat 命令读取文件
        result = await self.execute(f"cat '{path}'", language="shell")
        if not result.success:
            raise FileNotFoundError(f"File not found: {path}")
        return result.stdout
    
    async def write_file(self, path: str, content: str) -> None:
        """写入文件到容器"""
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        # 使用 heredoc 写入文件
        import base64
        encoded = base64.b64encode(content.encode()).decode()
        cmd = f"echo '{encoded}' | base64 -d > '{path}'"
        
        result = await self.execute(cmd, language="shell")
        if not result.success:
            raise IOError(f"Failed to write file: {result.stderr}")
    
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
        """列出容器中的进程"""
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
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
        """终止进程"""
        if self._status != SandboxStatus.RUNNING:
            raise SandboxNotReadyError("Sandbox is not running")
        
        result = await self.execute(f"kill -{signal} {pid}", language="shell")
        if not result.success:
            logger.warning(f"Failed to kill process {pid}: {result.stderr}")


def is_docker_available() -> bool:
    """检查 Docker 是否可用"""
    return DOCKER_CLI_AVAILABLE


def is_docker_sdk_available() -> bool:
    """检查 Docker SDK 是否可用"""
    return DOCKER_SDK_AVAILABLE
