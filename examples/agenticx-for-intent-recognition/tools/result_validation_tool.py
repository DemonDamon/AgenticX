"""结果验证工具

实现结果一致性验证，支持意图实体匹配检查和阈值验证机制。
"""

import logging
import time
from typing import Dict, List, Any, Optional, Set, Tuple
from agenticx.tools import BaseTool
from agenticx.tools.intelligence.models import ToolResult
from pydantic import BaseModel, Field

from .post_processing_models import (
    ValidationResult,
    ValidationLevel,
    PostProcessingConfig,
    ProcessingStatus
)


class ResultValidationInput(BaseModel):
    """结果验证输入模型"""
    
    intent: str = Field(description="意图类型")
    entities: List[Dict[str, Any]] = Field(default_factory=list, description="实体列表")
    confidence: float = Field(description="置信度")
    text: Optional[str] = Field(default=None, description="原始文本")
    context: Dict[str, Any] = Field(default_factory=dict, description="上下文信息")
    validation_level: Optional[str] = Field(default=None, description="验证级别")
    config: Optional[Dict[str, Any]] = Field(default=None, description="配置参数")


class ResultValidationTool(BaseTool):
    """结果验证工具
    
    对意图识别结果进行全面验证，包括：
    - 意图与实体的一致性检查
    - 置信度阈值验证
    - 实体类型和格式验证
    - 上下文相关性验证
    - 业务规则验证
    """
    
    def __init__(self, config: Optional[PostProcessingConfig] = None):
        super().__init__(
            name="result_validation",
            description="验证意图识别结果的一致性和准确性，确保输出质量",
            args_schema=ResultValidationInput
        )
        
        self.config = config or PostProcessingConfig()
        self.logger = logging.getLogger(__name__)
        
        # 验证规则
        self._validation_rules = self._initialize_validation_rules()
        
        # 意图-实体映射规则
        self._intent_entity_mapping = self._initialize_intent_entity_mapping()
        
        # 实体格式验证规则
        self._entity_format_rules = self._initialize_entity_format_rules()
    
    def _initialize_validation_rules(self) -> Dict[str, Any]:
        """初始化验证规则"""
        return {
            # 置信度验证规则
            "confidence_thresholds": {
                ValidationLevel.STRICT: 0.8,
                ValidationLevel.MODERATE: 0.6,
                ValidationLevel.LOOSE: 0.4
            },
            
            # 实体数量验证规则
            "entity_count_limits": {
                "000": {"min": 0, "max": 10},   # 通用对话意图
                "001": {"min": 1, "max": 15},   # 搜索意图
                "002": {"min": 1, "max": 20}    # 工具调用意图
            },
            
            # 必需实体类型
            "required_entities": {
                "001": ["QUERY"],              # 搜索意图必须有查询
                "002": ["ACTION"]              # 工具调用意图必须有动作
            },
            
            # 禁止实体类型
            "forbidden_entities": {
                "000": ["QUERY", "ACTION"]     # 通用对话不应有查询或动作
            }
        }
    
    def _initialize_intent_entity_mapping(self) -> Dict[str, Dict[str, Any]]:
        """初始化意图-实体映射规则"""
        return {
            "000": {  # 通用对话意图
                "compatible_entities": [
                    "PERSON", "LOCATION", "TIME", "EMOTION", "TOPIC"
                ],
                "incompatible_entities": [
                    "QUERY", "ACTION", "FUNCTION", "PARAMETER"
                ],
                "entity_weights": {
                    "PERSON": 0.8,
                    "EMOTION": 0.9,
                    "TOPIC": 0.7
                }
            },
            "001": {  # 搜索意图
                "compatible_entities": [
                    "QUERY", "KEYWORD", "CATEGORY", "TIME", "LOCATION", "PERSON"
                ],
                "incompatible_entities": [
                    "ACTION", "FUNCTION", "EMOTION"
                ],
                "entity_weights": {
                    "QUERY": 1.0,
                    "KEYWORD": 0.8,
                    "CATEGORY": 0.7
                }
            },
            "002": {  # 工具调用意图
                "compatible_entities": [
                    "ACTION", "FUNCTION", "PARAMETER", "VALUE", "TIME", "LOCATION"
                ],
                "incompatible_entities": [
                    "EMOTION", "TOPIC"
                ],
                "entity_weights": {
                    "ACTION": 1.0,
                    "FUNCTION": 0.9,
                    "PARAMETER": 0.8
                }
            }
        }
    
    def _initialize_entity_format_rules(self) -> Dict[str, Dict[str, Any]]:
        """初始化实体格式验证规则"""
        return {
            "TIME": {
                "required_fields": ["value", "type"],
                "value_patterns": [
                    r"\d{4}-\d{2}-\d{2}",  # 日期格式
                    r"\d{2}:\d{2}",        # 时间格式
                    r"\d+[天小时分钟秒]",    # 中文时间
                ]
            },
            "LOCATION": {
                "required_fields": ["value", "type"],
                "min_length": 2,
                "max_length": 50
            },
            "PERSON": {
                "required_fields": ["value", "type"],
                "min_length": 1,
                "max_length": 20
            },
            "QUERY": {
                "required_fields": ["value", "type"],
                "min_length": 1,
                "max_length": 200
            },
            "ACTION": {
                "required_fields": ["value", "type"],
                "allowed_values": [
                    "create", "delete", "update", "search", "send", "open", "close"
                ]
            }
        }
    
    def _run(self, **kwargs) -> ToolResult:
        """BaseTool要求的抽象方法实现"""
        if 'input_data' in kwargs:
            input_data = kwargs['input_data']
        else:
            input_data = ResultValidationInput(**kwargs)
        return self.execute(input_data)
    
    def execute(self, input_data: ResultValidationInput) -> ToolResult:
        """执行结果验证"""
        try:
            start_time = time.time()
            
            # 确定验证级别
            validation_level = ValidationLevel(
                input_data.validation_level or self.config.validation_level.value
            )
            
            # 执行验证
            validation_result = self._validate_result(
                intent=input_data.intent,
                entities=input_data.entities,
                confidence=input_data.confidence,
                context=input_data.context,
                validation_level=validation_level,
                config=input_data.config or {}
            )
            
            processing_time = time.time() - start_time
            
            # 记录日志
            if self.config.enable_logging:
                self.logger.info(
                    f"结果验证完成: 有效={validation_result.is_valid}, "
                    f"分数={validation_result.validation_score:.3f} "
                    f"(耗时: {processing_time:.3f}s)"
                )
            
            return ToolResult(
                tool_name="result_validation",
                success=True,
                execution_time=processing_time,
                result_data={
                    "data": validation_result.dict(),
                    "metadata": {
                        "processing_time": processing_time
                    }
                },
                error_message=None
            )
            
        except Exception as e:
            self.logger.error(f"结果验证失败: {str(e)}")
            return ToolResult(
                tool_name="result_validation",
                success=False,
                execution_time=0.0,
                result_data=None,
                error_message=f"结果验证失败: {str(e)}"
            )
    
    def _validate_result(
        self,
        intent: str,
        entities: List[Dict[str, Any]],
        confidence: float,
        context: Dict[str, Any],
        validation_level: ValidationLevel,
        config: Dict[str, Any]
    ) -> ValidationResult:
        """执行结果验证逻辑"""
        
        passed_checks = []
        failed_checks = []
        warnings = []
        suggestions = []
        
        # 1. 置信度验证
        confidence_valid, confidence_msg = self._validate_confidence(
            confidence, validation_level
        )
        if confidence_valid:
            passed_checks.append(f"置信度验证通过: {confidence_msg}")
        else:
            failed_checks.append(f"置信度验证失败: {confidence_msg}")
        
        # 2. 意图格式验证
        intent_valid, intent_msg = self._validate_intent_format(intent)
        if intent_valid:
            passed_checks.append(f"意图格式验证通过: {intent_msg}")
        else:
            failed_checks.append(f"意图格式验证失败: {intent_msg}")
        
        # 3. 实体数量验证
        entity_count_valid, entity_count_msg = self._validate_entity_count(
            intent, entities, validation_level
        )
        if entity_count_valid:
            passed_checks.append(f"实体数量验证通过: {entity_count_msg}")
        else:
            failed_checks.append(f"实体数量验证失败: {entity_count_msg}")
        
        # 4. 实体格式验证
        entity_format_valid, entity_format_msg, entity_warnings = self._validate_entity_formats(
            entities, validation_level
        )
        if entity_format_valid:
            passed_checks.append(f"实体格式验证通过: {entity_format_msg}")
        else:
            failed_checks.append(f"实体格式验证失败: {entity_format_msg}")
        warnings.extend(entity_warnings)
        
        # 5. 意图-实体一致性验证
        consistency_valid, consistency_msg, consistency_suggestions = self._validate_intent_entity_consistency(
            intent, entities, validation_level
        )
        if consistency_valid:
            passed_checks.append(f"意图实体一致性验证通过: {consistency_msg}")
        else:
            failed_checks.append(f"意图实体一致性验证失败: {consistency_msg}")
        suggestions.extend(consistency_suggestions)
        
        # 6. 上下文相关性验证
        context_valid, context_msg = self._validate_context_relevance(
            intent, entities, context, validation_level
        )
        if context_valid:
            passed_checks.append(f"上下文相关性验证通过: {context_msg}")
        else:
            warnings.append(f"上下文相关性验证警告: {context_msg}")
        
        # 7. 业务规则验证
        business_valid, business_msg, business_suggestions = self._validate_business_rules(
            intent, entities, confidence, validation_level
        )
        if business_valid:
            passed_checks.append(f"业务规则验证通过: {business_msg}")
        else:
            failed_checks.append(f"业务规则验证失败: {business_msg}")
        suggestions.extend(business_suggestions)
        
        # 计算验证分数
        total_checks = len(passed_checks) + len(failed_checks)
        validation_score = len(passed_checks) / total_checks if total_checks > 0 else 0.0
        
        # 计算置信度分数（基于置信度和验证结果）
        confidence_score = confidence * validation_score
        
        # 确定是否有效
        threshold = self._validation_rules["confidence_thresholds"][validation_level]
        is_valid = validation_score >= 0.7 and confidence >= threshold and len(failed_checks) == 0
        
        return ValidationResult(
            is_valid=is_valid,
            validation_level=validation_level,
            passed_checks=passed_checks,
            failed_checks=failed_checks,
            warnings=warnings,
            validation_score=validation_score,
            confidence_score=confidence_score,
            suggestions=suggestions,
            metadata={
                "total_checks": total_checks,
                "passed_count": len(passed_checks),
                "failed_count": len(failed_checks),
                "warning_count": len(warnings),
                "threshold_used": threshold,
                "timestamp": time.time()
            }
        )
    
    def _validate_confidence(
        self, confidence: float, validation_level: ValidationLevel
    ) -> Tuple[bool, str]:
        """验证置信度"""
        
        threshold = self._validation_rules["confidence_thresholds"][validation_level]
        
        if not 0.0 <= confidence <= 1.0:
            return False, f"置信度超出范围[0,1]: {confidence}"
        
        if confidence < threshold:
            return False, f"置信度{confidence:.3f}低于阈值{threshold}"
        
        return True, f"置信度{confidence:.3f}满足{validation_level.value}级别要求"
    
    def _validate_intent_format(self, intent: str) -> Tuple[bool, str]:
        """验证意图格式"""
        
        if not intent:
            return False, "意图为空"
        
        # 检查意图格式（应为3位数字）
        if not intent.isdigit() or len(intent) != 3:
            return False, f"意图格式错误，应为3位数字: {intent}"
        
        # 检查意图范围
        if intent not in ["000", "001", "002"]:
            return False, f"未知意图类型: {intent}"
        
        return True, f"意图格式正确: {intent}"
    
    def _validate_entity_count(
        self, intent: str, entities: List[Dict[str, Any]], validation_level: ValidationLevel
    ) -> Tuple[bool, str]:
        """验证实体数量"""
        
        entity_count = len(entities)
        limits = self._validation_rules["entity_count_limits"].get(intent, {"min": 0, "max": 50})
        
        if entity_count < limits["min"]:
            return False, f"实体数量{entity_count}少于最小要求{limits['min']}"
        
        if entity_count > limits["max"]:
            return False, f"实体数量{entity_count}超过最大限制{limits['max']}"
        
        return True, f"实体数量{entity_count}在合理范围内"
    
    def _validate_entity_formats(
        self, entities: List[Dict[str, Any]], validation_level: ValidationLevel
    ) -> Tuple[bool, str, List[str]]:
        """验证实体格式"""
        
        warnings = []
        invalid_entities = []
        
        for i, entity in enumerate(entities):
            entity_type = entity.get("type")
            entity_value = entity.get("value")
            
            if not entity_type:
                invalid_entities.append(f"实体{i}缺少type字段")
                continue
            
            if not entity_value:
                invalid_entities.append(f"实体{i}缺少value字段")
                continue
            
            # 检查特定类型的格式规则
            if entity_type in self._entity_format_rules:
                format_rules = self._entity_format_rules[entity_type]
                
                # 检查必需字段
                required_fields = format_rules.get("required_fields", [])
                for field in required_fields:
                    if field not in entity:
                        invalid_entities.append(f"实体{i}({entity_type})缺少必需字段{field}")
                
                # 检查值长度
                if "min_length" in format_rules:
                    if len(str(entity_value)) < format_rules["min_length"]:
                        warnings.append(f"实体{i}({entity_type})值长度过短")
                
                if "max_length" in format_rules:
                    if len(str(entity_value)) > format_rules["max_length"]:
                        warnings.append(f"实体{i}({entity_type})值长度过长")
                
                # 检查允许的值
                if "allowed_values" in format_rules:
                    if entity_value not in format_rules["allowed_values"]:
                        invalid_entities.append(
                            f"实体{i}({entity_type})值'{entity_value}'不在允许列表中"
                        )
        
        if invalid_entities:
            return False, "; ".join(invalid_entities), warnings
        
        return True, f"所有{len(entities)}个实体格式正确", warnings
    
    def _validate_intent_entity_consistency(
        self, intent: str, entities: List[Dict[str, Any]], validation_level: ValidationLevel
    ) -> Tuple[bool, str, List[str]]:
        """验证意图-实体一致性"""
        
        suggestions = []
        
        if intent not in self._intent_entity_mapping:
            return True, "未知意图类型，跳过一致性检查", suggestions
        
        mapping = self._intent_entity_mapping[intent]
        entity_types = [e.get("type") for e in entities if e.get("type")]
        
        # 检查必需实体
        required_entities = self._validation_rules["required_entities"].get(intent, [])
        missing_required = set(required_entities) - set(entity_types)
        if missing_required:
            return False, f"缺少必需实体类型: {list(missing_required)}", suggestions
        
        # 检查禁止实体
        forbidden_entities = self._validation_rules["forbidden_entities"].get(intent, [])
        forbidden_present = set(entity_types) & set(forbidden_entities)
        if forbidden_present:
            return False, f"包含禁止的实体类型: {list(forbidden_present)}", suggestions
        
        # 检查兼容性
        compatible_entities = set(mapping.get("compatible_entities", []))
        incompatible_entities = set(mapping.get("incompatible_entities", []))
        
        incompatible_present = set(entity_types) & incompatible_entities
        if incompatible_present:
            suggestions.append(f"建议移除不兼容的实体类型: {list(incompatible_present)}")
        
        # 检查实体权重
        entity_weights = mapping.get("entity_weights", {})
        low_weight_entities = [
            et for et in entity_types 
            if et in entity_weights and entity_weights[et] < 0.5
        ]
        if low_weight_entities:
            suggestions.append(f"低权重实体类型可能影响准确性: {low_weight_entities}")
        
        return True, f"意图{intent}与实体类型一致", suggestions
    
    def _validate_context_relevance(
        self, intent: str, entities: List[Dict[str, Any]], context: Dict[str, Any], 
        validation_level: ValidationLevel
    ) -> Tuple[bool, str]:
        """验证上下文相关性"""
        
        if not context:
            return True, "无上下文信息，跳过相关性检查"
        
        # 检查上下文与意图的相关性
        relevance_score = 0.0
        
        if intent == "000":  # 通用对话
            if "dialogue_state" in context or "emotion" in context:
                relevance_score += 0.5
        elif intent == "001":  # 搜索
            if "search_history" in context or "query_context" in context:
                relevance_score += 0.5
        elif intent == "002":  # 工具调用
            if "tool_context" in context or "function_history" in context:
                relevance_score += 0.5
        
        # 检查实体与上下文的相关性
        entity_types = [e.get("type") for e in entities]
        context_entities = context.get("entities", [])
        if context_entities:
            overlap = len(set(entity_types) & set(context_entities)) / len(entity_types)
            relevance_score += overlap * 0.3
        
        if relevance_score >= 0.6:
            return True, f"上下文高度相关(分数: {relevance_score:.2f})"
        elif relevance_score >= 0.3:
            return True, f"上下文中等相关(分数: {relevance_score:.2f})"
        else:
            return False, f"上下文相关性低(分数: {relevance_score:.2f})"
    
    def _validate_business_rules(
        self, intent: str, entities: List[Dict[str, Any]], confidence: float,
        validation_level: ValidationLevel
    ) -> Tuple[bool, str, List[str]]:
        """验证业务规则"""
        
        suggestions = []
        
        # 业务规则1: 高置信度但实体少的情况
        if confidence > 0.8 and len(entities) == 0 and intent in ["001", "002"]:
            suggestions.append("高置信度但无实体，建议检查实体抽取")
        
        # 业务规则2: 低置信度但实体多的情况
        if confidence < 0.5 and len(entities) > 5:
            suggestions.append("低置信度但实体较多，可能存在过度抽取")
        
        # 业务规则3: 意图特定规则
        if intent == "001":  # 搜索意图
            query_entities = [e for e in entities if e.get("type") == "QUERY"]
            if not query_entities:
                return False, "搜索意图必须包含查询实体", suggestions
        
        elif intent == "002":  # 工具调用意图
            action_entities = [e for e in entities if e.get("type") == "ACTION"]
            if not action_entities:
                return False, "工具调用意图必须包含动作实体", suggestions
        
        return True, "业务规则验证通过", suggestions
    
    def get_validation_statistics(self) -> Dict[str, Any]:
        """获取验证统计信息"""
        return {
            "validation_rules": self._validation_rules,
            "intent_entity_mapping": self._intent_entity_mapping,
            "entity_format_rules": self._entity_format_rules,
            "config": self.config.to_dict()
        }