"""实体抽取相关的数据模型

基于AgenticX标准定义实体抽取的数据结构和类型。
"""

from typing import Dict, List, Optional, Any
from enum import Enum
from pydantic import BaseModel, Field


class EntityType(str, Enum):
    """实体类型枚举"""
    PERSON = "person"  # 人名
    LOCATION = "location"  # 地点
    ORGANIZATION = "organization"  # 组织机构
    TIME = "time"  # 时间
    DATE = "date"  # 日期
    MONEY = "money"  # 金额
    PRODUCT = "product"  # 产品
    EVENT = "event"  # 事件
    KEYWORD = "keyword"  # 关键词
    PHONE = "phone"  # 电话号码
    EMAIL = "email"  # 邮箱
    URL = "url"  # 网址
    ID_CARD = "id_card"  # 身份证号
    OTHER = "other"  # 其他


class ExtractionMethod(str, Enum):
    """实体抽取方法枚举"""
    UIE = "uie"  # UIE模型抽取
    LLM = "llm"  # 大语言模型抽取
    RULE = "rule"  # 规则匹配抽取
    HYBRID = "hybrid"  # 混合方法


class Entity(BaseModel):
    """实体数据模型"""
    text: str = Field(..., description="实体文本")
    label: str = Field(..., description="实体标签")
    entity_type: EntityType = Field(..., description="实体类型")
    start: int = Field(..., description="起始位置")
    end: int = Field(..., description="结束位置")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0, description="置信度")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外元数据")
    
    class Config:
        json_encoders = {
            EntityType: lambda v: v.value
        }


class ExtractionResult(BaseModel):
    """实体抽取结果"""
    entities: Dict[str, List[Entity]] = Field(
        default_factory=dict, 
        description="按类型分组的实体列表"
    )
    confidence: float = Field(default=0.0, ge=0.0, le=1.0, description="整体置信度")
    extraction_method: ExtractionMethod = Field(..., description="使用的抽取方法")
    processing_time: float = Field(default=0.0, description="处理时间(秒)")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外元数据")
    
    def add_entity(self, entity: Entity) -> None:
        """添加实体到结果中"""
        entity_type = entity.entity_type.value
        if entity_type not in self.entities:
            self.entities[entity_type] = []
        self.entities[entity_type].append(entity)
    
    def get_entities_by_type(self, entity_type: EntityType) -> List[Entity]:
        """根据类型获取实体列表"""
        return self.entities.get(entity_type.value, [])
    
    def get_all_entities(self) -> List[Entity]:
        """获取所有实体的扁平列表"""
        all_entities = []
        for entities in self.entities.values():
            all_entities.extend(entities)
        return all_entities
    
    class Config:
        json_encoders = {
            ExtractionMethod: lambda v: v.value
        }


class EntityExtractionConfig(BaseModel):
    """实体抽取配置"""
    target_entities: List[EntityType] = Field(
        default_factory=lambda: list(EntityType), 
        description="目标实体类型列表"
    )
    confidence_threshold: float = Field(
        default=0.5, 
        ge=0.0, 
        le=1.0, 
        description="置信度阈值"
    )
    max_entities_per_type: int = Field(
        default=10, 
        ge=1, 
        description="每种类型最大实体数量"
    )
    enable_overlap_detection: bool = Field(
        default=True, 
        description="是否启用重叠检测"
    )
    merge_strategy: str = Field(
        default="highest_confidence", 
        description="合并策略: highest_confidence, longest_match, first_match"
    )
    
    class Config:
        json_encoders = {
            EntityType: lambda v: v.value
        }


class EntityMergeResult(BaseModel):
    """实体合并结果"""
    merged_entities: List[Entity] = Field(default_factory=list, description="合并后的实体列表")
    conflicts_resolved: int = Field(default=0, description="解决的冲突数量")
    duplicates_removed: int = Field(default=0, description="移除的重复实体数量")
    merge_strategy_used: str = Field(..., description="使用的合并策略")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="合并过程的元数据")


class EntityValidationResult(BaseModel):
    """实体验证结果"""
    is_valid: bool = Field(..., description="是否验证通过")
    validation_errors: List[str] = Field(default_factory=list, description="验证错误列表")
    validated_entities: List[Entity] = Field(default_factory=list, description="验证通过的实体")
    rejected_entities: List[Entity] = Field(default_factory=list, description="被拒绝的实体")
    validation_score: float = Field(default=0.0, ge=0.0, le=1.0, description="验证得分")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="验证过程的元数据")