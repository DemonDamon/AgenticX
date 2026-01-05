"""
冒烟测试: 集成测试容器增强 (Spring AI 内化)

本测试验证 AgenticX 的类 Testcontainers 集成测试基础设施:
- B1: TestContainer 抽象基类
- B2: Redis 测试容器
- B3: Milvus 测试容器

内化来源: Spring AI Testcontainers 集成测试模式
设计理念: 使用 subprocess 调用 docker CLI，避免引入额外的 Python 依赖

注意: 这些测试需要 Docker 环境。如果 Docker 不可用，测试会自动跳过。
"""

import pytest
import subprocess
import socket
import time
from unittest.mock import patch, MagicMock

# 导入测试目标
from tests.integration.containers import (
    TestContainer,
    RedisContainer,
    MilvusContainer,
    ChromaContainer,
    ContainerError,
    ContainerStartupError,
    ContainerNotFoundError,
    DockerNotAvailableError,
    is_docker_available,
    wait_for_port,
    find_free_port
)


# ============ 单元测试（无需 Docker）============

class TestHelperFunctions:
    """测试辅助函数"""
    
    def test_is_docker_available_returns_bool(self):
        """测试 is_docker_available 返回布尔值"""
        result = is_docker_available()
        assert isinstance(result, bool)
    
    def test_find_free_port_returns_valid_port(self):
        """测试 find_free_port 返回有效端口"""
        port = find_free_port()
        assert isinstance(port, int)
        assert 1024 <= port <= 65535
    
    def test_find_free_port_is_actually_free(self):
        """测试返回的端口确实是空闲的"""
        port = find_free_port()
        
        # 尝试绑定该端口（应该成功）
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', port))
            s.listen(1)
    
    def test_wait_for_port_timeout(self):
        """测试 wait_for_port 超时行为"""
        # 使用一个肯定不会监听的端口
        result = wait_for_port("localhost", 65534, timeout=0.5)
        assert result is False


class TestRedisContainerUnit:
    """Redis 容器单元测试（无需 Docker）"""
    
    def test_default_values(self):
        """测试默认值"""
        container = RedisContainer()
        
        assert container.image == "redis:7-alpine"
        assert container.port == 6379
        assert container.host == "localhost"
        assert container.auto_remove is True
    
    def test_custom_port(self):
        """测试自定义端口"""
        container = RedisContainer(port=16379)
        assert container.port == 16379
    
    def test_password_configuration(self):
        """测试密码配置"""
        container = RedisContainer(password="secret123")
        
        assert container.password == "secret123"
        assert container.environment.get("REDIS_PASSWORD") == "secret123"
    
    def test_connection_url_without_password(self):
        """测试无密码时的连接 URL"""
        container = RedisContainer(port=6379)
        url = container.get_connection_url()
        
        assert url == "redis://localhost:6379/0"
    
    def test_connection_url_with_password(self):
        """测试有密码时的连接 URL"""
        container = RedisContainer(port=6379, password="secret")
        url = container.get_connection_url()
        
        assert url == "redis://:secret@localhost:6379/0"
    
    def test_repr(self):
        """测试字符串表示"""
        container = RedisContainer()
        repr_str = repr(container)
        
        assert "RedisContainer" in repr_str
        assert "6379" in repr_str
        assert "stopped" in repr_str


class TestMilvusContainerUnit:
    """Milvus 容器单元测试（无需 Docker）"""
    
    def test_default_values(self):
        """测试默认值"""
        container = MilvusContainer()
        
        assert "milvus" in container.image.lower()
        assert container.port == 19530
        assert container.startup_timeout == 120.0  # Milvus 默认超时更长
    
    def test_extra_args_for_standalone(self):
        """测试单机模式的额外参数"""
        container = MilvusContainer()
        args = container._get_extra_args()
        
        assert "-e" in args
        assert "ETCD_USE_EMBED=true" in args
        assert "COMMON_STORAGETYPE=local" in args


class TestChromaContainerUnit:
    """Chroma 容器单元测试（无需 Docker）"""
    
    def test_default_values(self):
        """测试默认值"""
        container = ChromaContainer()
        
        assert "chroma" in container.image.lower()
        assert container.port == 8000
    
    def test_connection_url(self):
        """测试连接 URL"""
        container = ChromaContainer(port=8000)
        url = container.get_connection_url()
        
        assert url == "http://localhost:8000"


class TestContainerLifecycle:
    """测试容器生命周期（模拟 Docker）"""
    
    @patch('tests.integration.containers.is_docker_available')
    def test_start_without_docker(self, mock_docker):
        """测试 Docker 不可用时启动失败"""
        mock_docker.return_value = False
        
        container = RedisContainer()
        
        with pytest.raises(DockerNotAvailableError):
            container.start()
    
    @patch('subprocess.run')
    @patch('tests.integration.containers.is_docker_available')
    def test_stop_handles_errors_gracefully(self, mock_docker, mock_run):
        """测试停止容器时优雅处理错误"""
        mock_docker.return_value = True
        mock_run.side_effect = Exception("模拟错误")
        
        container = RedisContainer()
        container.container_id = "fake_id"
        container._started = True
        
        # 不应抛出异常
        container.stop()
        
        # 状态应被重置
        assert container.container_id is None
        assert container._started is False
    
    def test_context_manager_interface(self):
        """测试上下文管理器接口"""
        container = RedisContainer()
        
        # 验证有 __enter__ 和 __exit__ 方法
        assert hasattr(container, '__enter__')
        assert hasattr(container, '__exit__')


