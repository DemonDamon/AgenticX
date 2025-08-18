"""后处理工具数据模型

定义后处理过程中使用的数据结构和模型。
"""

from typing import Dict, List, Optional, Any, Union
from enum import Enum
from pydantic import BaseModel, Field
from dataclasses import dataclass


class ProcessingStatus(str, Enum):
    """处理状态枚举"""
    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"
    SKIPPED = "skipped"


class ConflictType(str, Enum):
    """冲突类型枚举"""
    INTENT_MISMATCH = "intent_mismatch"  # 意图不匹配
    ENTITY_OVERLAP = "entity_overlap"    # 实体重叠
    CONFIDENCE_CONFLICT = "confidence_conflict"  # 置信度冲突
    RULE_VIOLATION = "rule_violation"    # 规则违反


class ValidationLevel(str, Enum):
    """验证级别枚举"""
    STRICT = "strict"      # 严格验证
    MODERATE = "moderate"  # 中等验证
    LOOSE = "loose"        # 宽松验证


class ProcessedResult(BaseModel):
    """处理后的结果模型"""
    
    # 原始数据
    original_intent: str = Field(description="原始意图")
    original_entities: List[Dict[str, Any]] = Field(default_factory=list, description="原始实体列表")
    original_confidence: float = Field(description="原始置信度")
    
    # 处理后数据
    processed_intent: str = Field(description="处理后意图")
    processed_entities: List[Dict[str, Any]] = Field(default_factory=list, description="处理后实体列表")
    processed_confidence: float = Field(description="处理后置信度")
    
    # 处理信息
    processing_steps: List[str] = Field(default_factory=list, description="处理步骤")
    modifications: List[str] = Field(default_factory=list, description="修改记录")
    status: ProcessingStatus = Field(default=ProcessingStatus.SUCCESS, description="处理状态")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")
    timestamp: Optional[str] = Field(default=None, description="处理时间戳")


class ValidationResult(BaseModel):
    """验证结果模型"""
    
    is_valid: bool = Field(description="是否有效")
    validation_level: ValidationLevel = Field(description="验证级别")
    
    # 验证详情
    passed_checks: List[str] = Field(default_factory=list, description="通过的检查项")
    failed_checks: List[str] = Field(default_factory=list, description="失败的检查项")
    warnings: List[str] = Field(default_factory=list, description="警告信息")
    
    # 验证分数
    validation_score: float = Field(default=0.0, description="验证分数 (0-1)")
    confidence_score: float = Field(default=0.0, description="置信度分数 (0-1)")
    
    # 建议
    suggestions: List[str] = Field(default_factory=list, description="改进建议")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="验证元数据")


class ConflictInfo(BaseModel):
    """冲突信息模型"""
    
    conflict_type: ConflictType = Field(description="冲突类型")
    description: str = Field(description="冲突描述")
    
    # 冲突源
    source_a: Dict[str, Any] = Field(description="冲突源A")
    source_b: Dict[str, Any] = Field(description="冲突源B")
    
    # 冲突严重程度
    severity: float = Field(default=0.5, description="严重程度 (0-1)")
    
    # 解决方案
    resolution_strategy: Optional[str] = Field(default=None, description="解决策略")
    resolved: bool = Field(default=False, description="是否已解决")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="冲突元数据")


class ConflictResolutionResult(BaseModel):
    """冲突解决结果模型"""
    
    conflicts_detected: List[ConflictInfo] = Field(default_factory=list, description="检测到的冲突")
    conflicts_resolved: List[ConflictInfo] = Field(default_factory=list, description="已解决的冲突")
    conflicts_unresolved: List[ConflictInfo] = Field(default_factory=list, description="未解决的冲突")
    
    # 解决统计
    total_conflicts: int = Field(default=0, description="总冲突数")
    resolved_count: int = Field(default=0, description="已解决数量")
    resolution_rate: float = Field(default=0.0, description="解决率")
    
    # 最终结果
    final_result: Dict[str, Any] = Field(default_factory=dict, description="最终结果")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="解决元数据")


