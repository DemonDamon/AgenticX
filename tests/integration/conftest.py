"""
集成测试 pytest fixtures

本模块提供用于集成测试的共享 fixtures。

使用示例:
    def test_with_redis(redis_container):
        # redis_container 已自动启动
        import redis
        client = redis.Redis(host="localhost", port=redis_container.port)
        client.ping()
"""

import pytest
import logging
from typing import Generator

from .containers import (
    RedisContainer,
    MilvusContainer,
    ChromaContainer,
    is_docker_available
)

logger = logging.getLogger(__name__)


# ============ Docker 可用性检查 ============

@pytest.fixture(scope="session")
def docker_available() -> bool:
    """检查 Docker 是否可用"""
    available = is_docker_available()
    if not available:
        logger.warning("Docker 不可用，相关测试将被跳过")
    return available


# ============ Redis Fixtures ============

@pytest.fixture(scope="module")
def redis_container(docker_available) -> Generator[RedisContainer, None, None]:
    """
    模块级别的 Redis 容器 fixture
    
    整个测试模块共享一个容器实例。
    """
    if not docker_available:
        pytest.skip("Docker 不可用")
    
    container = RedisContainer()
    try:
        container.start()
        yield container
    finally:
        container.stop()


@pytest.fixture
def redis_container_per_test(docker_available) -> Generator[RedisContainer, None, None]:
    """
    测试级别的 Redis 容器 fixture
    
    每个测试函数使用独立的容器实例。
    """
    if not docker_available:
        pytest.skip("Docker 不可用")
    
    container = RedisContainer()
    try:
        container.start()
        yield container
    finally:
        container.stop()


# ============ Milvus Fixtures ============

@pytest.fixture(scope="module")
def milvus_container(docker_available) -> Generator[MilvusContainer, None, None]:
    """
    模块级别的 Milvus 容器 fixture
    
    注意: Milvus 启动较慢（约 60-120 秒）
    """
    if not docker_available:
        pytest.skip("Docker 不可用")
    
    container = MilvusContainer()
    try:
        container.start()
        yield container
    finally:
        container.stop()


# ============ Chroma Fixtures ============

@pytest.fixture(scope="module")
def chroma_container(docker_available) -> Generator[ChromaContainer, None, None]:
    """模块级别的 Chroma 容器 fixture"""
    if not docker_available:
        pytest.skip("Docker 不可用")
    
    container = ChromaContainer()
    try:
        container.start()
        yield container
    finally:
        container.stop()


# ============ 复合 Fixtures ============

@pytest.fixture(scope="module")
def all_containers(docker_available) -> Generator[dict, None, None]:
    """
    启动所有常用容器的复合 fixture
    
    Returns:
        包含所有容器的字典: {"redis": RedisContainer, ...}
    """
    if not docker_available:
        pytest.skip("Docker 不可用")
    
    containers = {}
    
    # 启动 Redis（快速）
    redis = RedisContainer()
    try:
        redis.start()
        containers["redis"] = redis
    except Exception as e:
        logger.warning(f"Redis 容器启动失败: {e}")
    
    # 启动 Chroma（中等速度）
    chroma = ChromaContainer()
    try:
        chroma.start()
        containers["chroma"] = chroma
    except Exception as e:
        logger.warning(f"Chroma 容器启动失败: {e}")
    
    yield containers
    
    # 清理所有容器
    for name, container in containers.items():
        try:
            container.stop()
        except Exception as e:
            logger.warning(f"停止 {name} 容器时发生错误: {e}")