class TestExceptionHierarchy:
    """测试异常层次结构"""
    
    def test_container_error_is_base(self):
        """测试 ContainerError 是基础异常"""
        assert issubclass(ContainerStartupError, ContainerError)
        assert issubclass(ContainerNotFoundError, ContainerError)
        assert issubclass(DockerNotAvailableError, ContainerError)
    
    def test_exceptions_can_be_raised(self):
        """测试异常可以被正常抛出"""
        with pytest.raises(ContainerStartupError):
            raise ContainerStartupError("测试错误")
        
        with pytest.raises(DockerNotAvailableError):
            raise DockerNotAvailableError("Docker 不可用")


# ============ 集成测试（需要 Docker）============

@pytest.mark.skipif(
    not is_docker_available(),
    reason="此测试需要 Docker 环境"
)
class TestRedisContainerIntegration:
    """Redis 容器集成测试"""
    
    def test_start_and_stop(self):
        """测试启动和停止容器"""
        # 使用空闲端口避免冲突
        free_port = find_free_port()
        container = RedisContainer(port=free_port)
        
        try:
            container.start()
            
            assert container._started is True
            assert container.container_id is not None
            assert container.is_running() is True
            
        finally:
            container.stop()
            assert container._started is False
    
    def test_context_manager(self):
        """测试上下文管理器"""
        free_port = find_free_port()
        with RedisContainer(port=free_port) as container:
            assert container._started is True
            assert container.is_running() is True
        
        # 退出后应该已停止
        assert container._started is False
    
    def test_port_is_accessible(self):
        """测试端口可访问"""
        free_port = find_free_port()
        with RedisContainer(port=free_port) as container:
            # 验证端口可连接
            result = wait_for_port("localhost", container.port, timeout=5)
            assert result is True
    
    def test_get_logs(self):
        """测试获取日志"""
        free_port = find_free_port()
        with RedisContainer(port=free_port) as container:
            # 等待一下让容器产生日志
            time.sleep(1)
            
            logs = container.get_logs()
            # Redis 启动时应该有一些日志
            assert isinstance(logs, str)


@pytest.mark.skipif(
    not is_docker_available(),
    reason="此测试需要 Docker 环境"
)
class TestChromaContainerIntegration:
    """Chroma 容器集成测试"""
    
    def test_start_and_stop(self):
        """测试启动和停止 Chroma 容器"""
        free_port = find_free_port()
        container = ChromaContainer(port=free_port, startup_timeout=90)
        
        try:
            container.start()
            
            assert container._started is True
            assert container.is_running() is True
            
            # 验证 HTTP 端口可访问
            result = wait_for_port("localhost", container.port, timeout=30)
            assert result is True
            
        except ContainerStartupError as e:
            # 如果是镜像拉取超时，跳过测试
            if "超时" in str(e) or "timeout" in str(e).lower():
                pytest.skip(f"容器启动超时（可能是网络问题）: {e}")
            raise
        finally:
            container.stop()


# 标记慢速测试（Milvus 启动需要较长时间）
@pytest.mark.slow
@pytest.mark.skipif(
    not is_docker_available(),
    reason="此测试需要 Docker 环境"
)
class TestMilvusContainerIntegration:
    """Milvus 容器集成测试（慢速）"""
    
    def test_start_and_stop(self):
        """测试启动和停止 Milvus 容器"""
        free_port = find_free_port()
        container = MilvusContainer(port=free_port, startup_timeout=180)
        
        try:
            container.start()
            
            assert container._started is True
            assert container.is_running() is True
            
        except ContainerStartupError as e:
            # 如果是镜像不存在或网络问题，跳过测试
            error_msg = str(e).lower()
            if any(x in error_msg for x in ["unable to find image", "超时", "timeout", "eof", "network"]):
                pytest.skip(f"容器启动失败（可能是网络/镜像问题）: {e}")
            raise
        finally:
            container.stop()


# ============ 边界条件测试 ============

class TestEdgeCases:
    """边界条件测试"""
    
    def test_multiple_container_instances(self):
        """测试创建多个容器实例"""
        container1 = RedisContainer(port=6380)
        container2 = RedisContainer(port=6381)
        
        assert container1.name != container2.name
        assert container1.port != container2.port
    
    def test_custom_name(self):
        """测试自定义容器名称"""
        container = RedisContainer(name="my-custom-redis")
        assert container.name == "my-custom-redis"
    
    def test_environment_variables(self):
        """测试环境变量设置"""
        container = RedisContainer(
            environment={"MY_VAR": "my_value"}
        )
        assert container.environment["MY_VAR"] == "my_value"
    
    def test_is_running_when_not_started(self):
        """测试未启动时 is_running 返回 False"""
        container = RedisContainer()
        assert container.is_running() is False
    
    def test_get_logs_when_not_started(self):
        """测试未启动时获取日志返回空字符串"""
        container = RedisContainer()
        logs = container.get_logs()
        assert logs == ""


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

