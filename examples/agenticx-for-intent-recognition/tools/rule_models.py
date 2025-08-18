"""规则匹配相关的数据模型

本模块定义了规则匹配系统中使用的数据结构，包括规则配置、匹配结果等。
基于AgenticX框架的标准数据模型设计。
"""

from enum import Enum
from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field
from datetime import datetime


class MatchType(Enum):
    """匹配类型枚举"""
    FULL_MATCH = "full"  # 全匹配
    REGEX_MATCH = "regex"  # 正则匹配
    DEPENDENCY_MATCH = "dependency"  # 依存匹配
    CLASS_REGEX_MATCH = "class_regex"  # 分类正则匹配
    PATTERN_MATCH = "pattern"  # 模式匹配
    FUZZY_MATCH = "fuzzy"  # 模糊匹配


class RuleConfig(BaseModel):
    """规则配置数据模型"""
    intent_code: str = Field(..., description="意图编码")
    description: str = Field(..., description="规则描述")
    match_strategy: MatchType = Field(..., description="匹配策略")
    patterns: List[str] = Field(default_factory=list, description="匹配模式列表")
    priority: int = Field(default=1, description="规则优先级")
    enabled: bool = Field(default=True, description="是否启用")
    confidence_weight: float = Field(default=1.0, description="置信度权重")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外元数据")
    
    class Config:
        use_enum_values = True


class Match(BaseModel):
    """单个匹配结果"""
    text: str = Field(..., description="匹配的文本")
    start: int = Field(..., description="起始位置")
    end: int = Field(..., description="结束位置")
    pattern: str = Field(..., description="匹配的模式")
    confidence: float = Field(default=1.0, description="匹配置信度")
    groups: List[str] = Field(default_factory=list, description="正则分组")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="匹配元数据")


class RuleMatchResult(BaseModel):
    """规则匹配结果"""
    matched_intent: Optional[str] = Field(None, description="匹配的意图")
    matches: List[Match] = Field(default_factory=list, description="匹配详情")
    confidence: float = Field(default=0.0, description="匹配置信度")
    rule_name: str = Field(..., description="使用的规则名称")
    match_type: MatchType = Field(..., description="匹配类型")
    processing_time: float = Field(default=0.0, description="处理时间(秒)")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="结果元数据")
    
    class Config:
        use_enum_values = True


class RuleSet(BaseModel):
    """规则集合"""
    name: str = Field(..., description="规则集名称")
    version: str = Field(default="1.0", description="版本号")
    rules: List[RuleConfig] = Field(default_factory=list, description="规则列表")
    description: str = Field(default="", description="规则集描述")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")
    updated_at: datetime = Field(default_factory=datetime.now, description="更新时间")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="规则集元数据")


class PipelineConfig(BaseModel):
    """规则流水线配置"""
    name: str = Field(..., description="流水线名称")
    stages: List[str] = Field(..., description="处理阶段列表")
    parallel_execution: bool = Field(default=False, description="是否并行执行")
    timeout: float = Field(default=30.0, description="超时时间(秒)")
    retry_count: int = Field(default=0, description="重试次数")
    fallback_strategy: str = Field(default="skip", description="失败回退策略")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="流水线元数据")


class PipelineResult(BaseModel):
    """流水线处理结果"""
    pipeline_name: str = Field(..., description="流水线名称")
    stage_results: Dict[str, RuleMatchResult] = Field(default_factory=dict, description="各阶段结果")
    final_result: Optional[RuleMatchResult] = Field(None, description="最终结果")
    total_processing_time: float = Field(default=0.0, description="总处理时间")
    success: bool = Field(default=True, description="是否成功")
    error_message: Optional[str] = Field(None, description="错误信息")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="流水线结果元数据")


class ValidationResult(BaseModel):
    """验证结果"""
    is_valid: bool = Field(..., description="是否有效")
    confidence: float = Field(default=0.0, description="验证置信度")
    errors: List[str] = Field(default_factory=list, description="错误列表")
    warnings: List[str] = Field(default_factory=list, description="警告列表")
    suggestions: List[str] = Field(default_factory=list, description="建议列表")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="验证元数据")


class PerformanceMetrics(BaseModel):
    """性能指标"""
    processing_time: float = Field(default=0.0, description="处理时间")
    memory_usage: float = Field(default=0.0, description="内存使用量(MB)")
    cpu_usage: float = Field(default=0.0, description="CPU使用率")
    throughput: float = Field(default=0.0, description="吞吐量(请求/秒)")
    accuracy: float = Field(default=0.0, description="准确率")
    precision: float = Field(default=0.0, description="精确率")
    recall: float = Field(default=0.0, description="召回率")
    f1_score: float = Field(default=0.0, description="F1分数")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="性能元数据")