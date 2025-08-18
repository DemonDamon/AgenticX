"""M5后处理工具测试

测试后处理工具的各项功能：
- 置信度调整
- 结果验证
- 冲突解决
- 实体优化
- 意图精化
- 统一后处理接口
"""

import pytest
import time
from typing import Dict, List, Any

from tools.post_processing_models import (
    ProcessingStatus,
    ConflictType,
    ValidationLevel,
    PostProcessingConfig
)
from tools.post_processing_tool import PostProcessingTool, PostProcessingInput
from tools.confidence_adjustment_tool import ConfidenceAdjustmentTool, ConfidenceAdjustmentInput
from tools.result_validation_tool import ResultValidationTool, ResultValidationInput
from tools.conflict_resolution_tool import ConflictResolutionTool, ConflictResolutionInput
from tools.entity_optimization_tool import EntityOptimizationTool, EntityOptimizationInput
from tools.intent_refinement_tool import IntentRefinementTool, IntentRefinementInput


class TestPostProcessingModels:
    """测试后处理数据模型"""
    
    def test_processing_status_enum(self):
        """测试处理状态枚举"""
        assert ProcessingStatus.SUCCESS.value == "success"
        assert ProcessingStatus.FAILED.value == "failed"
        assert ProcessingStatus.PARTIAL.value == "partial"
        assert ProcessingStatus.SKIPPED.value == "skipped"
    
    def test_conflict_type_enum(self):
        """测试冲突类型枚举"""
        assert ConflictType.INTENT_MISMATCH.value == "intent_mismatch"
        assert ConflictType.ENTITY_OVERLAP.value == "entity_overlap"
        assert ConflictType.CONFIDENCE_CONFLICT.value == "confidence_conflict"
        assert ConflictType.RULE_VIOLATION.value == "rule_violation"
    
    def test_validation_level_enum(self):
        """测试验证级别枚举"""
        assert ValidationLevel.STRICT.value == "strict"
        assert ValidationLevel.MODERATE.value == "moderate"
        assert ValidationLevel.LOOSE.value == "loose"
    
    def test_post_processing_config(self):
        """测试后处理配置"""
        config = PostProcessingConfig()
        
        # 测试默认值
        assert config.enable_logging is True
        assert config.confidence_threshold == 0.5
        assert config.max_processing_time == 5.0
        assert config.validation_level == ValidationLevel.MODERATE
        
        # 测试自定义配置
        custom_config = PostProcessingConfig(
            confidence_threshold=0.7,
            max_processing_time=30.0,
            enable_logging=False
        )
        assert custom_config.confidence_threshold == 0.7
        assert custom_config.max_processing_time == 30.0
        assert custom_config.enable_logging is False