class ConfidenceAdjustment(BaseModel):
    """置信度调整模型"""
    
    original_confidence: float = Field(description="原始置信度")
    adjusted_confidence: float = Field(description="调整后置信度")
    
    # 调整因子
    adjustment_factors: Dict[str, float] = Field(default_factory=dict, description="调整因子")
    adjustment_reason: str = Field(description="调整原因")
    
    # 调整策略
    strategy_used: str = Field(description="使用的策略")
    confidence_boost: float = Field(default=0.0, description="置信度提升")
    confidence_penalty: float = Field(default=0.0, description="置信度惩罚")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="调整元数据")


class EntityOptimization(BaseModel):
    """实体优化模型"""
    
    original_entities: List[Dict[str, Any]] = Field(description="原始实体")
    optimized_entities: List[Dict[str, Any]] = Field(description="优化后实体")
    
    # 优化操作
    operations_performed: List[str] = Field(default_factory=list, description="执行的操作")
    entities_merged: List[Dict[str, Any]] = Field(default_factory=list, description="合并的实体")
    entities_removed: List[Dict[str, Any]] = Field(default_factory=list, description="移除的实体")
    entities_adjusted: List[Dict[str, Any]] = Field(default_factory=list, description="调整的实体")
    
    # 优化统计
    optimization_score: float = Field(default=0.0, description="优化分数")
    quality_improvement: float = Field(default=0.0, description="质量提升")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="优化元数据")


class IntentRefinement(BaseModel):
    """意图精化模型"""
    
    original_intent: str = Field(description="原始意图")
    refined_intent: str = Field(description="精化后意图")
    refined_confidence: float = Field(description="精化后置信度")
    
    # 精化信息
    refinement_type: str = Field(description="精化类型")
    refinement_reason: str = Field(description="精化原因")
    confidence_change: float = Field(default=0.0, description="置信度变化")
    improvement_score: float = Field(default=0.0, description="改进分数")
    
    # 子意图
    sub_intents: List[str] = Field(default_factory=list, description="子意图列表")
    intent_hierarchy: Dict[str, Any] = Field(default_factory=dict, description="意图层次结构")
    
    # 精化质量
    refinement_quality: float = Field(default=0.0, description="精化质量分数")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="精化元数据")


class PostProcessingResult(BaseModel):
    """后处理结果模型"""
    
    original_results: List[Dict[str, Any]] = Field(description="原始结果列表")
    final_results: List[Dict[str, Any]] = Field(description="最终结果列表")
    processing_steps: List[str] = Field(description="处理步骤")
    processing_history: List[Dict[str, Any]] = Field(description="处理历史")
    success_rate: float = Field(description="成功率")
    quality_score: float = Field(description="质量分数")
    validation_result: Optional[Dict[str, Any]] = Field(default=None, description="验证结果")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")


@dataclass
class PostProcessingConfig:
    """后处理配置"""
    
    # 置信度调整配置
    confidence_threshold: float = 0.5
    confidence_boost_factor: float = 0.1
    confidence_penalty_factor: float = 0.1
    
    # 验证配置
    validation_level: ValidationLevel = ValidationLevel.MODERATE
    validation_threshold: float = 0.7
    
    # 冲突解决配置
    conflict_resolution_strategy: str = "priority_based"
    max_conflicts_to_resolve: int = 10
    
    # 实体优化配置
    entity_merge_threshold: float = 0.8
    entity_quality_threshold: float = 0.6
    
    # 意图精化配置
    intent_refinement_enabled: bool = True
    sub_intent_threshold: float = 0.3
    
    # 通用配置
    enable_logging: bool = True
    max_processing_time: float = 5.0  # 秒
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "confidence_threshold": self.confidence_threshold,
            "confidence_boost_factor": self.confidence_boost_factor,
            "confidence_penalty_factor": self.confidence_penalty_factor,
            "validation_level": self.validation_level.value,
            "validation_threshold": self.validation_threshold,
            "conflict_resolution_strategy": self.conflict_resolution_strategy,
            "max_conflicts_to_resolve": self.max_conflicts_to_resolve,
            "entity_merge_threshold": self.entity_merge_threshold,
            "entity_quality_threshold": self.entity_quality_threshold,
            "intent_refinement_enabled": self.intent_refinement_enabled,
            "sub_intent_threshold": self.sub_intent_threshold,
            "enable_logging": self.enable_logging,
            "max_processing_time": self.max_processing_time
        }