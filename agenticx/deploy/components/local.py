"""
AgenticX Local Deployment Component

本地进程部署组件，用于开发和测试。
"""

import asyncio
import os
import signal
import logging
from typing import Dict, Any, List, Optional, AsyncIterator
from datetime import datetime

from ..base import DeploymentComponent, ComponentRegistry
from ..types import (
    DeploymentConfig,
    DeploymentResult,
    RemoveResult,
    StatusResult,
    DeploymentStatus,
)

logger = logging.getLogger(__name__)


class LocalComponent(DeploymentComponent):
    """
    本地进程部署组件
    
    在本地启动进程，适合开发和测试环境。
    
    Props:
        command: 启动命令（必需）
        args: 命令参数
        cwd: 工作目录
        environment: 环境变量
        
    Example:
        >>> config = DeploymentConfig(
        ...     name="my-agent",
        ...     component="local",
        ...     props={
        ...         "command": "python",
        ...         "args": ["-m", "agenticx.server", "--port", "8000"],
        ...     },
        ... )
        >>> component = LocalComponent()
        >>> result = await component.deploy(config)
    """
    
    # 存储运行中的进程
    _processes: Dict[str, asyncio.subprocess.Process] = {}
    
    @property
    def name(self) -> str:
        return "local"
    
    @property
    def description(self) -> str:
        return "Local process deployment for development"
    
    def get_required_props(self) -> List[str]:
        return ["command"]
    
    def get_optional_props(self) -> Dict[str, Any]:
        return {
            "args": [],
            "cwd": None,
            "environment": {},
            "shell": False,
        }
    
    def _get_deployment_id(self, config: DeploymentConfig) -> str:
        return f"local-{config.name}-{config.environment}"
    
    async def deploy(self, config: DeploymentConfig) -> DeploymentResult:
        """
        启动本地进程
        
        Args:
            config: 部署配置
            
        Returns:
            DeploymentResult: 部署结果
        """
        deployment_id = self._get_deployment_id(config)
        props = config.props
        
        # 先停止已存在的进程
        if deployment_id in self._processes:
            await self.remove(config)
        
        command = props.get("command")
        args = props.get("args", [])
        cwd = props.get("cwd")
        environment = props.get("environment", {})
        shell = props.get("shell", False)
        
        # 准备环境变量
        env = os.environ.copy()
        env.update(environment)
        
        try:
            if shell:
                # Shell 模式
                full_command = f"{command} {' '.join(args)}"
                process = await asyncio.create_subprocess_shell(
                    full_command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=cwd,
                    env=env,
                )
            else:
                # 直接执行
                process = await asyncio.create_subprocess_exec(
                    command, *args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=cwd,
                    env=env,
                )
            
            self._processes[deployment_id] = process
            
            # 等待一小段时间检查进程是否立即退出
            await asyncio.sleep(0.5)
            if process.returncode is not None:
                stderr = await process.stderr.read()
                return DeploymentResult(
                    success=False,
                    deployment_id=deployment_id,
                    status=DeploymentStatus.FAILED,
                    message=f"Process exited immediately: {stderr.decode()}",
                )
            
            return DeploymentResult(
                success=True,
                deployment_id=deployment_id,
                status=DeploymentStatus.RUNNING,
                message=f"Process started with PID {process.pid}",
                started_at=datetime.now(),
                metadata={"pid": process.pid},
            )
            
        except Exception as e:
            return DeploymentResult(
                success=False,
                deployment_id=deployment_id,
                status=DeploymentStatus.FAILED,
                message=f"Failed to start process: {e}",
            )
    
    async def remove(self, config: DeploymentConfig) -> RemoveResult:
        """
        停止本地进程
        
        Args:
            config: 部署配置
            
        Returns:
            RemoveResult: 删除结果
        """
        deployment_id = self._get_deployment_id(config)
        
        if deployment_id not in self._processes:
            return RemoveResult(
                success=True,
                message="Process not found (already stopped)",
            )
        
        process = self._processes[deployment_id]
        
        try:
            # 尝试优雅停止
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=10)
            except asyncio.TimeoutError:
                # 强制停止
                process.kill()
                await process.wait()
            
            del self._processes[deployment_id]
            
            return RemoveResult(
                success=True,
                message=f"Process {process.pid} stopped",
                removed_resources=[deployment_id],
            )
            
        except Exception as e:
            return RemoveResult(
                success=False,
                message=f"Failed to stop process: {e}",
            )
    
    async def status(self, config: DeploymentConfig) -> StatusResult:
        """
        查询进程状态
        
        Args:
            config: 部署配置
            
        Returns:
            StatusResult: 状态结果
        """
        deployment_id = self._get_deployment_id(config)
        
        if deployment_id not in self._processes:
            return StatusResult(
                deployment_id=deployment_id,
                status=DeploymentStatus.STOPPED,
            )
        
        process = self._processes[deployment_id]
        
        if process.returncode is None:
            return StatusResult(
                deployment_id=deployment_id,
                status=DeploymentStatus.RUNNING,
                replicas_ready=1,
                replicas_total=1,
                conditions=[
                    {
                        "type": "ProcessRunning",
                        "status": "True",
                        "message": f"PID: {process.pid}",
                    }
                ],
            )
        else:
            return StatusResult(
                deployment_id=deployment_id,
                status=DeploymentStatus.STOPPED,
                replicas_ready=0,
                replicas_total=1,
                conditions=[
                    {
                        "type": "ProcessExited",
                        "status": "True",
                        "message": f"Exit code: {process.returncode}",
                    }
                ],
            )


# 注册组件
ComponentRegistry.register(LocalComponent())
