"""
AgenticX Deploy Base

定义部署组件的抽象基类。
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
import logging

from .types import (
    DeploymentConfig,
    DeploymentResult,
    RemoveResult,
    StatusResult,
    DeploymentStatus,
)

logger = logging.getLogger(__name__)


class DeploymentComponent(ABC):
    """
    部署组件抽象基类
    
    定义所有部署组件必须实现的接口。
    
    子类实现：
    - DockerComponent: Docker 容器部署
    - KubernetesComponent: Kubernetes 部署
    - ServerlessComponent: 无服务器部署
    
    Example:
        >>> class MyComponent(DeploymentComponent):
        ...     @property
        ...     def name(self) -> str:
        ...         return "my-component"
        ...     
        ...     async def deploy(self, config):
        ...         # 实现部署逻辑
        ...         pass
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """组件名称"""
        pass
    
    @property
    def version(self) -> str:
        """组件版本"""
        return "1.0.0"
    
    @property
    def description(self) -> str:
        """组件描述"""
        return ""
    
    @abstractmethod
    async def deploy(self, config: DeploymentConfig) -> DeploymentResult:
        """
        执行部署
        
        Args:
            config: 部署配置
            
        Returns:
            DeploymentResult: 部署结果
        """
        pass
    
    @abstractmethod
    async def remove(self, config: DeploymentConfig) -> RemoveResult:
        """
        删除部署
        
        Args:
            config: 部署配置
            
        Returns:
            RemoveResult: 删除结果
        """
        pass
    
    @abstractmethod
    async def status(self, config: DeploymentConfig) -> StatusResult:
        """
        查询部署状态
        
        Args:
            config: 部署配置
            
        Returns:
            StatusResult: 状态结果
        """
        pass
    
    async def validate(self, config: DeploymentConfig) -> List[str]:
        """
        验证配置
        
        Args:
            config: 部署配置
            
        Returns:
            错误列表，为空表示验证通过
        """
        errors = []
        
        if not config.name:
            errors.append("Deployment name is required")
        
        if config.replicas < 1:
            errors.append("Replicas must be at least 1")
        
        return errors
    
    async def pre_deploy(self, config: DeploymentConfig) -> None:
        """
        部署前钩子
        
        子类可以重写此方法执行部署前的准备工作。
        
        Args:
            config: 部署配置
        """
        logger.debug(f"Pre-deploy hook for {config.name}")
    
    async def post_deploy(
        self,
        config: DeploymentConfig,
        result: DeploymentResult,
    ) -> None:
        """
        部署后钩子
        
        子类可以重写此方法执行部署后的清理或通知工作。
        
        Args:
            config: 部署配置
            result: 部署结果
        """
        logger.debug(f"Post-deploy hook for {config.name}: {result.status}")
    
    async def logs(
        self,
        config: DeploymentConfig,
        lines: int = 100,
        follow: bool = False,
    ):
        """
        获取部署日志
        
        Args:
            config: 部署配置
            lines: 日志行数
            follow: 是否实时跟踪
            
        Yields:
            日志行
        """
        raise NotImplementedError(f"{self.name} does not support logs")
    
    async def scale(
        self,
        config: DeploymentConfig,
        replicas: int,
    ) -> DeploymentResult:
        """
        扩缩容
        
        Args:
            config: 部署配置
            replicas: 目标副本数
            
        Returns:
            DeploymentResult: 结果
        """
        raise NotImplementedError(f"{self.name} does not support scaling")
    
    async def restart(self, config: DeploymentConfig) -> DeploymentResult:
        """
        重启部署
        
        Args:
            config: 部署配置
            
        Returns:
            DeploymentResult: 结果
        """
        # 默认实现：先删除再部署
        await self.remove(config)
        return await self.deploy(config)
    
    def get_required_props(self) -> List[str]:
        """
        获取必需的属性
        
        Returns:
            属性名列表
        """
        return []
    
    def get_optional_props(self) -> Dict[str, Any]:
        """
        获取可选属性及其默认值
        
        Returns:
            属性名到默认值的映射
        """
        return {}


class ComponentRegistry:
    """
    组件注册表
    
    管理所有可用的部署组件。
    """
    
    _instance = None
    _components: Dict[str, DeploymentComponent] = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._components = {}
        return cls._instance
    
    @classmethod
    def register(cls, component: DeploymentComponent) -> None:
        """
        注册组件
        
        Args:
            component: 部署组件
        """
        cls._components[component.name] = component
        logger.debug(f"Registered deployment component: {component.name}")
    
    @classmethod
    def get(cls, name: str) -> Optional[DeploymentComponent]:
        """
        获取组件
        
        Args:
            name: 组件名称
            
        Returns:
            部署组件，如果不存在则返回 None
        """
        return cls._components.get(name)
    
    @classmethod
    def list_components(cls) -> List[str]:
        """
        列出所有组件
        
        Returns:
            组件名称列表
        """
        return list(cls._components.keys())
    
    @classmethod
    def clear(cls) -> None:
        """清空注册表"""
        cls._components.clear()


def register_component(component: DeploymentComponent) -> DeploymentComponent:
    """
    注册组件的装饰器
    
    Example:
        >>> @register_component
        ... class MyComponent(DeploymentComponent):
        ...     pass
    """
    ComponentRegistry.register(component)
    return component