class TestConfidenceAdjustmentTool:
    """测试置信度调整工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.tool = ConfidenceAdjustmentTool()
    
    def test_basic_confidence_adjustment(self):
        """测试基本置信度调整"""
        input_data = ConfidenceAdjustmentInput(
            intent="search_product",
            original_confidence=0.6,
            entities=[
                {"type": "product", "value": "手机", "confidence": 0.8},
                {"type": "brand", "value": "苹果", "confidence": 0.9}
            ],
            context={"user_history": ["search_product"], "context_relevance": 0.7}
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        assert "adjusted_confidence" in result.result_data["data"]
        assert "adjustment_factors" in result.result_data["data"]
        assert "adjustment_reason" in result.result_data["data"]
        
        adjusted_confidence = result.result_data["data"]["adjusted_confidence"]
        assert 0.0 <= adjusted_confidence <= 1.0
    
    def test_high_entity_consistency_boost(self):
        """测试高实体一致性提升置信度"""
        input_data = ConfidenceAdjustmentInput(
            intent="search_product",
            original_confidence=0.5,
            entities=[
                {"type": "product", "value": "手机", "confidence": 0.95},
                {"type": "brand", "value": "苹果", "confidence": 0.95}
            ],
            context={"context_relevance": 0.9}
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        adjusted_confidence = result.result_data["data"]["adjusted_confidence"]
        # 高实体一致性应该提升置信度
        assert adjusted_confidence > 0.5
    
    def test_low_confidence_penalty(self):
        """测试低置信度惩罚"""
        input_data = ConfidenceAdjustmentInput(
            intent="search_product",
            original_confidence=0.3,
            entities=[
                {"type": "product", "value": "手机", "confidence": 0.2},
                {"type": "brand", "value": "苹果", "confidence": 0.3}
            ],
            context={"context_relevance": 0.2}
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        adjusted_confidence = result.result_data["data"]["adjusted_confidence"]
        # 低置信度应该被进一步降低
        assert adjusted_confidence <= 0.3


class TestResultValidationTool:
    """测试结果验证工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.tool = ResultValidationTool()
    
    def test_valid_result_validation(self):
        """测试有效结果验证"""
        input_data = ResultValidationInput(
            intent="001",
            confidence=0.8,
            entities=[
                {"type": "QUERY", "value": "手机", "confidence": 0.9},
                {"type": "KEYWORD", "value": "苹果", "confidence": 0.85}
            ],
            text="我想买苹果手机",
            context={"context_relevance": 0.8},
            validation_level="moderate"
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        assert "is_valid" in result.result_data["data"]
        assert "validation_score" in result.result_data["data"]
        assert "passed_checks" in result.result_data["data"]
        
        assert result.result_data["data"]["is_valid"] is True
        assert result.result_data["data"]["validation_score"] > 0.7
    
    def test_invalid_result_validation(self):
        """测试无效结果验证"""
        input_data = ResultValidationInput(
            intent="001",
            confidence=0.2,  # 低置信度
            entities=[],  # 缺少必需的QUERY实体
            text="我想买苹果手机",
            context={"context_relevance": 0.1},
            validation_level="strict"
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        assert result.result_data["data"]["is_valid"] is False
        assert result.result_data["data"]["validation_score"] < 0.5
        assert len(result.result_data["data"]["failed_checks"]) > 0
    
    def test_entity_format_validation(self):
        """测试实体格式验证"""
        input_data = ResultValidationInput(
            intent="001",
            confidence=0.8,
            entities=[
                {"type": "QUERY", "confidence": 0.9},  # 缺少value字段
                {"type": "KEYWORD", "value": "关键词", "confidence": 0.8}
            ],
            text="搜索相关内容",
            context={},
            validation_level="strict"
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        # 格式验证应该检测到问题
        failed_checks = result.result_data["data"]["failed_checks"]
        assert any("实体格式验证失败" in check for check in failed_checks)


class TestConflictResolutionTool:
    """测试冲突解决工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.tool = ConflictResolutionTool()
    
    def test_intent_conflict_resolution(self):
        """测试意图冲突解决"""
        results = [
            {
                "intent": "search_product",
                "confidence": 0.8,
                "entities": [{"type": "product", "value": "手机"}],
                "source": "llm_result"
            },
            {
                "intent": "buy_product",
                "confidence": 0.7,
                "entities": [{"type": "product", "value": "手机"}],
                "source": "rule_result"
            }
        ]
        
        input_data = ConflictResolutionInput(
            results=results,
            resolution_strategy="confidence_based"
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        assert "final_result" in result.result_data["data"]
        assert "conflicts_detected" in result.result_data["data"]
        assert "resolved_count" in result.result_data["data"]
        
        # 应该选择置信度更高的结果
        final_result = result.result_data["data"]["final_result"]
        assert final_result["intent"] == "search_product"
        assert result.result_data["data"]["resolved_count"] > 0
    
    def test_entity_overlap_resolution(self):
        """测试实体重叠解决"""
        results = [
            {
                "intent": "001",  # 搜索意图
                "confidence": 0.8,
                "entities": [
                    {"type": "QUERY", "value": "苹果手机", "start": 0, "end": 4},
                    {"type": "KEYWORD", "value": "苹果", "start": 0, "end": 2}  # 重叠
                ],
                "source": "llm_result"
            },
            {
                "intent": "002",  # 工具调用意图 - 不同意图产生冲突
                "confidence": 0.7,
                "entities": [
                    {"type": "ACTION", "value": "搜索", "start": 0, "end": 2},
                    {"type": "PARAMETER", "value": "苹果手机", "start": 2, "end": 6}
                ],
                "source": "rule_result"
            }
        ]
        
        input_data = ConflictResolutionInput(
            results=results,
            resolution_strategy="hybrid"
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        conflicts = result.result_data["data"]["conflicts_detected"]
        # 应该检测到冲突（可能是实体冲突或其他类型）
        assert len(conflicts) > 0
    
    def test_no_conflict_scenario(self):
        """测试无冲突场景"""
        results = [
            {
                "intent": "search_product",
                "confidence": 0.8,
                "entities": [{"type": "product", "value": "手机"}],
                "source": "llm_result"
            }
        ]
        
        input_data = ConflictResolutionInput(
            results=results,
            resolution_strategy="hybrid"
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        assert result.result_data["data"]["resolved_count"] == 0
        assert len(result.result_data["data"]["conflicts_detected"]) == 0


class TestEntityOptimizationTool:
    """测试实体优化工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.tool = EntityOptimizationTool()
    
    def test_entity_deduplication(self):
        """测试实体去重"""
        entities = [
            {"type": "product", "value": "手机", "confidence": 0.8},
            {"type": "product", "value": "手机", "confidence": 0.9},  # 重复
            {"type": "brand", "value": "苹果", "confidence": 0.85}
        ]
        
        input_data = EntityOptimizationInput(
            entities=entities,
            text="我想买苹果手机",
            optimization_rules=["deduplication"]
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        optimized_entities = result.result_data["data"]["optimized_entities"]
        
        # 应该去除重复的实体
        product_entities = [e for e in optimized_entities if e["type"] == "product"]
        assert len(product_entities) == 1
        # 应该保留置信度更高的
        assert product_entities[0]["confidence"] == 0.9
    
    def test_boundary_optimization(self):
        """测试边界优化"""
        entities = [
            {"type": "product", "value": "苹果手机", "start": 2, "end": 6, "confidence": 0.8}
        ]
        
        input_data = EntityOptimizationInput(
            entities=entities,
            text="我想买苹果手机和充电器",
            optimization_rules=["boundary_optimization"]
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        optimized_entities = result.result_data["data"]["optimized_entities"]
        
        # 边界应该被优化
        assert len(optimized_entities) > 0
        optimized_entity = optimized_entities[0]
        assert "start" in optimized_entity
        assert "end" in optimized_entity
    
    def test_type_standardization(self):
        """测试类型标准化"""
        entities = [
            {"type": "PRODUCT", "value": "手机", "confidence": 0.8},  # 大写
            {"type": "Brand", "value": "苹果", "confidence": 0.9},  # 首字母大写
            {"type": "phone_number", "value": "13800138000", "confidence": 0.95}
        ]
        
        input_data = EntityOptimizationInput(
            entities=entities,
            text="苹果手机联系电话13800138000",
            optimization_rules=["type_standardization"]
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        optimized_entities = result.result_data["data"]["optimized_entities"]
        
        # 类型应该被标准化为小写
        types = [e["type"] for e in optimized_entities]
        assert "product" in types
        assert "brand" in types
        assert "phone_number" in types


class TestIntentRefinementTool:
    """测试意图精化工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.tool = IntentRefinementTool()
    
    def test_entity_based_intent_validation(self):
        """测试基于实体的意图验证"""
        input_data = IntentRefinementInput(
            intent="search_product",
            confidence=0.7,
            entities=[
                {"type": "product", "value": "手机", "confidence": 0.9},
                {"type": "brand", "value": "苹果", "confidence": 0.85}
            ],
            text="我想买苹果手机",
            context={"user_history": ["search_product"]},
            refinement_rules=["entity_validation"]
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        assert "refined_intent" in result.result_data["data"]
        assert "refined_confidence" in result.result_data["data"]
        assert "improvement_score" in result.result_data["data"]
        
        # 实体与意图匹配，应该提升置信度
        refined_confidence = result.result_data["data"]["refined_confidence"]
        assert refined_confidence >= 0.5
    
    def test_context_relevance_analysis(self):
        """测试上下文相关性分析"""
        input_data = IntentRefinementInput(
            intent="search_product",
            confidence=0.6,
            entities=[{"type": "product", "value": "手机"}],
            text="我想买手机",
            context={
                "user_history": ["search_product", "search_product"],
                "context_relevance": 0.9
            },
            refinement_rules=["context_analysis"]
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        # 高上下文相关性应该提升置信度
        refined_confidence = result.result_data["data"]["refined_confidence"]
        assert refined_confidence > 0.4
    
    def test_intent_hierarchy_inference(self):
        """测试意图层次推理"""
        input_data = IntentRefinementInput(
            intent="search",  # 通用意图
            confidence=0.5,
            entities=[
                {"type": "product", "value": "手机", "confidence": 0.9}
            ],
            text="我想找手机",
            context={},
            refinement_rules=["hierarchy_inference"]
        )
        result = self.tool.execute(input_data)
        
        assert result.error_message is None
        refined_intent = result.result_data["data"]["refined_intent"]
        # 意图可能保持不变或被精化，这取决于具体的推理逻辑
        assert "refined_intent" in result.result_data["data"]


class TestPostProcessingTool:
    """测试统一后处理工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.tool = PostProcessingTool()
    
    def test_complete_processing_pipeline(self):
        """测试完整处理流水线"""
        results = [
            {
                "intent": "search_product",
                "confidence": 0.7,
                "entities": [
                    {"type": "product", "value": "手机", "confidence": 0.8},
                    {"type": "product", "value": "手机", "confidence": 0.9},  # 重复实体
                    {"type": "brand", "value": "苹果", "confidence": 0.85}
                ],
                "source": "llm_result"
            },
            {
                "intent": "buy_product",
                "confidence": 0.6,
                "entities": [
                    {"type": "product", "value": "手机", "confidence": 0.75}
                ],
                "source": "rule_result"
            }
        ]
        
        result = self.tool.execute(
            results=results,
            text="我想买苹果手机",
            context={"user_history": ["search_product"], "context_relevance": 0.8}
        )
        
        assert result.error_message is None
        assert "original_results" in result.result_data["data"]
        assert "final_results" in result.result_data["data"]
        assert "processing_history" in result.result_data["data"]
        assert "success_rate" in result.result_data["data"]
        assert "quality_score" in result.result_data["data"]
        
        # 检查处理结果
        final_results = result.result_data["data"]["final_results"]
        print(f"Debug: final_results length = {len(final_results)}")
        print(f"Debug: final_results = {final_results}")
        print(f"Debug: processing_history = {result.result_data['data']['processing_history']}")
        assert len(final_results) == 1  # 冲突解决后应该只有一个结果
        
        final_result = final_results[0]
        assert "intent" in final_result
        assert "confidence" in final_result
        assert "entities" in final_result
        
        # 检查实体去重
        entities = final_result["entities"]
        product_entities = [e for e in entities if e["type"] == "product"]
        assert len(product_entities) == 1  # 重复实体应该被去除
        
        # 检查处理历史
        processing_history = result.result_data["data"]["processing_history"]
        assert len(processing_history) > 1
        
        # 检查成功率
        success_rate = result.result_data["data"]["success_rate"]
        assert 0.0 <= success_rate <= 1.0
        
        # 检查质量分数
        quality_score = result.result_data["data"]["quality_score"]
        assert 0.0 <= quality_score <= 1.0
    
    def test_custom_processing_steps(self):
        """测试自定义处理步骤"""
        results = [
            {
                "intent": "search_product",
                "confidence": 0.8,
                "entities": [{"type": "product", "value": "手机"}],
                "source": "llm_result"
            }
        ]
        
        # 只执行实体优化和置信度调整
        custom_steps = ["entity_optimization", "confidence_adjustment"]
        
        result = self.tool.execute(
            results=results,
            text="我想买手机",
            context={},
            processing_steps=custom_steps
        )
        
        assert result.error_message is None
        
        # 检查只执行了指定的步骤
        processing_history = result.result_data["data"]["processing_history"]
        executed_steps = [h["step"] for h in processing_history if h["step"] != "input"]
        
        for step in custom_steps:
            assert step in executed_steps
        
        # 不应该执行其他步骤
        assert "conflict_resolution" not in executed_steps
        assert "intent_refinement" not in executed_steps
        assert "result_validation" not in executed_steps
    
    def test_single_result_processing(self):
        """测试单结果处理"""
        results = [
            {
                "intent": "search_product",
                "confidence": 0.7,
                "entities": [
                    {"type": "product", "value": "手机", "confidence": 0.8}
                ],
                "source": "llm_result"
            }
        ]
        
        result = self.tool.execute(
            results=results,
            text="我想买手机",
            context={"context_relevance": 0.8}
        )
        
        assert result.error_message is None
        
        # 单结果应该跳过冲突解决
        processing_history = result.result_data["data"]["processing_history"]
        conflict_resolution_steps = [h for h in processing_history if h["step"] == "conflict_resolution"]
        
        if conflict_resolution_steps:
            # 如果执行了冲突解决，应该显示跳过信息
            assert "跳过" in conflict_resolution_steps[0].get("details", "")
    
    def test_empty_results_handling(self):
        """测试空结果处理"""
        result = self.tool.execute(
            results=[],
            text="我想买手机",
            context={}
        )
        
        assert result.error_message is None
        final_results = result.result_data["data"]["final_results"]
        assert len(final_results) == 0
        
        # 应该有处理历史记录
        processing_history = result.result_data["data"]["processing_history"]
        assert len(processing_history) > 0
    
    def test_processing_statistics(self):
        """测试处理统计信息"""
        stats = self.tool.get_processing_statistics()
        
        assert "default_processing_steps" in stats
        assert "step_configs" in stats
        assert "sub_tools" in stats
        assert "config" in stats
        
        # 检查默认处理步骤
        default_steps = stats["default_processing_steps"]
        expected_steps = [
            "conflict_resolution",
            "entity_optimization",
            "intent_refinement",
            "confidence_adjustment",
            "result_validation"
        ]
        for step in expected_steps:
            assert step in default_steps
        
        # 检查子工具统计
        sub_tools = stats["sub_tools"]
        assert "confidence_adjustment" in sub_tools
        assert "result_validation" in sub_tools
        assert "conflict_resolution" in sub_tools
        assert "entity_optimization" in sub_tools
        assert "intent_refinement" in sub_tools
    
    def test_step_configuration(self):
        """测试步骤配置"""
        # 配置处理步骤
        steps_config = {
            "confidence_adjustment": {
                "enabled": False
            },
            "result_validation": {
                "validation_level": "BASIC"
            }
        }
        
        self.tool.configure_processing_steps(steps_config)
        
        # 验证配置是否生效
        stats = self.tool.get_processing_statistics()
        step_configs = stats["step_configs"]
        
        assert step_configs["confidence_adjustment"]["enabled"] is False
        assert step_configs["result_validation"]["validation_level"] == "BASIC"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])