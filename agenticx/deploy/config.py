"""
AgenticX Deploy Config

YAML 配置管理，支持 agenticx.yaml 配置文件。
"""

import os
from typing import Optional, Dict, Any, List
from pathlib import Path
from dataclasses import dataclass, field
import logging

import yaml  # type: ignore[import-untyped]

from .types import DeploymentConfig, ResourceSpec

logger = logging.getLogger(__name__)


# 配置文件名
CONFIG_FILENAME = "agenticx.yaml"
CONFIG_FILENAMES = ["agenticx.yaml", "agenticx.yml", ".agenticx.yaml", ".agenticx.yml"]


@dataclass
class ProjectConfig:
    """
    项目配置
    
    从 agenticx.yaml 加载的完整项目配置。
    
    Example agenticx.yaml:
        ```yaml
        version: 1.0.0
        name: my-agent
        description: My AgenticX Agent
        
        environments:
          dev:
            access: dev-access
          prod:
            access: prod-access
        
        deployments:
          - name: docker
            component: docker
            props:
              image: my-agent:latest
              ports:
                "8080": "80"
        ```
    """
    
    version: str = "1.0.0"
    """配置版本"""
    
    name: str = ""
    """项目名称"""
    
    description: str = ""
    """项目描述"""
    
    environments: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    """环境配置"""
    
    deployments: List[DeploymentConfig] = field(default_factory=list)
    """部署配置列表"""
    
    variables: Dict[str, str] = field(default_factory=dict)
    """全局变量"""
    
    hooks: Dict[str, List[str]] = field(default_factory=dict)
    """生命周期钩子"""
    
    metadata: Dict[str, Any] = field(default_factory=dict)
    """元数据"""
    
    _config_path: Optional[Path] = None
    """配置文件路径"""
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "version": self.version,
            "name": self.name,
            "description": self.description,
            "environments": self.environments,
            "deployments": [d.to_dict() for d in self.deployments],
            "variables": self.variables,
            "hooks": self.hooks,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProjectConfig":
        """从字典创建"""
        deployments = []
        for d in data.get("deployments", []):
            if isinstance(d, dict):
                deployments.append(DeploymentConfig.from_dict(d))
            else:
                deployments.append(d)
        
        return cls(
            version=data.get("version", "1.0.0"),
            name=data.get("name", ""),
            description=data.get("description", ""),
            environments=data.get("environments", {}),
            deployments=deployments,
            variables=data.get("variables", {}),
            hooks=data.get("hooks", {}),
            metadata=data.get("metadata", {}),
        )
    
    def save(self, path: Optional[Path] = None) -> Path:
        """
        保存配置到文件
        
        Args:
            path: 文件路径，默认为原路径或当前目录
            
        Returns:
            保存的文件路径
        """
        if path is None:
            path = self._config_path or Path.cwd() / CONFIG_FILENAME
        
        path = Path(path)
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(self.to_dict(), f, default_flow_style=False, allow_unicode=True)
        
        self._config_path = path
        logger.info(f"Config saved to {path}")
        return path
    
    def get_deployment(
        self,
        name: Optional[str] = None,
        environment: Optional[str] = None,
    ) -> Optional[DeploymentConfig]:
        """
        获取部署配置
        
        Args:
            name: 部署名称，如果为 None 则返回第一个
            environment: 环境名称
            
        Returns:
            部署配置
        """
        for deployment in self.deployments:
            if name is None or deployment.name == name:
                if environment:
                    deployment.environment = environment
                return deployment
        return None
    
    def get_environment_config(self, environment: str) -> Dict[str, Any]:
        """
        获取环境配置
        
        Args:
            environment: 环境名称
            
        Returns:
            环境配置
        """
        return self.environments.get(environment, {})
    
    def resolve_variables(self, text: str) -> str:
        """
        解析变量
        
        支持 ${VAR_NAME} 格式的变量替换。
        
        Args:
            text: 包含变量的文本
            
        Returns:
            解析后的文本
        """
        for key, value in self.variables.items():
            text = text.replace(f"${{{key}}}", value)
        
        # 支持环境变量
        for key, value in os.environ.items():
            text = text.replace(f"${{{key}}}", value)
        
        return text


def load_config(
    path: Optional[Path] = None,
    search_parents: bool = True,
) -> Optional[ProjectConfig]:
    """
    加载配置文件
    
    Args:
        path: 配置文件路径，如果为 None 则自动搜索
        search_parents: 是否搜索父目录
        
    Returns:
        项目配置，如果未找到则返回 None
    """
    if path is not None:
        config_path = Path(path)
        if config_path.exists():
            return _load_config_file(config_path)
        return None
    
    # 自动搜索
    current_dir = Path.cwd()
    
    while True:
        for filename in CONFIG_FILENAMES:
            config_path = current_dir / filename
            if config_path.exists():
                return _load_config_file(config_path)
        
        if not search_parents:
            break
        
        parent = current_dir.parent
        if parent == current_dir:
            break
        current_dir = parent
    
    return None


def _load_config_file(path: Path) -> ProjectConfig:
    """加载配置文件"""
    logger.debug(f"Loading config from {path}")
    
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    
    config = ProjectConfig.from_dict(data)
    config._config_path = path
    
    return config


def create_default_config(
    name: str,
    component: str = "docker",
    **kwargs,
) -> ProjectConfig:
    """
    创建默认配置
    
    Args:
        name: 项目名称
        component: 默认组件类型
        **kwargs: 额外配置
        
    Returns:
        项目配置
    """
    return ProjectConfig(
        name=name,
        description=f"AgenticX project: {name}",
        environments={
            "dev": {"access": "dev"},
            "prod": {"access": "prod"},
        },
        deployments=[
            DeploymentConfig(
                name="default",
                component=component,
                props=kwargs.get("props", {}),
            )
        ],
    )


def init_config(
    directory: Optional[Path] = None,
    name: Optional[str] = None,
    force: bool = False,
) -> Path:
    """
    初始化配置文件
    
    Args:
        directory: 目标目录
        name: 项目名称
        force: 是否覆盖已存在的配置
        
    Returns:
        配置文件路径
        
    Raises:
        FileExistsError: 配置文件已存在且 force=False
    """
    directory = Path(directory) if directory else Path.cwd()
    config_path = directory / CONFIG_FILENAME
    
    if config_path.exists() and not force:
        raise FileExistsError(f"Config file already exists: {config_path}")
    
    project_name = name or directory.name
    config = create_default_config(project_name)
    config.save(config_path)
    
    return config_path
