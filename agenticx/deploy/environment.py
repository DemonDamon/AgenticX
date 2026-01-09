"""
AgenticX Deploy Environment

环境管理，支持多环境配置。
"""

import os
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
import logging

from .credentials import CredentialManager, get_credential_manager

logger = logging.getLogger(__name__)


@dataclass
class Environment:
    """
    部署环境
    
    定义一个部署环境的配置。
    """
    
    name: str
    """环境名称"""
    
    access: Optional[str] = None
    """访问凭证名称"""
    
    variables: Dict[str, str] = field(default_factory=dict)
    """环境变量"""
    
    region: Optional[str] = None
    """区域"""
    
    namespace: Optional[str] = None
    """命名空间（用于 K8s）"""
    
    tags: Dict[str, str] = field(default_factory=dict)
    """标签"""
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "name": self.name,
            "variables": self.variables,
            "tags": self.tags,
        }
        if self.access:
            result["access"] = self.access
        if self.region:
            result["region"] = self.region
        if self.namespace:
            result["namespace"] = self.namespace
        return result
    
    @classmethod
    def from_dict(cls, name: str, data: Dict[str, Any]) -> "Environment":
        return cls(
            name=name,
            access=data.get("access"),
            variables=data.get("variables", {}),
            region=data.get("region"),
            namespace=data.get("namespace"),
            tags=data.get("tags", {}),
        )
    
    def get_variable(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """获取环境变量"""
        return self.variables.get(key) or os.environ.get(key) or default
    
    def get_all_variables(self) -> Dict[str, str]:
        """获取所有环境变量（包括系统环境变量）"""
        result = os.environ.copy()
        result.update(self.variables)
        return result


class EnvironmentManager:
    """
    环境管理器
    
    管理多个部署环境。
    
    Example:
        >>> manager = EnvironmentManager()
        >>> 
        >>> # 添加环境
        >>> manager.add(Environment(
        ...     name="dev",
        ...     access="dev-creds",
        ...     variables={"DEBUG": "true"},
        ... ))
        >>> 
        >>> # 切换环境
        >>> manager.set_current("dev")
        >>> 
        >>> # 获取当前环境
        >>> env = manager.current
    """
    
    # 默认环境名称
    DEFAULT_ENV = "default"
    
    def __init__(self, credential_manager: Optional[CredentialManager] = None):
        """
        初始化环境管理器
        
        Args:
            credential_manager: 凭证管理器
        """
        self._environments: Dict[str, Environment] = {}
        self._current_name: str = self.DEFAULT_ENV
        self._credential_manager = credential_manager or get_credential_manager()
        
        # 添加默认环境
        self._environments[self.DEFAULT_ENV] = Environment(name=self.DEFAULT_ENV)
    
    @property
    def current(self) -> Environment:
        """当前环境"""
        return self._environments.get(self._current_name, self._environments[self.DEFAULT_ENV])
    
    @property
    def current_name(self) -> str:
        """当前环境名称"""
        return self._current_name
    
    def add(self, environment: Environment) -> None:
        """
        添加环境
        
        Args:
            environment: 环境配置
        """
        self._environments[environment.name] = environment
        logger.debug(f"Added environment: {environment.name}")
    
    def get(self, name: str) -> Optional[Environment]:
        """
        获取环境
        
        Args:
            name: 环境名称
            
        Returns:
            环境配置
        """
        return self._environments.get(name)
    
    def remove(self, name: str) -> bool:
        """
        删除环境
        
        Args:
            name: 环境名称
            
        Returns:
            是否删除成功
        """
        if name == self.DEFAULT_ENV:
            logger.warning("Cannot remove default environment")
            return False
        
        if name in self._environments:
            del self._environments[name]
            if self._current_name == name:
                self._current_name = self.DEFAULT_ENV
            return True
        return False
    
    def list(self) -> List[str]:
        """
        列出所有环境
        
        Returns:
            环境名称列表
        """
        return list(self._environments.keys())
    
    def set_current(self, name: str) -> bool:
        """
        设置当前环境
        
        Args:
            name: 环境名称
            
        Returns:
            是否设置成功
        """
        if name not in self._environments:
            logger.warning(f"Environment not found: {name}")
            return False
        
        self._current_name = name
        logger.info(f"Switched to environment: {name}")
        return True
    
    def load_from_config(self, environments_config: Dict[str, Dict[str, Any]]) -> None:
        """
        从配置加载环境
        
        Args:
            environments_config: 环境配置字典
        """
        for name, config in environments_config.items():
            env = Environment.from_dict(name, config)
            self.add(env)
    
    def get_credentials(self, environment: Optional[str] = None):
        """
        获取环境的凭证
        
        Args:
            environment: 环境名称，默认为当前环境
            
        Returns:
            凭证
        """
        env = self.get(environment) if environment else self.current
        if env and env.access:
            return self._credential_manager.get(env.access)
        return None


# 默认环境管理器
_default_manager: Optional[EnvironmentManager] = None


def get_environment_manager() -> EnvironmentManager:
    """获取默认环境管理器"""
    global _default_manager
    if _default_manager is None:
        _default_manager = EnvironmentManager()
    return _default_manager


def get_current_environment() -> Environment:
    """获取当前环境"""
    return get_environment_manager().current


def set_current_environment(name: str) -> bool:
    """设置当前环境"""
    return get_environment_manager().set_current(name)
