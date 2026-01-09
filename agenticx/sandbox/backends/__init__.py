"""
AgenticX Sandbox Backends

沙箱后端实现，提供不同级别的隔离能力。

可用后端:
- subprocess: 基于子进程的简单隔离（MVP，适合开发测试）
- microsandbox: 硬件级隔离（推荐，需要 microsandbox 服务）
- docker: Docker 容器隔离（降级方案）
"""

from typing import Dict, Type, Optional
import logging

logger = logging.getLogger(__name__)

# 后端注册表
_BACKENDS: Dict[str, Type] = {}


def register_backend(name: str):
    """
    后端注册装饰器
    
    Example:
        >>> @register_backend("custom")
        ... class CustomSandbox(SandboxBase):
        ...     pass
    """
    def decorator(cls):
        _BACKENDS[name] = cls
        logger.debug(f"Registered sandbox backend: {name}")
        return cls
    return decorator


def get_backend(name: str) -> Optional[Type]:
    """
    获取后端类
    
    Args:
        name: 后端名称
        
    Returns:
        后端类，如果不存在则返回 None
    """
    return _BACKENDS.get(name)


def list_backends() -> list:
    """
    列出所有可用后端
    
    Returns:
        后端名称列表
    """
    return list(_BACKENDS.keys())


# 自动导入可用后端
try:
    from .subprocess import SubprocessSandbox
    _BACKENDS["subprocess"] = SubprocessSandbox
except ImportError as e:
    logger.debug(f"Subprocess backend not available: {e}")

try:
    from .microsandbox import MicrosandboxSandbox
    _BACKENDS["microsandbox"] = MicrosandboxSandbox
except ImportError as e:
    logger.debug(f"Microsandbox backend not available: {e}")

try:
    from .docker import DockerSandbox
    _BACKENDS["docker"] = DockerSandbox
except ImportError as e:
    logger.debug(f"Docker backend not available: {e}")


__all__ = [
    "register_backend",
    "get_backend",
    "list_backends",
]
