"""
AgenticX Deploy Types

定义部署系统的核心类型和数据模型。
"""

from enum import Enum
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime


class DeploymentStatus(str, Enum):
    """部署状态"""
    PENDING = "pending"
    DEPLOYING = "deploying"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"
    UNKNOWN = "unknown"


class ComponentType(str, Enum):
    """组件类型"""
    DOCKER = "docker"
    KUBERNETES = "kubernetes"
    SERVERLESS = "serverless"
    LOCAL = "local"


@dataclass
class ResourceSpec:
    """
    资源规格
    """
    cpu: float = 1.0
    """CPU 核数"""
    
    memory_mb: int = 512
    """内存（MB）"""
    
    disk_mb: int = 1024
    """磁盘（MB）"""
    
    gpu: int = 0
    """GPU 数量"""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "cpu": self.cpu,
            "memory_mb": self.memory_mb,
            "disk_mb": self.disk_mb,
            "gpu": self.gpu,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResourceSpec":
        return cls(
            cpu=data.get("cpu", 1.0),
            memory_mb=data.get("memory_mb", 512),
            disk_mb=data.get("disk_mb", 1024),
            gpu=data.get("gpu", 0),
        )


@dataclass
class DeploymentConfig:
    """
    部署配置
    """
    name: str
    """部署名称"""
    
    component: str
    """组件类型"""
    
    props: Dict[str, Any] = field(default_factory=dict)
    """组件属性"""
    
    resources: Optional[ResourceSpec] = None
    """资源规格"""
    
    environment: str = "default"
    """目标环境"""
    
    replicas: int = 1
    """副本数"""
    
    labels: Dict[str, str] = field(default_factory=dict)
    """标签"""
    
    annotations: Dict[str, str] = field(default_factory=dict)
    """注解"""
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "name": self.name,
            "component": self.component,
            "props": self.props,
            "environment": self.environment,
            "replicas": self.replicas,
            "labels": self.labels,
            "annotations": self.annotations,
        }
        if self.resources:
            result["resources"] = self.resources.to_dict()
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DeploymentConfig":
        resources = None
        if "resources" in data:
            resources = ResourceSpec.from_dict(data["resources"])
        return cls(
            name=data.get("name", "unnamed"),
            component=data.get("component", "docker"),
            props=data.get("props", {}),
            resources=resources,
            environment=data.get("environment", "default"),
            replicas=data.get("replicas", 1),
            labels=data.get("labels", {}),
            annotations=data.get("annotations", {}),
        )


@dataclass
class DeploymentResult:
    """
    部署结果
    """
    success: bool
    """是否成功"""
    
    deployment_id: str = ""
    """部署 ID"""
    
    status: DeploymentStatus = DeploymentStatus.UNKNOWN
    """状态"""
    
    message: str = ""
    """消息"""
    
    endpoint: Optional[str] = None
    """访问端点"""
    
    started_at: Optional[datetime] = None
    """启动时间"""
    
    metadata: Dict[str, Any] = field(default_factory=dict)
    """元数据"""
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "success": self.success,
            "deployment_id": self.deployment_id,
            "status": self.status.value,
            "message": self.message,
            "metadata": self.metadata,
        }
        if self.endpoint:
            result["endpoint"] = self.endpoint
        if self.started_at:
            result["started_at"] = self.started_at.isoformat()
        return result


@dataclass
class RemoveResult:
    """
    删除结果
    """
    success: bool
    """是否成功"""
    
    message: str = ""
    """消息"""
    
    removed_resources: List[str] = field(default_factory=list)
    """已删除的资源列表"""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "message": self.message,
            "removed_resources": self.removed_resources,
        }


@dataclass
class StatusResult:
    """
    状态查询结果
    """
    deployment_id: str
    """部署 ID"""
    
    status: DeploymentStatus
    """状态"""
    
    replicas_ready: int = 0
    """就绪副本数"""
    
    replicas_total: int = 0
    """总副本数"""
    
    endpoint: Optional[str] = None
    """访问端点"""
    
    created_at: Optional[datetime] = None
    """创建时间"""
    
    updated_at: Optional[datetime] = None
    """更新时间"""
    
    conditions: List[Dict[str, Any]] = field(default_factory=list)
    """状态条件"""
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "deployment_id": self.deployment_id,
            "status": self.status.value,
            "replicas_ready": self.replicas_ready,
            "replicas_total": self.replicas_total,
            "conditions": self.conditions,
        }
        if self.endpoint:
            result["endpoint"] = self.endpoint
        if self.created_at:
            result["created_at"] = self.created_at.isoformat()
        if self.updated_at:
            result["updated_at"] = self.updated_at.isoformat()
        return result


class DeployError(Exception):
    """部署错误基类"""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class DeployConfigError(DeployError):
    """配置错误"""
    pass


class DeployExecutionError(DeployError):
    """执行错误"""
    pass


class DeployResourceError(DeployError):
    """资源错误"""
    pass
