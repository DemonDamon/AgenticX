"""
AgenticX Deploy Module

提供 Agent 部署能力，支持 Docker、本地等多种部署方式。

Example:
    >>> from agenticx.deploy import ProjectConfig, load_config
    >>> from agenticx.deploy.components import DockerComponent
    >>> 
    >>> # 加载配置
    >>> config = load_config()
    >>> deployment = config.get_deployment("my-agent")
    >>> 
    >>> # 执行部署
    >>> component = DockerComponent()
    >>> result = await component.deploy(deployment)
    >>> print(result.status)
"""

from .types import (
    # 枚举
    DeploymentStatus,
    ComponentType,
    # 数据类
    ResourceSpec,
    DeploymentConfig,
    DeploymentResult,
    RemoveResult,
    StatusResult,
    # 异常
    DeployError,
    DeployConfigError,
    DeployExecutionError,
    DeployResourceError,
)

from .base import (
    DeploymentComponent,
    ComponentRegistry,
    register_component,
)

from .config import (
    ProjectConfig,
    load_config,
    create_default_config,
    init_config,
    CONFIG_FILENAME,
)

from .credentials import (
    Credential,
    CredentialManager,
    get_credential_manager,
    get_credential,
    save_credential,
)

from .environment import (
    Environment,
    EnvironmentManager,
    get_environment_manager,
    get_current_environment,
    set_current_environment,
)

__all__ = [
    # 核心类
    "DeploymentComponent",
    "ComponentRegistry",
    "register_component",
    # 配置
    "ProjectConfig",
    "load_config",
    "create_default_config",
    "init_config",
    "CONFIG_FILENAME",
    # 凭证
    "Credential",
    "CredentialManager",
    "get_credential_manager",
    "get_credential",
    "save_credential",
    # 环境
    "Environment",
    "EnvironmentManager",
    "get_environment_manager",
    "get_current_environment",
    "set_current_environment",
    # 枚举
    "DeploymentStatus",
    "ComponentType",
    # 数据类
    "ResourceSpec",
    "DeploymentConfig",
    "DeploymentResult",
    "RemoveResult",
    "StatusResult",
    # 异常
    "DeployError",
    "DeployConfigError",
    "DeployExecutionError",
    "DeployResourceError",
]

__version__ = "0.1.0"
