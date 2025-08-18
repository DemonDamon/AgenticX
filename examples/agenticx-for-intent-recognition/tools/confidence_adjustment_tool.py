"""置信度调整工具

实现置信度动态调整逻辑，支持多因子置信度计算和规则引擎。
"""

import logging
import time
from typing import Dict, List, Any, Optional, Tuple
from agenticx.tools import BaseTool
from agenticx.tools.intelligence.models import ToolResult
from pydantic import BaseModel, Field

from .post_processing_models import (
    ConfidenceAdjustment,
    PostProcessingConfig,
    ProcessingStatus
)


class ConfidenceAdjustmentInput(BaseModel):
    """置信度调整输入模型"""
    
    intent: str = Field(description="意图类型")
    entities: List[Dict[str, Any]] = Field(default_factory=list, description="实体列表")
    original_confidence: float = Field(description="原始置信度")
    context: Dict[str, Any] = Field(default_factory=dict, description="上下文信息")
    config: Optional[Dict[str, Any]] = Field(default=None, description="配置参数")


class ConfidenceAdjustmentTool(BaseTool):
    """置信度调整工具
    
    基于多种因子动态调整意图识别的置信度，包括：
    - 实体一致性检查
    - 上下文相关性分析
    - 历史准确率统计
    - 规则匹配度评估
    """
    
    def __init__(self, config: Optional[PostProcessingConfig] = None):
        super().__init__(
            name="confidence_adjustment",
            description="动态调整意图识别置信度，基于多因子分析提升预测准确性",
            args_schema=ConfidenceAdjustmentInput
        )
        
        self.config = config or PostProcessingConfig()
        self.logger = logging.getLogger(__name__)
        
        # 置信度调整规则
        self._adjustment_rules = self._initialize_adjustment_rules()
        
        # 历史统计数据（实际应用中应从数据库加载）
        self._intent_accuracy_stats = {
            "000": 0.92,  # 通用对话意图准确率
            "001": 0.88,  # 搜索意图准确率
            "002": 0.85   # 工具调用意图准确率
        }
        
        # 实体类型权重
        self._entity_weights = {
            "PERSON": 0.8,
            "LOCATION": 0.7,
            "TIME": 0.9,
            "ORGANIZATION": 0.6,
            "PRODUCT": 0.5
        }
    
    def _initialize_adjustment_rules(self) -> Dict[str, Any]:
        """初始化置信度调整规则"""
        return {
            # 实体一致性规则
            "entity_consistency": {
                "high_consistency": 0.1,    # 实体高度一致时提升
                "medium_consistency": 0.05,  # 实体中等一致时小幅提升
                "low_consistency": -0.1,    # 实体不一致时降低
                "no_entities": -0.05        # 无实体时小幅降低
            },
            
            # 上下文相关性规则
            "context_relevance": {
                "high_relevance": 0.08,     # 高相关性提升
                "medium_relevance": 0.03,   # 中等相关性小幅提升
                "low_relevance": -0.05,     # 低相关性降低
                "no_context": 0.0           # 无上下文不调整
            },
            
            # 意图特定规则
            "intent_specific": {
                "000": {  # 通用对话意图
                    "sentiment_clear": 0.05,
                    "sentiment_unclear": -0.03
                },
                "001": {  # 搜索意图
                    "query_clear": 0.08,
                    "query_ambiguous": -0.06
                },
                "002": {  # 工具调用意图
                    "parameters_complete": 0.1,
                    "parameters_incomplete": -0.08
                }
            },
            
            # 置信度范围规则
            "confidence_range": {
                "very_high": (0.9, 1.0, -0.02),   # 过高置信度小幅降低
                "high": (0.7, 0.9, 0.0),          # 高置信度不调整
                "medium": (0.5, 0.7, 0.03),       # 中等置信度小幅提升
                "low": (0.3, 0.5, 0.05),          # 低置信度提升
                "very_low": (0.0, 0.3, -0.05)     # 极低置信度进一步降低
            }
        }
    
    def _run(self, **kwargs) -> ToolResult:
        """BaseTool要求的抽象方法实现"""
        if 'input_data' in kwargs:
            input_data = kwargs['input_data']
        else:
            input_data = ConfidenceAdjustmentInput(**kwargs)
        return self.execute(input_data)
    
    def execute(self, input_data: ConfidenceAdjustmentInput) -> ToolResult:
        """执行置信度调整"""
        try:
            start_time = time.time()
            
            # 执行置信度调整
            adjustment_result = self._adjust_confidence(
                intent=input_data.intent,
                entities=input_data.entities,
                original_confidence=input_data.original_confidence,
                context=input_data.context,
                config=input_data.config or {}
            )
            
            processing_time = time.time() - start_time
            
            # 记录日志
            if self.config.enable_logging:
                self.logger.info(
                    f"置信度调整完成: {input_data.original_confidence:.3f} -> "
                    f"{adjustment_result.adjusted_confidence:.3f} "
                    f"(耗时: {processing_time:.3f}s)"
                )
            
            return ToolResult(
                tool_name="confidence_adjustment",
                success=True,
                execution_time=processing_time,
                result_data={
                    "data": adjustment_result.dict(),
                    "metadata": {
                        "processing_time": processing_time
                    }
                },
                error_message=None
            )
            
        except Exception as e:
            self.logger.error(f"置信度调整失败: {str(e)}")
            return ToolResult(
                tool_name="confidence_adjustment",
                success=False,
                execution_time=0.0,
                result_data=None,
                error_message=f"置信度调整失败: {str(e)}"
            )
    
    def _adjust_confidence(
        self,
        intent: str,
        entities: List[Dict[str, Any]],
        original_confidence: float,
        context: Dict[str, Any],
        config: Dict[str, Any]
    ) -> ConfidenceAdjustment:
        """执行置信度调整逻辑"""
        
        adjustment_factors = {}
        total_adjustment = 0.0
        adjustment_reason_parts = []
        
        # 1. 实体一致性调整
        entity_adjustment, entity_reason = self._calculate_entity_adjustment(
            intent, entities
        )
        adjustment_factors["entity_consistency"] = entity_adjustment
        total_adjustment += entity_adjustment
        if entity_reason:
            adjustment_reason_parts.append(entity_reason)
        
        # 2. 上下文相关性调整
        context_adjustment, context_reason = self._calculate_context_adjustment(
            intent, context
        )
        adjustment_factors["context_relevance"] = context_adjustment
        total_adjustment += context_adjustment
        if context_reason:
            adjustment_reason_parts.append(context_reason)
        
        # 3. 历史准确率调整
        accuracy_adjustment, accuracy_reason = self._calculate_accuracy_adjustment(
            intent, original_confidence
        )
        adjustment_factors["historical_accuracy"] = accuracy_adjustment
        total_adjustment += accuracy_adjustment
        if accuracy_reason:
            adjustment_reason_parts.append(accuracy_reason)
        
        # 4. 置信度范围调整
        range_adjustment, range_reason = self._calculate_range_adjustment(
            original_confidence
        )
        adjustment_factors["confidence_range"] = range_adjustment
        total_adjustment += range_adjustment
        if range_reason:
            adjustment_reason_parts.append(range_reason)
        
        # 5. 意图特定调整
        specific_adjustment, specific_reason = self._calculate_intent_specific_adjustment(
            intent, entities, context
        )
        adjustment_factors["intent_specific"] = specific_adjustment
        total_adjustment += specific_adjustment
        if specific_reason:
            adjustment_reason_parts.append(specific_reason)
        
        # 计算最终置信度
        adjusted_confidence = max(0.0, min(1.0, original_confidence + total_adjustment))
        
        # 确定调整策略
        strategy_used = self._determine_adjustment_strategy(adjustment_factors)
        
        # 计算置信度变化
        confidence_boost = max(0.0, total_adjustment)
        confidence_penalty = abs(min(0.0, total_adjustment))
        
        return ConfidenceAdjustment(
            original_confidence=original_confidence,
            adjusted_confidence=adjusted_confidence,
            adjustment_factors=adjustment_factors,
            adjustment_reason=" | ".join(adjustment_reason_parts) if adjustment_reason_parts else "无调整",
            strategy_used=strategy_used,
            confidence_boost=confidence_boost,
            confidence_penalty=confidence_penalty,
            metadata={
                "total_adjustment": total_adjustment,
                "entity_count": len(entities),
                "context_keys": list(context.keys()),
                "timestamp": time.time()
            }
        )
    
    def _calculate_entity_adjustment(
        self, intent: str, entities: List[Dict[str, Any]]
    ) -> Tuple[float, str]:
        """计算实体一致性调整"""
        
        if not entities:
            return (
                self._adjustment_rules["entity_consistency"]["no_entities"],
                "无实体信息"
            )
        
        # 计算实体质量分数
        entity_quality_score = 0.0
        total_weight = 0.0
        
        for entity in entities:
            entity_type = entity.get("type", "UNKNOWN")
            entity_confidence = entity.get("confidence", 0.5)
            
            # 获取实体类型权重
            weight = self._entity_weights.get(entity_type, 0.3)
            total_weight += weight
            entity_quality_score += entity_confidence * weight
        
        if total_weight > 0:
            entity_quality_score /= total_weight
        
        # 根据质量分数确定调整
        if entity_quality_score >= 0.8:
            return (
                self._adjustment_rules["entity_consistency"]["high_consistency"],
                f"实体质量高({entity_quality_score:.2f})"
            )
        elif entity_quality_score >= 0.6:
            return (
                self._adjustment_rules["entity_consistency"]["medium_consistency"],
                f"实体质量中等({entity_quality_score:.2f})"
            )
        else:
            return (
                self._adjustment_rules["entity_consistency"]["low_consistency"],
                f"实体质量低({entity_quality_score:.2f})"
            )
    
    def _calculate_context_adjustment(
        self, intent: str, context: Dict[str, Any]
    ) -> Tuple[float, str]:
        """计算上下文相关性调整"""
        
        if not context:
            return (
                self._adjustment_rules["context_relevance"]["no_context"],
                ""
            )
        
        # 计算上下文相关性分数
        relevance_score = 0.0
        
        # 检查关键上下文字段
        key_fields = ["user_history", "session_context", "dialogue_state"]
        present_fields = sum(1 for field in key_fields if field in context)
        
        if present_fields >= 2:
            relevance_score = 0.8
        elif present_fields == 1:
            relevance_score = 0.5
        else:
            relevance_score = 0.2
        
        # 根据相关性分数确定调整
        if relevance_score >= 0.7:
            return (
                self._adjustment_rules["context_relevance"]["high_relevance"],
                f"上下文高度相关({relevance_score:.2f})"
            )
        elif relevance_score >= 0.4:
            return (
                self._adjustment_rules["context_relevance"]["medium_relevance"],
                f"上下文中等相关({relevance_score:.2f})"
            )
        else:
            return (
                self._adjustment_rules["context_relevance"]["low_relevance"],
                f"上下文低相关({relevance_score:.2f})"
            )
    
    def _calculate_accuracy_adjustment(
        self, intent: str, original_confidence: float
    ) -> Tuple[float, str]:
        """计算历史准确率调整"""
        
        # 获取意图历史准确率
        historical_accuracy = self._intent_accuracy_stats.get(intent, 0.8)
        
        # 基于历史准确率和当前置信度计算调整
        if historical_accuracy >= 0.9 and original_confidence >= 0.7:
            adjustment = 0.05
            reason = f"历史准确率高({historical_accuracy:.2f})"
        elif historical_accuracy <= 0.8 and original_confidence <= 0.6:
            adjustment = -0.03
            reason = f"历史准确率低({historical_accuracy:.2f})"
        else:
            adjustment = 0.0
            reason = ""
        
        return adjustment, reason
    
    def _calculate_range_adjustment(
        self, original_confidence: float
    ) -> Tuple[float, str]:
        """计算置信度范围调整"""
        
        range_rules = self._adjustment_rules["confidence_range"]
        
        for range_name, (min_val, max_val, adjustment) in range_rules.items():
            if min_val <= original_confidence < max_val:
                reason = f"置信度{range_name}({original_confidence:.2f})"
                return adjustment, reason
        
        return 0.0, ""
    
    def _calculate_intent_specific_adjustment(
        self, intent: str, entities: List[Dict[str, Any]], context: Dict[str, Any]
    ) -> Tuple[float, str]:
        """计算意图特定调整"""
        
        intent_rules = self._adjustment_rules["intent_specific"].get(intent, {})
        
        if intent == "000":  # 通用对话意图
            sentiment = context.get("sentiment")
            if sentiment in ["positive", "negative"]:
                return (
                    intent_rules.get("sentiment_clear", 0.0),
                    "情感明确"
                )
            else:
                return (
                    intent_rules.get("sentiment_unclear", 0.0),
                    "情感不明确"
                )
        
        elif intent == "001":  # 搜索意图
            query_clarity = context.get("query_clarity", 0.5)
            if query_clarity >= 0.7:
                return (
                    intent_rules.get("query_clear", 0.0),
                    "查询明确"
                )
            else:
                return (
                    intent_rules.get("query_ambiguous", 0.0),
                    "查询模糊"
                )
        
        elif intent == "002":  # 工具调用意图
            # 检查参数完整性
            required_params = context.get("required_parameters", [])
            provided_params = [e.get("type") for e in entities]
            
            if len(required_params) > 0:
                completeness = len(set(provided_params) & set(required_params)) / len(required_params)
                if completeness >= 0.8:
                    return (
                        intent_rules.get("parameters_complete", 0.0),
                        "参数完整"
                    )
                else:
                    return (
                        intent_rules.get("parameters_incomplete", 0.0),
                        "参数不完整"
                    )
        
        return 0.0, ""
    
    def _determine_adjustment_strategy(self, adjustment_factors: Dict[str, float]) -> str:
        """确定调整策略"""
        
        # 找出影响最大的因子
        max_factor = max(adjustment_factors.items(), key=lambda x: abs(x[1]))
        
        if abs(max_factor[1]) < 0.01:
            return "minimal_adjustment"
        elif max_factor[1] > 0:
            return f"boost_by_{max_factor[0]}"
        else:
            return f"penalty_by_{max_factor[0]}"
    
    def get_adjustment_statistics(self) -> Dict[str, Any]:
        """获取调整统计信息"""
        return {
            "intent_accuracy_stats": self._intent_accuracy_stats,
            "entity_weights": self._entity_weights,
            "adjustment_rules": self._adjustment_rules,
            "config": self.config.to_dict()
        }
    
    def update_accuracy_stats(self, intent: str, accuracy: float):
        """更新意图准确率统计"""
        self._intent_accuracy_stats[intent] = accuracy
        self.logger.info(f"更新意图{intent}准确率统计: {accuracy:.3f}")