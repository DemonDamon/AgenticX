"""
AgenticX 集成测试包

本包提供类 Testcontainers 的测试基础设施，用于需要外部服务的集成测试。

内化来源: Spring AI Testcontainers
设计理念: 使用 subprocess 调用 docker CLI，避免引入额外的 Python 依赖

使用示例:
    from tests.integration.containers import RedisContainer
    
    @pytest.fixture(scope="module")
    def redis():
        container = RedisContainer()
        container.start()
        yield container
        container.stop()
"""

from .containers import (
    TestContainer,
    RedisContainer,
    MilvusContainer,
    ContainerError,
    ContainerStartupError,
    ContainerNotFoundError,
    DockerNotAvailableError
)

__all__ = [
    "TestContainer",
    "RedisContainer",
    "MilvusContainer",
    "ContainerError",
    "ContainerStartupError",
    "ContainerNotFoundError",
    "DockerNotAvailableError"
]

