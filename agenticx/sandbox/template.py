"""
AgenticX Sandbox Template

沙箱配置模板，定义沙箱的资源配置和行为参数。

参考 AgentRun-SDK-Python 的 Template 设计，实现配置与实例分离。
"""

from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from pathlib import Path
import json
import yaml

from .types import SandboxType


@dataclass
class SandboxTemplate:
    """
    沙箱配置模板
    
    定义沙箱的资源限制、超时配置和后端选择。
    支持保存和加载模板配置。
    
    Example:
        >>> template = SandboxTemplate(
        ...     name="code-executor",
        ...     type=SandboxType.CODE_INTERPRETER,
        ...     cpu=2.0,
        ...     memory_mb=4096,
        ... )
        >>> template.save()
        >>> loaded = SandboxTemplate.load("code-executor")
    """
    
    name: str
    """模板名称，用于标识和加载"""
    
    type: SandboxType = SandboxType.CODE_INTERPRETER
    """沙箱类型"""
    
    # 资源限制
    cpu: float = 1.0
    """CPU 核数限制"""
    
    memory_mb: int = 2048
    """内存限制（MB）"""
    
    disk_mb: int = 10240
    """磁盘限制（MB）"""
    
    # 超时配置
    timeout_seconds: int = 300
    """单次执行超时（秒）"""
    
    idle_timeout_seconds: int = 600
    """空闲超时（秒），超时后自动销毁"""
    
    startup_timeout_seconds: int = 60
    """启动超时（秒）"""
    
    # 后端配置
    backend: str = "auto"
    """后端选择: auto, subprocess, microsandbox, docker"""
    
    backend_config: Dict[str, Any] = field(default_factory=dict)
    """后端特定配置"""
    
    # 网络配置
    network_enabled: bool = False
    """是否启用网络访问"""
    
    allowed_hosts: List[str] = field(default_factory=list)
    """允许访问的主机列表"""
    
    # 环境配置
    environment: Dict[str, str] = field(default_factory=dict)
    """环境变量"""
    
    working_directory: str = "/workspace"
    """工作目录"""
    
    # 元数据
    description: str = ""
    """模板描述"""
    
    tags: List[str] = field(default_factory=list)
    """标签"""
    
    # 存储路径
    _config_dir: Path = field(default_factory=lambda: Path.home() / ".agenticx" / "sandbox" / "templates")
    
    def __post_init__(self):
        """后处理：确保类型正确"""
        if isinstance(self.type, str):
            self.type = SandboxType(self.type)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "name": self.name,
            "type": self.type.value,
            "cpu": self.cpu,
            "memory_mb": self.memory_mb,
            "disk_mb": self.disk_mb,
            "timeout_seconds": self.timeout_seconds,
            "idle_timeout_seconds": self.idle_timeout_seconds,
            "startup_timeout_seconds": self.startup_timeout_seconds,
            "backend": self.backend,
            "backend_config": self.backend_config,
            "network_enabled": self.network_enabled,
            "allowed_hosts": self.allowed_hosts,
            "environment": self.environment,
            "working_directory": self.working_directory,
            "description": self.description,
            "tags": self.tags,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SandboxTemplate":
        """从字典创建"""
        # 过滤掉不存在的字段
        valid_fields = {
            "name", "type", "cpu", "memory_mb", "disk_mb",
            "timeout_seconds", "idle_timeout_seconds", "startup_timeout_seconds",
            "backend", "backend_config", "network_enabled", "allowed_hosts",
            "environment", "working_directory", "description", "tags",
        }
        filtered_data = {k: v for k, v in data.items() if k in valid_fields}
        return cls(**filtered_data)
    
    def save(self, config_dir: Optional[Path] = None) -> Path:
        """
        保存模板到文件
        
        Args:
            config_dir: 配置目录，默认为 ~/.agenticx/sandbox/templates
            
        Returns:
            保存的文件路径
        """
        dir_path = config_dir or self._config_dir
        dir_path.mkdir(parents=True, exist_ok=True)
        
        file_path = dir_path / f"{self.name}.yaml"
        with open(file_path, "w", encoding="utf-8") as f:
            yaml.dump(self.to_dict(), f, default_flow_style=False, allow_unicode=True)
        
        return file_path
    
    @classmethod
    def load(cls, name: str, config_dir: Optional[Path] = None) -> "SandboxTemplate":
        """
        从文件加载模板
        
        Args:
            name: 模板名称
            config_dir: 配置目录
            
        Returns:
            加载的模板实例
            
        Raises:
            FileNotFoundError: 模板文件不存在
        """
        dir_path = config_dir or (Path.home() / ".agenticx" / "sandbox" / "templates")
        
        # 尝试 YAML 格式
        yaml_path = dir_path / f"{name}.yaml"
        if yaml_path.exists():
            with open(yaml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
                return cls.from_dict(data)
        
        # 尝试 JSON 格式
        json_path = dir_path / f"{name}.json"
        if json_path.exists():
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return cls.from_dict(data)
        
        raise FileNotFoundError(f"Template '{name}' not found in {dir_path}")
    
    @classmethod
    def list_templates(cls, config_dir: Optional[Path] = None) -> List[str]:
        """
        列出所有可用模板
        
        Returns:
            模板名称列表
        """
        dir_path = config_dir or (Path.home() / ".agenticx" / "sandbox" / "templates")
        
        if not dir_path.exists():
            return []
        
        templates = []
        for file_path in dir_path.iterdir():
            if file_path.suffix in (".yaml", ".yml", ".json"):
                templates.append(file_path.stem)
        
        return sorted(templates)
    
    def validate(self) -> List[str]:
        """
        验证模板配置
        
        Returns:
            错误列表，为空表示验证通过
        """
        errors = []
        
        if not self.name:
            errors.append("Template name is required")
        
        if self.cpu <= 0:
            errors.append("CPU must be positive")
        
        if self.memory_mb <= 0:
            errors.append("Memory must be positive")
        
        if self.timeout_seconds <= 0:
            errors.append("Timeout must be positive")
        
        if self.backend not in ("auto", "subprocess", "microsandbox", "docker"):
            errors.append(f"Invalid backend: {self.backend}")
        
        return errors


# 预定义模板
DEFAULT_CODE_INTERPRETER_TEMPLATE = SandboxTemplate(
    name="default-code-interpreter",
    type=SandboxType.CODE_INTERPRETER,
    cpu=1.0,
    memory_mb=2048,
    timeout_seconds=300,
    description="Default code interpreter sandbox template",
)

LIGHTWEIGHT_TEMPLATE = SandboxTemplate(
    name="lightweight",
    type=SandboxType.CODE_INTERPRETER,
    cpu=0.5,
    memory_mb=512,
    timeout_seconds=60,
    description="Lightweight sandbox for quick operations",
)

HIGH_PERFORMANCE_TEMPLATE = SandboxTemplate(
    name="high-performance",
    type=SandboxType.CODE_INTERPRETER,
    cpu=4.0,
    memory_mb=8192,
    timeout_seconds=600,
    network_enabled=True,
    description="High-performance sandbox for intensive tasks",
)
