"""
AgenticX Docker Deployment Component

基于 Docker 的部署组件，支持：
- 构建 Docker 镜像
- 运行容器
- 管理容器生命周期
"""

import asyncio
import json
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
    DeployError,
    DeployExecutionError,
)

logger = logging.getLogger(__name__)


class DockerComponent(DeploymentComponent):
    """
    Docker 部署组件
    
    使用 Docker CLI 进行容器部署。
    
    Props:
        image: Docker 镜像名称（必需）
        ports: 端口映射，如 {"8080": "80"}
        volumes: 卷映射，如 {"/host/path": "/container/path"}
        environment: 环境变量
        network: 网络名称
        restart_policy: 重启策略（no, always, on-failure, unless-stopped）
        command: 容器启动命令
        entrypoint: 容器入口点
        
    Example:
        >>> config = DeploymentConfig(
        ...     name="my-agent",
        ...     component="docker",
        ...     props={
        ...         "image": "my-agent:latest",
        ...         "ports": {"8080": "80"},
        ...     },
        ... )
        >>> component = DockerComponent()
        >>> result = await component.deploy(config)
    """
    
    @property
    def name(self) -> str:
        return "docker"
    
    @property
    def description(self) -> str:
        return "Docker container deployment"
    
    def get_required_props(self) -> List[str]:
        return ["image"]
    
    def get_optional_props(self) -> Dict[str, Any]:
        return {
            "ports": {},
            "volumes": {},
            "environment": {},
            "network": None,
            "restart_policy": "unless-stopped",
            "command": None,
            "entrypoint": None,
            "labels": {},
            "privileged": False,
            "cap_add": [],
            "cap_drop": [],
        }
    
    async def validate(self, config: DeploymentConfig) -> List[str]:
        """验证配置"""
        errors = await super().validate(config)
        
        # 检查必需属性
        if "image" not in config.props:
            errors.append("Docker image is required in props")
        
        # 检查 Docker 是否可用
        if not await self._is_docker_available():
            errors.append("Docker is not available on this system")
        
        return errors
    
    async def _is_docker_available(self) -> bool:
        """检查 Docker 是否可用"""
        try:
            process = await asyncio.create_subprocess_exec(
                "docker", "version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await process.communicate()
            return process.returncode == 0
        except Exception:
            return False
    
    async def _run_docker_command(
        self,
        *args: str,
        timeout: int = 60,
    ) -> tuple:
        """
        执行 Docker 命令
        
        Returns:
            (returncode, stdout, stderr)
        """
        try:
            process = await asyncio.create_subprocess_exec(
                "docker", *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout,
            )
            return (
                process.returncode,
                stdout.decode("utf-8", errors="replace"),
                stderr.decode("utf-8", errors="replace"),
            )
        except asyncio.TimeoutError:
            raise DeployExecutionError(f"Docker command timed out: docker {' '.join(args)}")
        except Exception as e:
            raise DeployExecutionError(f"Docker command failed: {e}")
    
    def _get_container_name(self, config: DeploymentConfig) -> str:
        """生成容器名称"""
        return f"agenticx-{config.name}-{config.environment}"
    
    async def deploy(self, config: DeploymentConfig) -> DeploymentResult:
        """
        部署容器
        
        Args:
            config: 部署配置
            
        Returns:
            DeploymentResult: 部署结果
        """
        # 验证配置
        errors = await self.validate(config)
        if errors:
            return DeploymentResult(
                success=False,
                status=DeploymentStatus.FAILED,
                message=f"Validation failed: {', '.join(errors)}",
            )
        
        await self.pre_deploy(config)
        
        container_name = self._get_container_name(config)
        props = config.props
        
        # 构建 docker run 命令
        cmd_args = ["run", "-d", "--name", container_name]
        
        # 添加端口映射
        ports = props.get("ports", {})
        for host_port, container_port in ports.items():
            cmd_args.extend(["-p", f"{host_port}:{container_port}"])
        
        # 添加卷映射
        volumes = props.get("volumes", {})
        for host_path, container_path in volumes.items():
            cmd_args.extend(["-v", f"{host_path}:{container_path}"])
        
        # 添加环境变量
        environment = props.get("environment", {})
        for key, value in environment.items():
            cmd_args.extend(["-e", f"{key}={value}"])
        
        # 添加网络
        network = props.get("network")
        if network:
            cmd_args.extend(["--network", network])
        
        # 添加重启策略
        restart_policy = props.get("restart_policy", "unless-stopped")
        cmd_args.extend(["--restart", restart_policy])
        
        # 添加标签
        labels = props.get("labels", {})
        labels["agenticx.deployment"] = config.name
        labels["agenticx.environment"] = config.environment
        for key, value in labels.items():
            cmd_args.extend(["--label", f"{key}={value}"])
        
        # 添加资源限制
        if config.resources:
            cmd_args.extend(["--cpus", str(config.resources.cpu)])
            cmd_args.extend(["--memory", f"{config.resources.memory_mb}m"])
        
        # 添加入口点和命令
        entrypoint = props.get("entrypoint")
        if entrypoint:
            cmd_args.extend(["--entrypoint", entrypoint])
        
        # 添加镜像
        image = props["image"]
        cmd_args.append(image)
        
        # 添加命令
        command = props.get("command")
        if command:
            if isinstance(command, list):
                cmd_args.extend(command)
            else:
                cmd_args.append(command)
        
        # 先停止并删除已存在的容器
        await self._run_docker_command("rm", "-f", container_name)
        
        # 运行容器
        returncode, stdout, stderr = await self._run_docker_command(*cmd_args, timeout=120)
        
        if returncode != 0:
            result = DeploymentResult(
                success=False,
                deployment_id=container_name,
                status=DeploymentStatus.FAILED,
                message=f"Failed to start container: {stderr}",
            )
        else:
            container_id = stdout.strip()[:12]
            
            # 获取容器端点
            endpoint = None
            if ports:
                first_port = list(ports.keys())[0]
                endpoint = f"http://localhost:{first_port}"
            
            result = DeploymentResult(
                success=True,
                deployment_id=container_name,
                status=DeploymentStatus.RUNNING,
                message=f"Container started: {container_id}",
                endpoint=endpoint,
                started_at=datetime.now(),
                metadata={"container_id": container_id},
            )
        
        await self.post_deploy(config, result)
        return result
    
    async def remove(self, config: DeploymentConfig) -> RemoveResult:
        """
        删除容器
        
        Args:
            config: 部署配置
            
        Returns:
            RemoveResult: 删除结果
        """
        container_name = self._get_container_name(config)
        
        # 停止容器
        await self._run_docker_command("stop", container_name)
        
        # 删除容器
        returncode, stdout, stderr = await self._run_docker_command("rm", container_name)
        
        if returncode == 0:
            return RemoveResult(
                success=True,
                message=f"Container {container_name} removed",
                removed_resources=[container_name],
            )
        else:
            return RemoveResult(
                success=False,
                message=f"Failed to remove container: {stderr}",
            )
    
    async def status(self, config: DeploymentConfig) -> StatusResult:
        """
        查询容器状态
        
        Args:
            config: 部署配置
            
        Returns:
            StatusResult: 状态结果
        """
        container_name = self._get_container_name(config)
        
        # 获取容器信息
        returncode, stdout, stderr = await self._run_docker_command(
            "inspect", container_name, "--format", "{{json .}}"
        )
        
        if returncode != 0:
            return StatusResult(
                deployment_id=container_name,
                status=DeploymentStatus.UNKNOWN,
            )
        
        try:
            info = json.loads(stdout)
            state = info.get("State", {})
            
            # 映射状态
            running = state.get("Running", False)
            if running:
                status = DeploymentStatus.RUNNING
            elif state.get("Paused", False):
                status = DeploymentStatus.STOPPED
            elif state.get("Restarting", False):
                status = DeploymentStatus.DEPLOYING
            elif state.get("Dead", False) or state.get("OOMKilled", False):
                status = DeploymentStatus.FAILED
            else:
                status = DeploymentStatus.STOPPED
            
            # 解析时间
            created_str = info.get("Created", "")
            created_at = None
            if created_str:
                try:
                    created_at = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                except Exception:
                    pass
            
            # 获取端口映射
            ports = info.get("NetworkSettings", {}).get("Ports", {})
            endpoint = None
            for port_info in ports.values():
                if port_info:
                    host_port = port_info[0].get("HostPort")
                    if host_port:
                        endpoint = f"http://localhost:{host_port}"
                        break
            
            return StatusResult(
                deployment_id=container_name,
                status=status,
                replicas_ready=1 if running else 0,
                replicas_total=1,
                endpoint=endpoint,
                created_at=created_at,
                conditions=[
                    {
                        "type": "ContainerRunning",
                        "status": str(running),
                        "message": state.get("Status", ""),
                    }
                ],
            )
            
        except json.JSONDecodeError:
            return StatusResult(
                deployment_id=container_name,
                status=DeploymentStatus.UNKNOWN,
            )
    
    async def logs(
        self,
        config: DeploymentConfig,
        lines: int = 100,
        follow: bool = False,
    ) -> AsyncIterator[str]:
        """
        获取容器日志
        
        Args:
            config: 部署配置
            lines: 日志行数
            follow: 是否实时跟踪
            
        Yields:
            日志行
        """
        container_name = self._get_container_name(config)
        
        cmd_args = ["logs", f"--tail={lines}"]
        if follow:
            cmd_args.append("-f")
        cmd_args.append(container_name)
        
        process = await asyncio.create_subprocess_exec(
            "docker", *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        
        async for line in process.stdout:
            yield line.decode("utf-8", errors="replace").rstrip()
        
        await process.wait()
    
    async def scale(
        self,
        config: DeploymentConfig,
        replicas: int,
    ) -> DeploymentResult:
        """
        Docker 单容器模式不支持真正的扩缩容
        """
        if replicas == 0:
            await self.remove(config)
            return DeploymentResult(
                success=True,
                deployment_id=self._get_container_name(config),
                status=DeploymentStatus.STOPPED,
                message="Container stopped (scale to 0)",
            )
        elif replicas == 1:
            return await self.deploy(config)
        else:
            return DeploymentResult(
                success=False,
                status=DeploymentStatus.FAILED,
                message="Docker component supports only 1 replica. Use Kubernetes for multiple replicas.",
            )


# 注册组件
ComponentRegistry.register(DockerComponent())
