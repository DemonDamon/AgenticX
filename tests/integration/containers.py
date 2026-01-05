"""
类 Testcontainers 的测试容器管理

本模块提供用于集成测试的 Docker 容器管理功能，
参考 Java Testcontainers 库和 Spring AI 的集成测试模式。

内化来源: Spring AI Testcontainers 集成
设计理念: 
- 使用 subprocess 调用 docker CLI，避免引入 docker-py 依赖
- 提供优雅的容器生命周期管理
- 支持健康检查和端口等待

使用示例:
    # 作为上下文管理器
    with RedisContainer() as redis:
        client = redis_client.Redis(host="localhost", port=redis.port)
        # ... 测试代码 ...
    
    # 或手动管理
    container = RedisContainer()
    try:
        container.start()
        # ... 测试代码 ...
    finally:
        container.stop()
"""

import os
import subprocess
import socket
import time
import logging
import uuid
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from contextlib import contextmanager

logger = logging.getLogger(__name__)


# ============ 异常定义 ============

class ContainerError(Exception):
    """容器操作基础异常"""
    pass


class ContainerStartupError(ContainerError):
    """容器启动失败异常"""
    pass


class ContainerNotFoundError(ContainerError):
    """容器未找到异常"""
    pass


class DockerNotAvailableError(ContainerError):
    """Docker 不可用异常"""
    pass


# ============ 辅助函数 ============

def is_docker_available() -> bool:
    """检查 Docker 是否可用"""
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=10
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def wait_for_port(host: str, port: int, timeout: float = 30.0) -> bool:
    """
    等待端口可用
    
    Args:
        host: 主机地址
        port: 端口号
        timeout: 超时时间（秒）
    
    Returns:
        端口是否可用
    """
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except (socket.error, ConnectionRefusedError, socket.timeout):
            time.sleep(0.5)
    return False


