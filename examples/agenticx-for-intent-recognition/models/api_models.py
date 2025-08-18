"""M8 API Service Layer Data Models

定义API服务层的请求/响应数据模型，基于AgenticX标准。
"""

from typing import Dict, List, Optional, Any, Union
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field

from .data_models import IntentType, EntityAnnotation


class RequestStatus(str, Enum):
    """请求状态枚举"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ProcessingMode(str, Enum):
    """处理模式枚举"""
    SYNC = "sync"  # 同步处理
    ASYNC = "async"  # 异步处理
    STREAM = "stream"  # 流式处理


class IntentRequest(BaseModel):
    """意图识别请求模型"""
    
    # 基础字段
    text: str = Field(description="待识别的文本内容")
    user_id: Optional[str] = Field(default=None, description="用户ID")
    session_id: Optional[str] = Field(default=None, description="会话ID")
    request_id: Optional[str] = Field(default=None, description="请求ID")
    
    # 处理配置
    mode: ProcessingMode = Field(default=ProcessingMode.SYNC, description="处理模式")
    enable_entity_extraction: bool = Field(default=True, description="是否启用实体抽取")
    enable_rule_matching: bool = Field(default=True, description="是否启用规则匹配")
    enable_post_processing: bool = Field(default=True, description="是否启用后处理")
    
    # 上下文信息
    context: Optional[Dict[str, Any]] = Field(default_factory=dict, description="上下文信息")
    history: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="对话历史")
    
    # 配置参数
    confidence_threshold: float = Field(default=0.7, description="置信度阈值")
    max_entities: int = Field(default=10, description="最大实体数量")
    timeout: Optional[float] = Field(default=30.0, description="超时时间（秒）")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外元数据")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="请求时间戳")


class IntentResult(BaseModel):
    """意图识别结果"""
    
    intent_type: IntentType = Field(description="意图类型")
    intent_name: str = Field(description="意图名称")
    confidence: float = Field(description="置信度")
    sub_intents: Optional[List[str]] = Field(default_factory=list, description="子意图列表")
    
    # 实体信息
    entities: List[EntityAnnotation] = Field(default_factory=list, description="提取的实体")
    
    # 规则匹配结果
    matched_rules: List[str] = Field(default_factory=list, description="匹配的规则")
    rule_confidence: Optional[float] = Field(default=None, description="规则匹配置信度")
    
    # 处理信息
    processing_time: float = Field(description="处理时间（毫秒）")
    model_version: Optional[str] = Field(default=None, description="模型版本")
    

class EntityExtractionResult(BaseModel):
    """实体抽取结果"""
    
    entities: List[EntityAnnotation] = Field(description="提取的实体列表")
    extraction_method: str = Field(description="抽取方法")
    confidence: float = Field(description="整体置信度")
    processing_time: float = Field(description="处理时间（毫秒）")
    

class RuleMatchingResult(BaseModel):
    """规则匹配结果"""
    
    matched_rules: List[str] = Field(description="匹配的规则列表")
    match_type: str = Field(description="匹配类型")
    confidence: float = Field(description="匹配置信度")
    processing_time: float = Field(description="处理时间（毫秒）")
    

class IntentResponse(BaseModel):
    """意图识别响应模型"""
    
    # 请求信息
    request_id: Optional[str] = Field(description="请求ID")
    status: RequestStatus = Field(description="处理状态")
    
    # 主要结果
    intent_result: Optional[IntentResult] = Field(default=None, description="意图识别结果")
    
    # 详细结果
    entity_result: Optional[EntityExtractionResult] = Field(default=None, description="实体抽取结果")
    rule_result: Optional[RuleMatchingResult] = Field(default=None, description="规则匹配结果")
    
    # 澄清和建议
    clarification_needed: bool = Field(default=False, description="是否需要澄清")
    clarification_questions: List[str] = Field(default_factory=list, description="澄清问题")
    suggestions: List[str] = Field(default_factory=list, description="建议操作")
    
    # 性能指标
    total_processing_time: float = Field(description="总处理时间（毫秒）")
    model_performance: Dict[str, float] = Field(default_factory=dict, description="模型性能指标")
    
    # 错误信息
    error: Optional[str] = Field(default=None, description="错误信息")
    error_code: Optional[str] = Field(default=None, description="错误代码")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="响应元数据")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="响应时间戳")
    

class BatchIntentRequest(BaseModel):
    """批量意图识别请求"""
    
    requests: List[IntentRequest] = Field(description="批量请求列表")
    batch_id: Optional[str] = Field(default=None, description="批次ID")
    parallel_processing: bool = Field(default=True, description="是否并行处理")
    max_concurrency: int = Field(default=5, description="最大并发数")
    

class BatchIntentResponse(BaseModel):
    """批量意图识别响应"""
    
    batch_id: Optional[str] = Field(description="批次ID")
    status: RequestStatus = Field(description="批次处理状态")
    responses: List[IntentResponse] = Field(description="批量响应列表")
    total_count: int = Field(description="总请求数")
    success_count: int = Field(description="成功处理数")
    failed_count: int = Field(description="失败处理数")
    total_processing_time: float = Field(description="总处理时间（毫秒）")
    summary: Dict[str, Any] = Field(default_factory=dict, description="批次处理摘要")
    
    # 错误信息
    error: Optional[str] = Field(default=None, description="错误信息")
    error_code: Optional[str] = Field(default=None, description="错误代码")
    
    # 元数据
    metadata: Dict[str, Any] = Field(default_factory=dict, description="批次元数据")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="响应时间戳")
    

class HealthCheckResponse(BaseModel):
    """健康检查响应"""
    
    status: str = Field(description="服务状态")
    version: str = Field(description="服务版本")
    uptime: float = Field(description="运行时间（秒）")
    
    # 组件状态
    components: Dict[str, str] = Field(default_factory=dict, description="组件状态")
    
    # 性能指标
    metrics: Dict[str, Union[int, float]] = Field(default_factory=dict, description="性能指标")
    
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="检查时间戳")
    

class ServiceInfo(BaseModel):
    """服务信息模型"""
    
    name: str = Field(description="服务名称")
    version: str = Field(description="服务版本")
    description: str = Field(description="服务描述")
    
    # API信息
    api_version: str = Field(description="API版本")
    endpoints: List[str] = Field(description="可用端点")
    
    # 配置信息
    supported_languages: List[str] = Field(default_factory=list, description="支持的语言")
    supported_intents: List[str] = Field(default_factory=list, description="支持的意图类型")
    
    # 限制信息
    rate_limits: Dict[str, int] = Field(default_factory=dict, description="速率限制")
    max_text_length: int = Field(default=1000, description="最大文本长度")
    
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="信息时间戳")