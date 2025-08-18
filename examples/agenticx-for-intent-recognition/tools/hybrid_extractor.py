"""混合实体抽取工具

结合UIE模型、LLM和规则匹配的混合实体抽取功能。
"""

import time
from typing import Dict, List, Optional, Any, Set
from agenticx.tools.base import BaseTool
from agenticx.core import AgentContext
from .entity_models import (
    Entity, EntityType, ExtractionResult, ExtractionMethod,
    EntityExtractionConfig, EntityMergeResult, EntityValidationResult
)
from .uie_extractor import UIEExtractor
from .llm_extractor import LLMExtractor
from .rule_extractor import RuleExtractor


class HybridExtractor(BaseTool):
    """混合实体抽取工具
    
    结合多种抽取方法的优势，提供更准确和全面的实体抽取能力。
    """
    
    def __init__(
        self, 
        enable_uie: bool = True,
        enable_llm: bool = True,
        enable_rule: bool = True,
        uie_weight: float = 0.4,
        llm_weight: float = 0.4,
        rule_weight: float = 0.2
    ):
        super().__init__(name="hybrid_extractor")
        self.enable_uie = enable_uie
        self.enable_llm = enable_llm
        self.enable_rule = enable_rule
        
        # 权重配置
        total_weight = uie_weight + llm_weight + rule_weight
        self.uie_weight = uie_weight / total_weight if total_weight > 0 else 0.33
        self.llm_weight = llm_weight / total_weight if total_weight > 0 else 0.33
        self.rule_weight = rule_weight / total_weight if total_weight > 0 else 0.34
        
        # 初始化子抽取器
        self.uie_extractor = UIEExtractor() if enable_uie else None
        self.llm_extractor = LLMExtractor() if enable_llm else None
        self.rule_extractor = RuleExtractor() if enable_rule else None
        
        # 实体类型优先级配置
        self._type_priorities = self._build_type_priorities()
    
    def _build_type_priorities(self) -> Dict[EntityType, Dict[str, float]]:
        """构建不同抽取方法对各实体类型的优先级权重"""
        return {
            EntityType.PHONE: {
                "rule": 0.8,  # 规则匹配对电话号码最准确
                "uie": 0.15,
                "llm": 0.05
            },
            EntityType.EMAIL: {
                "rule": 0.8,  # 规则匹配对邮箱最准确
                "uie": 0.15,
                "llm": 0.05
            },
            EntityType.URL: {
                "rule": 0.8,  # 规则匹配对URL最准确
                "uie": 0.15,
                "llm": 0.05
            },
            EntityType.ID_CARD: {
                "rule": 0.9,  # 规则匹配对身份证号最准确
                "uie": 0.08,
                "llm": 0.02
            },
            EntityType.PERSON: {
                "uie": 0.5,   # UIE对人名识别较好
                "llm": 0.35,
                "rule": 0.15
            },
            EntityType.LOCATION: {
                "uie": 0.45,  # UIE对地名识别较好
                "llm": 0.4,
                "rule": 0.15
            },
            EntityType.ORGANIZATION: {
                "uie": 0.45,  # UIE对机构名识别较好
                "llm": 0.4,
                "rule": 0.15
            },
            EntityType.TIME: {
                "rule": 0.5,  # 规则匹配对时间格式较好
                "uie": 0.3,
                "llm": 0.2
            },
            EntityType.DATE: {
                "rule": 0.5,  # 规则匹配对日期格式较好
                "uie": 0.3,
                "llm": 0.2
            },
            EntityType.MONEY: {
                "rule": 0.6,  # 规则匹配对金额格式较好
                "uie": 0.25,
                "llm": 0.15
            },
            EntityType.PRODUCT: {
                "llm": 0.5,   # LLM对产品名识别较好
                "uie": 0.35,
                "rule": 0.15
            },
            EntityType.EVENT: {
                "llm": 0.5,   # LLM对事件识别较好
                "uie": 0.35,
                "rule": 0.15
            },
            EntityType.KEYWORD: {
                "llm": 0.6,   # LLM对关键词提取较好
                "uie": 0.25,
                "rule": 0.15
            },
        }
    
    def extract_entities(
        self, 
        text: str, 
        config: Optional[EntityExtractionConfig] = None
    ) -> ExtractionResult:
        """混合抽取实体
        
        Args:
            text: 输入文本
            config: 抽取配置
            
        Returns:
            ExtractionResult: 抽取结果
        """
        start_time = time.time()
        
        if config is None:
            config = EntityExtractionConfig()
        
        # 存储各方法的抽取结果
        extraction_results = {}
        
        # UIE抽取
        if self.enable_uie and self.uie_extractor:
            try:
                uie_result = self.uie_extractor.extract_entities(text, config)
                extraction_results["uie"] = uie_result
            except Exception as e:
                extraction_results["uie"] = ExtractionResult(
                    entities={},
                    confidence=0.0,
                    extraction_method=ExtractionMethod.UIE,
                    processing_time=0.0,
                    metadata={"error": str(e)}
                )
        
        # LLM抽取
        if self.enable_llm and self.llm_extractor:
            try:
                llm_result = self.llm_extractor.extract_entities(text, config)
                extraction_results["llm"] = llm_result
            except Exception as e:
                extraction_results["llm"] = ExtractionResult(
                    entities={},
                    confidence=0.0,
                    extraction_method=ExtractionMethod.LLM,
                    processing_time=0.0,
                    metadata={"error": str(e)}
                )
        
        # 规则抽取
        if self.enable_rule and self.rule_extractor:
            try:
                rule_result = self.rule_extractor.extract_entities(text, config)
                extraction_results["rule"] = rule_result
            except Exception as e:
                extraction_results["rule"] = ExtractionResult(
                    entities={},
                    confidence=0.0,
                    extraction_method=ExtractionMethod.RULE,
                    processing_time=0.0,
                    metadata={"error": str(e)}
                )
        
        # 合并结果
        merged_result = self._merge_extraction_results(
            extraction_results, text, config
        )
        
        merged_result.processing_time = time.time() - start_time
        merged_result.extraction_method = ExtractionMethod.HYBRID
        
        return merged_result
    
    def _merge_extraction_results(
        self, 
        extraction_results: Dict[str, ExtractionResult],
        text: str,
        config: EntityExtractionConfig
    ) -> ExtractionResult:
        """合并多个抽取结果"""
        # 收集所有实体
        all_entities = []
        method_weights = {
            "uie": self.uie_weight,
            "llm": self.llm_weight,
            "rule": self.rule_weight
        }
        
        for method, result in extraction_results.items():
            for entities in result.entities.values():
                for entity in entities:
                    # 计算方法权重用于后续合并决策
                    entity_type_priorities = self._type_priorities.get(
                        entity.entity_type, 
                        {"uie": 0.33, "llm": 0.33, "rule": 0.34}
                    )
                    
                    type_weight = entity_type_priorities.get(method, 0.33)
                    method_weight = method_weights.get(method, 0.33)
                    
                    # 综合权重用于排序，不直接影响置信度
                    combined_weight = (type_weight + method_weight) / 2
                    # 保持原始置信度，权重用于合并时的优先级判断
                    adjusted_confidence = entity.confidence
                    
                    # 创建新的实体对象
                    adjusted_entity = Entity(
                        text=entity.text,
                        label=entity.label,
                        entity_type=entity.entity_type,
                        start=entity.start,
                        end=entity.end,
                        confidence=adjusted_confidence,
                        metadata={
                            **entity.metadata,
                            "source_method": method,
                            "original_confidence": entity.confidence,
                            "weight_applied": combined_weight
                        }
                    )
                    
                    all_entities.append(adjusted_entity)
        
        # 去重和合并重叠实体
        merged_entities = self._merge_overlapping_entities(
            all_entities, config.merge_strategy
        )
        
        # 应用置信度阈值
        filtered_entities = [
            entity for entity in merged_entities 
            if entity.confidence >= config.confidence_threshold
        ]
        
        # 构建最终结果
        result = ExtractionResult(
            entities={},
            confidence=0.0,
            extraction_method=ExtractionMethod.HYBRID,
            processing_time=0.0,
            metadata={
                "methods_used": list(extraction_results.keys()),
                "total_entities_before_merge": len(all_entities),
                "entities_after_merge": len(merged_entities),
                "entities_after_filter": len(filtered_entities),
                "method_weights": method_weights
            }
        )
        
        # 添加实体到结果中
        total_confidence = 0.0
        for entity in filtered_entities:
            result.add_entity(entity)
            total_confidence += entity.confidence
        
        # 计算整体置信度
        if filtered_entities:
            result.confidence = total_confidence / len(filtered_entities)
        
        # 应用数量限制
        self._apply_entity_limits(result, config)
        
        return result
    
    def _merge_overlapping_entities(
        self, 
        entities: List[Entity], 
        merge_strategy: str
    ) -> List[Entity]:
        """合并重叠的实体"""
        if not entities:
            return []
        
        # 按位置排序
        entities.sort(key=lambda x: (x.start, x.end))
        
        merged_entities = []
        i = 0
        
        while i < len(entities):
            current_entity = entities[i]
            overlapping_entities = [current_entity]
            
            # 找到所有与当前实体重叠的实体
            j = i + 1
            while j < len(entities):
                next_entity = entities[j]
                if self._entities_overlap(current_entity, next_entity):
                    overlapping_entities.append(next_entity)
                    j += 1
                else:
                    break
            
            # 合并重叠实体
            if len(overlapping_entities) == 1:
                merged_entities.append(current_entity)
            else:
                merged_entity = self._merge_entity_group(
                    overlapping_entities, merge_strategy
                )
                merged_entities.append(merged_entity)
            
            i = j if j > i + 1 else i + 1
        
        return merged_entities
    
    def _entities_overlap(self, entity1: Entity, entity2: Entity) -> bool:
        """检查两个实体是否重叠"""
        return not (entity1.end <= entity2.start or entity2.end <= entity1.start)
    
    def _merge_entity_group(
        self, 
        entities: List[Entity], 
        merge_strategy: str
    ) -> Entity:
        """合并一组重叠的实体"""
        if merge_strategy == "highest_confidence":
            return max(entities, key=lambda x: x.confidence)
        elif merge_strategy == "longest_match":
            return max(entities, key=lambda x: x.end - x.start)
        elif merge_strategy == "first_match":
            return entities[0]
        else:
            # 默认使用加权平均
            return self._weighted_merge(entities)
    
    def _weighted_merge(self, entities: List[Entity]) -> Entity:
        """加权合并实体"""
        if len(entities) == 1:
            return entities[0]
        
        # 选择置信度最高的实体作为基础
        base_entity = max(entities, key=lambda x: x.confidence)
        
        # 计算加权置信度
        total_weight = sum(entity.confidence for entity in entities)
        if total_weight > 0:
            weighted_confidence = sum(
                entity.confidence * entity.confidence / total_weight 
                for entity in entities
            )
        else:
            weighted_confidence = base_entity.confidence
        
        # 合并元数据
        merged_metadata = base_entity.metadata.copy()
        merged_metadata["merged_from"] = [
            {
                "method": entity.metadata.get("source_method", "unknown"),
                "confidence": entity.confidence,
                "text": entity.text
            }
            for entity in entities
        ]
        
        return Entity(
            text=base_entity.text,
            label=base_entity.label,
            entity_type=base_entity.entity_type,
            start=base_entity.start,
            end=base_entity.end,
            confidence=min(1.0, weighted_confidence),
            metadata=merged_metadata
        )
    
    def _apply_entity_limits(
        self, 
        result: ExtractionResult, 
        config: EntityExtractionConfig
    ) -> None:
        """应用实体数量限制"""
        for entity_type, entities in result.entities.items():
            if len(entities) > config.max_entities_per_type:
                # 按置信度排序，保留前N个
                entities.sort(key=lambda x: x.confidence, reverse=True)
                result.entities[entity_type] = entities[:config.max_entities_per_type]
    
    def get_extraction_statistics(
        self, 
        text: str, 
        config: Optional[EntityExtractionConfig] = None
    ) -> Dict[str, Any]:
        """获取抽取统计信息
        
        Args:
            text: 输入文本
            config: 抽取配置
            
        Returns:
            Dict[str, Any]: 统计信息
        """
        if config is None:
            config = EntityExtractionConfig()
        
        stats = {
            "text_length": len(text),
            "target_entity_types": [et.value for et in config.target_entities],
            "methods_enabled": [],
            "method_results": {}
        }
        
        # 记录启用的方法
        if self.enable_uie:
            stats["methods_enabled"].append("uie")
        if self.enable_llm:
            stats["methods_enabled"].append("llm")
        if self.enable_rule:
            stats["methods_enabled"].append("rule")
        
        # 分别测试各方法
        for method in stats["methods_enabled"]:
            try:
                if method == "uie" and self.uie_extractor:
                    result = self.uie_extractor.extract_entities(text, config)
                elif method == "llm" and self.llm_extractor:
                    result = self.llm_extractor.extract_entities(text, config)
                elif method == "rule" and self.rule_extractor:
                    result = self.rule_extractor.extract_entities(text, config)
                else:
                    continue
                
                stats["method_results"][method] = {
                    "entities_count": len(result.get_all_entities()),
                    "confidence": result.confidence,
                    "processing_time": result.processing_time,
                    "entities_by_type": {
                        entity_type: len(entities) 
                        for entity_type, entities in result.entities.items()
                    }
                }
            except Exception as e:
                stats["method_results"][method] = {
                    "error": str(e)
                }
        
        return stats
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """同步执行工具逻辑
        
        Args:
            **kwargs: 工具参数
            
        Returns:
            Dict[str, Any]: 执行结果
        """
        text = kwargs.get("text", "")
        if not text:
            return {"error": "缺少必需参数: text"}
        
        # 解析配置参数
        config_data = kwargs.get("config", {})
        try:
            config = EntityExtractionConfig(**config_data)
        except Exception as e:
            return {"error": f"配置参数错误: {str(e)}"}
        
        # 检查是否需要统计信息
        include_stats = kwargs.get("include_stats", False)
        
        # 执行实体抽取
        try:
            result = self.extract_entities(text, config)
            
            response = {
                "success": True,
                "result": result.dict(),
                "entities_count": len(result.get_all_entities()),
                "processing_time": result.processing_time
            }
            
            if include_stats:
                response["statistics"] = self.get_extraction_statistics(text, config)
            
            return response
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "processing_time": 0.0
            }
    
    async def execute(self, context: AgentContext) -> Dict[str, Any]:
        """工具执行入口
        
        Args:
            context: 工具上下文
            
        Returns:
            Dict[str, Any]: 执行结果
        """
        # 从context中提取参数并调用_run方法
        kwargs = {
            "text": context.variables.get("text", ""),
            "config": context.variables.get("config", {}),
            "include_stats": context.variables.get("include_stats", False)
        }
        return self._run(**kwargs)
    

    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "text": {
                "type": "string",
                "description": "待抽取实体的文本",
                "required": True
            },
            "config": {
                "type": "object",
                "description": "实体抽取配置",
                "required": False,
                "properties": {
                    "target_entities": {
                        "type": "array",
                        "description": "目标实体类型列表",
                        "items": {"type": "string"}
                    },
                    "confidence_threshold": {
                        "type": "number",
                        "description": "置信度阈值",
                        "minimum": 0.0,
                        "maximum": 1.0
                    },
                    "max_entities_per_type": {
                        "type": "integer",
                        "description": "每种类型最大实体数量",
                        "minimum": 1
                    },
                    "enable_overlap_detection": {
                        "type": "boolean",
                        "description": "是否启用重叠检测"
                    },
                    "merge_strategy": {
                        "type": "string",
                        "description": "合并策略",
                        "enum": ["highest_confidence", "longest_match", "first_match"]
                    }
                }
            },
            "include_stats": {
                "type": "boolean",
                "description": "是否包含统计信息",
                "required": False
            }
        }