def find_free_port() -> int:
    """查找可用的空闲端口"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


# ============ 容器基类 ============

class TestContainer(ABC):
    """
    测试容器抽象基类
    
    提供 Docker 容器的生命周期管理，包括启动、停止、健康检查等功能。
    子类需实现 _get_extra_args() 和 _wait_until_ready() 方法。
    
    Attributes:
        image: Docker 镜像名称
        name: 容器名称
        port: 主端口号
        container_id: 容器 ID（启动后设置）
        host: 容器主机地址（默认 localhost）
    """
    
    def __init__(
        self,
        image: str,
        name: Optional[str] = None,
        port: Optional[int] = None,
        host: str = "localhost",
        auto_remove: bool = True,
        environment: Optional[Dict[str, str]] = None,
        startup_timeout: float = 60.0
    ):
        """
        初始化测试容器
        
        Args:
            image: Docker 镜像名称（如 "redis:7-alpine"）
            name: 容器名称（默认自动生成）
            port: 主端口号（默认使用子类定义的默认端口）
            host: 主机地址（默认 localhost）
            auto_remove: 停止时是否自动删除容器（默认 True）
            environment: 环境变量字典
            startup_timeout: 启动超时时间（秒）
        """
        self.image = image
        self.name = name or f"agenticx-test-{uuid.uuid4().hex[:8]}"
        self.port = port or self._get_default_port()
        self.host = host
        self.auto_remove = auto_remove
        self.environment = environment or {}
        self.startup_timeout = startup_timeout
        
        self.container_id: Optional[str] = None
        self._started = False
    
    @abstractmethod
    def _get_default_port(self) -> int:
        """获取默认端口号，子类必须实现"""
        pass
    
    @abstractmethod
    def _get_extra_args(self) -> List[str]:
        """获取额外的 docker run 参数，子类必须实现"""
        pass
    
    @abstractmethod
    def _wait_until_ready(self) -> bool:
        """等待容器就绪，子类必须实现"""
        pass
    
    def _build_docker_command(self) -> List[str]:
        """构建 docker run 命令"""
        cmd = [
            "docker", "run", "-d",
            "--name", self.name,
            "-p", f"{self.port}:{self._get_default_port()}"
        ]
        
        if self.auto_remove:
            cmd.append("--rm")
        
        # 添加环境变量
        for key, value in self.environment.items():
            cmd.extend(["-e", f"{key}={value}"])
        
        # 添加子类的额外参数
        cmd.extend(self._get_extra_args())
        
        # 镜像名称放最后
        cmd.append(self.image)
        
        return cmd
    
    def start(self) -> "TestContainer":
        """
        启动容器
        
        Returns:
            self（支持链式调用）
        
        Raises:
            DockerNotAvailableError: Docker 不可用
            ContainerStartupError: 容器启动失败
        """
        if self._started:
            logger.warning(f"容器 {self.name} 已经启动")
            return self
        
        if not is_docker_available():
            raise DockerNotAvailableError(
                "Docker 不可用，请确保 Docker 已安装并正在运行"
            )
        
        logger.info(f"启动容器: {self.name} (镜像: {self.image}, 端口: {self.port})")
        
        try:
            # 先尝试移除同名容器（如果存在）
            subprocess.run(
                ["docker", "rm", "-f", self.name],
                capture_output=True,
                timeout=10
            )
            
            # 构建并执行启动命令
            cmd = self._build_docker_command()
            logger.debug(f"执行命令: {' '.join(cmd)}")
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                raise ContainerStartupError(
                    f"容器启动失败: {result.stderr}"
                )
            
            self.container_id = result.stdout.strip()
            logger.info(f"容器 ID: {self.container_id[:12]}")
            
            # 等待容器就绪
            if not self._wait_until_ready():
                self.stop()
                raise ContainerStartupError(
                    f"容器 {self.name} 启动超时（{self.startup_timeout}秒）"
                )
            
            self._started = True
            logger.info(f"容器 {self.name} 启动成功")
            return self
            
        except subprocess.TimeoutExpired:
            raise ContainerStartupError("Docker 命令执行超时")
        except Exception as e:
            if not isinstance(e, ContainerError):
                raise ContainerStartupError(f"启动容器时发生错误: {e}") from e
            raise
    
    def stop(self) -> None:
        """停止并移除容器"""
        if not self.container_id and not self._started:
            return
        
        logger.info(f"停止容器: {self.name}")
        
        try:
            subprocess.run(
                ["docker", "stop", self.name],
                capture_output=True,
                timeout=30
            )
        except subprocess.TimeoutExpired:
            logger.warning(f"停止容器 {self.name} 超时，尝试强制停止")
            try:
                subprocess.run(
                    ["docker", "kill", self.name],
                    capture_output=True,
                    timeout=10
                )
            except:
                pass
        except Exception as e:
            logger.error(f"停止容器时发生错误: {e}")
        finally:
            self.container_id = None
            self._started = False
    
    def get_logs(self) -> str:
        """获取容器日志"""
        if not self.container_id:
            return ""
        
        try:
            result = subprocess.run(
                ["docker", "logs", self.name],
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout + result.stderr
        except:
            return ""
    
    def is_running(self) -> bool:
        """检查容器是否正在运行"""
        if not self.container_id:
            return False
        
        try:
            result = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Running}}", self.name],
                capture_output=True,
                text=True,
                timeout=10
            )
            return result.stdout.strip().lower() == "true"
        except:
            return False
    
    def get_connection_url(self) -> str:
        """获取连接 URL（子类可重写以提供特定格式）"""
        return f"{self.host}:{self.port}"
    
    def __enter__(self) -> "TestContainer":
        """上下文管理器入口"""
        return self.start()
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """上下文管理器出口"""
        self.stop()
    
    def __repr__(self) -> str:
        status = "running" if self._started else "stopped"
        return f"<{self.__class__.__name__} name={self.name} port={self.port} status={status}>"


# ============ 具体容器实现 ============

class RedisContainer(TestContainer):
    """
    Redis 测试容器
    
    使用示例:
        with RedisContainer() as redis:
            import redis as redis_client
            client = redis_client.Redis(host="localhost", port=redis.port)
            client.set("key", "value")
    """
    
    DEFAULT_IMAGE = "redis:7-alpine"
    DEFAULT_PORT = 6379
    
    def __init__(
        self,
        image: str = DEFAULT_IMAGE,
        port: Optional[int] = None,
        password: Optional[str] = None,
        **kwargs
    ):
        """
        初始化 Redis 容器
        
        Args:
            image: Docker 镜像（默认 redis:7-alpine）
            port: 外部端口（默认 6379）
            password: Redis 密码（可选）
            **kwargs: 传递给基类的参数
        """
        super().__init__(image=image, port=port, **kwargs)
        self.password = password
        
        if password:
            self.environment["REDIS_PASSWORD"] = password
    
    def _get_default_port(self) -> int:
        return self.DEFAULT_PORT
    
    def _get_extra_args(self) -> List[str]:
        args = []
        if self.password:
            args.extend(["--requirepass", self.password])
        return args
    
    def _wait_until_ready(self) -> bool:
        """等待 Redis 就绪"""
        return wait_for_port(self.host, self.port, timeout=self.startup_timeout)
    
    def get_connection_url(self) -> str:
        """获取 Redis 连接 URL"""
        if self.password:
            return f"redis://:{self.password}@{self.host}:{self.port}/0"
        return f"redis://{self.host}:{self.port}/0"


class MilvusContainer(TestContainer):
    """
    Milvus 测试容器（单机模式）
    
    使用示例:
        with MilvusContainer() as milvus:
            from pymilvus import connections
            connections.connect(host="localhost", port=str(milvus.port))
    
    注意: Milvus 启动较慢，默认超时时间为 120 秒
    """
    
    DEFAULT_IMAGE = "milvusdb/milvus:v2.3.3"
    DEFAULT_PORT = 19530
    GRPC_PORT = 19530
    REST_PORT = 9091
    
    def __init__(
        self,
        image: str = DEFAULT_IMAGE,
        port: Optional[int] = None,
        startup_timeout: float = 120.0,
        **kwargs
    ):
        """
        初始化 Milvus 容器
        
        Args:
            image: Docker 镜像（默认 milvusdb/milvus:v2.3.3）
            port: gRPC 端口（默认 19530）
            startup_timeout: 启动超时（默认 120 秒，Milvus 启动较慢）
            **kwargs: 传递给基类的参数
        """
        super().__init__(
            image=image,
            port=port,
            startup_timeout=startup_timeout,
            **kwargs
        )
    
    def _get_default_port(self) -> int:
        return self.DEFAULT_PORT
    
    def _get_extra_args(self) -> List[str]:
        """Milvus 单机模式所需的额外参数"""
        return [
            "-e", "ETCD_USE_EMBED=true",
            "-e", "ETCD_DATA_DIR=/var/lib/milvus/etcd",
            "-e", "ETCD_CONFIG_PATH=/milvus/configs/embedEtcd.yaml",
            "-e", "COMMON_STORAGETYPE=local",
            "milvus", "run", "standalone"
        ]
    
    def _wait_until_ready(self) -> bool:
        """等待 Milvus 就绪"""
        # Milvus 需要等待 gRPC 端口可用
        if not wait_for_port(self.host, self.port, timeout=self.startup_timeout):
            return False
        
        # 额外等待几秒确保服务完全就绪
        time.sleep(3)
        return True
    
    def get_connection_url(self) -> str:
        """获取 Milvus 连接参数"""
        return f"{self.host}:{self.port}"


class ChromaContainer(TestContainer):
    """
    Chroma 向量数据库测试容器
    
    使用示例:
        with ChromaContainer() as chroma:
            import chromadb
            client = chromadb.HttpClient(host="localhost", port=chroma.port)
    """
    
    DEFAULT_IMAGE = "chromadb/chroma:latest"
    DEFAULT_PORT = 8000
    
    def __init__(
        self,
        image: str = DEFAULT_IMAGE,
        port: Optional[int] = None,
        **kwargs
    ):
        super().__init__(image=image, port=port, **kwargs)
    
    def _get_default_port(self) -> int:
        return self.DEFAULT_PORT
    
    def _get_extra_args(self) -> List[str]:
        return []
    
    def _wait_until_ready(self) -> bool:
        """等待 Chroma 就绪"""
        return wait_for_port(self.host, self.port, timeout=self.startup_timeout)
    
    def get_connection_url(self) -> str:
        return f"http://{self.host}:{self.port}"


# ============ Pytest Fixtures ============

def skip_if_no_docker(reason: str = "Docker 不可用"):
    """
    pytest 标记：如果 Docker 不可用则跳过测试
    
    使用示例:
        import pytest
        from tests.integration.containers import skip_if_no_docker
        
        @skip_if_no_docker()
        def test_with_docker():
            ...
    """
    import pytest
    return pytest.mark.skipif(
        not is_docker_available(),
        reason=reason
    )


# 便捷装饰器
requires_docker = skip_if_no_docker("此测试需要 Docker 环境")

