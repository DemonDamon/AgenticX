"""
DeviceCloudRouter - Device-Cloud 路由决策器
基于 MAI-UI 设计

职责：
- 根据任务特性动态选择设备端或云端模型
- 考虑任务复杂度、数据敏感性、设备状态
- 统计和报告路由决策结果

决策因素：
- 任务复杂度（预估步骤数、跨应用数）
- 数据敏感性（是否涉及隐私数据）
- 当前置信度（低置信度升级到云端）

来源：MAI-UI 框架
"""

from enum import Enum
from typing import Any, Dict, Optional
from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)


class ModelType(str, Enum):
    """模型类型枚举"""
    DEVICE = "device"  # 设备端模型（轻量、低延迟、隐私保护）
    CLOUD = "cloud"    # 云端模型（强大、高精度、高延迟）


@dataclass
class RoutingDecision:
    """路由决策记录
    
    Attributes:
        model_type: 选择的模型类型
        reason: 决策原因
        factors: 决策因素
        timestamp: 决策时间
    """
    model_type: ModelType
    reason: str
    factors: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "model_type": self.model_type.value,
            "reason": self.reason,
            "factors": self.factors,
            "timestamp": self.timestamp.isoformat(),
        }


class DeviceCloudRouter:
    """
    Device-Cloud 路由决策器 - 基于 MAI-UI 设计
    
    决策规则（优先级从高到低）：
    1. 敏感数据 → 优先设备端（隐私保护）
    2. 高复杂度（>5步）→ 使用云端（更强能力）
    3. 跨应用（>2个）→ 使用云端（需要更多上下文）
    4. 低置信度（<0.7）→ 使用云端（提高准确率）
    5. 默认偏好设备端（低延迟、低成本）
    
    与 AgenticX LLM 体系的集成：
    - 接受 BaseLLMProvider 实例作为设备端和云端提供者
    - 返回选中的提供者，由调用方执行实际调用
    - 统计路由结果，用于优化决策
    
    Example:
        >>> router = DeviceCloudRouter(
        ...     device_provider=mai_ui_2b,
        ...     cloud_provider=mai_ui_32b
        ... )
        >>> provider = router.select_provider(task_complexity=3)
        >>> response = await provider.generate(messages)
    """
    
    DEFAULT_CONFIG = {
        "complexity_threshold": 5,       # 复杂度阈值（步骤数）
        "cross_app_threshold": 2,        # 跨应用阈值
        "confidence_threshold": 0.7,     # 置信度阈值
        "prefer_device": True,           # 默认偏好设备端
        "sensitive_keywords": [          # 敏感关键词列表
            "密码", "password", "银行", "bank", "支付", "pay",
            "身份证", "id card", "手机号", "phone", "隐私", "private"
        ],
    }
    
    def __init__(
        self,
        device_provider: Optional[Any] = None,
        cloud_provider: Optional[Any] = None,
        config: Optional[Dict[str, Any]] = None,
    ):
        """初始化路由器
        
        Args:
            device_provider: 设备端 LLM 提供者（BaseLLMProvider）
            cloud_provider: 云端 LLM 提供者（BaseLLMProvider）
            config: 路由配置（可选）
        """
        self.device_provider = device_provider
        self.cloud_provider = cloud_provider
        self.config = {**self.DEFAULT_CONFIG, **(config or {})}
        
        # 统计信息
        self._stats = {
            "total_decisions": 0,
            "device_count": 0,
            "cloud_count": 0,
            "device_success": 0,
            "device_failure": 0,
            "cloud_success": 0,
            "cloud_failure": 0,
        }
        
        # 历史决策（用于分析）
        self._history: list[RoutingDecision] = []
        self._max_history = 100
    
    def select_provider(
        self,
        task_complexity: Optional[int] = None,
        cross_app_count: int = 0,
        data_sensitivity: bool = False,
        confidence_score: Optional[float] = None,
        task_description: Optional[str] = None,
        force_type: Optional[ModelType] = None,
    ) -> Any:
        """选择 LLM 提供者
        
        Args:
            task_complexity: 任务复杂度（预估步骤数）
            cross_app_count: 跨应用数量
            data_sensitivity: 是否涉及敏感数据
            confidence_score: 当前置信度（0-1）
            task_description: 任务描述（用于敏感词检测）
            force_type: 强制使用某种类型（覆盖自动决策）
            
        Returns:
            选中的 LLM 提供者
        """
        self._stats["total_decisions"] += 1
        
        # 收集决策因素
        factors = {
            "task_complexity": task_complexity,
            "cross_app_count": cross_app_count,
            "data_sensitivity": data_sensitivity,
            "confidence_score": confidence_score,
        }
        
        # 强制类型
        if force_type:
            decision = RoutingDecision(
                model_type=force_type,
                reason="Forced by caller",
                factors=factors
            )
            self._record_decision(decision)
            return self._get_provider(force_type)
        
        # 规则 1: 敏感数据 → 设备端
        if data_sensitivity or self._detect_sensitive(task_description):
            decision = RoutingDecision(
                model_type=ModelType.DEVICE,
                reason="Sensitive data detected, using device for privacy",
                factors={**factors, "sensitive_detected": True}
            )
            self._record_decision(decision)
            return self._get_provider(ModelType.DEVICE)
        
        # 规则 2: 高复杂度 → 云端
        if task_complexity and task_complexity > self.config["complexity_threshold"]:
            decision = RoutingDecision(
                model_type=ModelType.CLOUD,
                reason=f"High complexity ({task_complexity} > {self.config['complexity_threshold']}), using cloud",
                factors=factors
            )
            self._record_decision(decision)
            return self._get_provider(ModelType.CLOUD)
        
        # 规则 3: 跨应用 → 云端
        if cross_app_count > self.config["cross_app_threshold"]:
            decision = RoutingDecision(
                model_type=ModelType.CLOUD,
                reason=f"Cross-app task ({cross_app_count} > {self.config['cross_app_threshold']}), using cloud",
                factors=factors
            )
            self._record_decision(decision)
            return self._get_provider(ModelType.CLOUD)
        
        # 规则 4: 低置信度 → 云端
        if confidence_score is not None and confidence_score < self.config["confidence_threshold"]:
            decision = RoutingDecision(
                model_type=ModelType.CLOUD,
                reason=f"Low confidence ({confidence_score:.2f} < {self.config['confidence_threshold']}), using cloud",
                factors=factors
            )
            self._record_decision(decision)
            return self._get_provider(ModelType.CLOUD)
        
        # 默认: 偏好设备端
        default_type = ModelType.DEVICE if self.config["prefer_device"] else ModelType.CLOUD
        decision = RoutingDecision(
            model_type=default_type,
            reason=f"Default preference: {default_type.value}",
            factors=factors
        )
        self._record_decision(decision)
        return self._get_provider(default_type)
    
    def _detect_sensitive(self, text: Optional[str]) -> bool:
        """检测文本是否包含敏感词
        
        Args:
            text: 待检测文本
            
        Returns:
            是否包含敏感词
        """
        if not text:
            return False
        
        text_lower = text.lower()
        for keyword in self.config["sensitive_keywords"]:
            if keyword.lower() in text_lower:
                return True
        return False
    
    def _get_provider(self, model_type: ModelType) -> Any:
        """获取指定类型的提供者
        
        Args:
            model_type: 模型类型
            
        Returns:
            LLM 提供者（如果未配置则返回 None）
        """
        if model_type == ModelType.DEVICE:
            self._stats["device_count"] += 1
            return self.device_provider
        else:
            self._stats["cloud_count"] += 1
            return self.cloud_provider
    
    def _record_decision(self, decision: RoutingDecision) -> None:
        """记录决策
        
        Args:
            decision: 路由决策
        """
        self._history.append(decision)
        if len(self._history) > self._max_history:
            self._history.pop(0)
        
        logger.debug(f"Routing decision: {decision.model_type.value} - {decision.reason}")
    
    def report_result(self, model_type: ModelType, success: bool) -> None:
        """报告执行结果（用于统计）
        
        Args:
            model_type: 使用的模型类型
            success: 是否成功
        """
        if model_type == ModelType.DEVICE:
            if success:
                self._stats["device_success"] += 1
            else:
                self._stats["device_failure"] += 1
        else:
            if success:
                self._stats["cloud_success"] += 1
            else:
                self._stats["cloud_failure"] += 1
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息
        
        Returns:
            统计信息字典
        """
        stats = self._stats.copy()
        
        # 计算成功率
        device_total = stats["device_success"] + stats["device_failure"]
        cloud_total = stats["cloud_success"] + stats["cloud_failure"]
        
        stats["device_success_rate"] = (
            stats["device_success"] / device_total if device_total > 0 else 0.0
        )
        stats["cloud_success_rate"] = (
            stats["cloud_success"] / cloud_total if cloud_total > 0 else 0.0
        )
        
        # 计算路由比例
        total = stats["device_count"] + stats["cloud_count"]
        stats["device_ratio"] = stats["device_count"] / total if total > 0 else 0.0
        stats["cloud_ratio"] = stats["cloud_count"] / total if total > 0 else 0.0
        
        return stats
    
    def get_recent_decisions(self, n: int = 10) -> list[Dict[str, Any]]:
        """获取最近的决策记录
        
        Args:
            n: 返回数量
            
        Returns:
            决策记录列表
        """
        return [d.to_dict() for d in self._history[-n:]]
    
    def reset_stats(self) -> None:
        """重置统计信息"""
        self._stats = {
            "total_decisions": 0,
            "device_count": 0,
            "cloud_count": 0,
            "device_success": 0,
            "device_failure": 0,
            "cloud_success": 0,
            "cloud_failure": 0,
        }
        self._history.clear()
    
    def __repr__(self) -> str:
        return (
            f"DeviceCloudRouter("
            f"device={self._stats['device_count']}, "
            f"cloud={self._stats['cloud_count']})"
        )
