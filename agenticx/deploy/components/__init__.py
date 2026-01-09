"""
AgenticX Deploy Components

部署组件实现。
"""

from typing import Dict, Type
import logging

logger = logging.getLogger(__name__)

# 组件映射
_COMPONENTS: Dict[str, Type] = {}


def get_component(name: str):
    """获取组件类"""
    return _COMPONENTS.get(name)


def list_components():
    """列出所有组件"""
    return list(_COMPONENTS.keys())


# 自动导入可用组件
try:
    from .docker import DockerComponent
    _COMPONENTS["docker"] = DockerComponent
except ImportError as e:
    logger.debug(f"Docker component not available: {e}")

try:
    from .local import LocalComponent
    _COMPONENTS["local"] = LocalComponent
except ImportError as e:
    logger.debug(f"Local component not available: {e}")


__all__ = [
    "get_component",
    "list_components",
]
