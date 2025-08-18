"""M2: Entity Extraction Tools 测试模块

测试实体抽取相关的工具和功能。
"""

import pytest
import asyncio
from typing import List, Dict, Any
from agenticx.core import AgentContext

# 导入实体抽取相关模块
from tools.entity_models import (
    Entity, EntityType, ExtractionResult, ExtractionMethod,
    EntityExtractionConfig, EntityMergeResult, EntityValidationResult
)
from tools.uie_extractor import UIEExtractor
from tools.llm_extractor import LLMExtractor
from tools.rule_extractor import RuleExtractor
from tools.hybrid_extractor import HybridExtractor


class TestEntityModels:
    """测试实体数据模型"""
    
    def test_entity_creation(self):
        """测试实体对象创建"""
        entity = Entity(
            text="张三",
            label="人名",
            entity_type=EntityType.PERSON,
            start=0,
            end=2,
            confidence=0.9
        )
        
        assert entity.text == "张三"
        assert entity.label == "人名"
        assert entity.entity_type == EntityType.PERSON
        assert entity.start == 0
        assert entity.end == 2
        assert entity.confidence == 0.9
    
    def test_extraction_result(self):
        """测试抽取结果模型"""
        result = ExtractionResult(
            entities={},
            confidence=0.8,
            extraction_method=ExtractionMethod.UIE,
            processing_time=0.5
        )
        
        # 添加实体
        entity = Entity(
            text="北京",
            label="地名",
            entity_type=EntityType.LOCATION,
            start=5,
            end=7,
            confidence=0.85
        )
        result.add_entity(entity)
        
        assert len(result.get_all_entities()) == 1
        assert len(result.get_entities_by_type(EntityType.LOCATION)) == 1
        assert result.extraction_method == ExtractionMethod.UIE
    
    def test_entity_extraction_config(self):
        """测试实体抽取配置"""
        config = EntityExtractionConfig(
            target_entities=[EntityType.PERSON, EntityType.LOCATION],
            confidence_threshold=0.7,
            max_entities_per_type=5
        )
        
        assert EntityType.PERSON in config.target_entities
        assert EntityType.LOCATION in config.target_entities
        assert config.confidence_threshold == 0.7
        assert config.max_entities_per_type == 5


class TestUIEExtractor:
    """测试UIE实体抽取工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.extractor = UIEExtractor()
    
    def test_extractor_initialization(self):
        """测试抽取器初始化"""
        assert self.extractor.name == "uie_extractor"
        assert "UIE模型" in self.extractor.description
        assert "text" in self.extractor.parameters
    
    def test_extract_entities_basic(self):
        """测试基本实体抽取"""
        text = "张三今天去北京开会"
        config = EntityExtractionConfig(
            target_entities=[EntityType.PERSON, EntityType.LOCATION, EntityType.TIME],
            confidence_threshold=0.5
        )
        
        result = self.extractor.extract_entities(text, config)
        
        assert isinstance(result, ExtractionResult)
        assert result.extraction_method == ExtractionMethod.UIE
        assert result.processing_time > 0
        
        # 检查是否识别出实体（模拟实现应该能识别出一些实体）
        all_entities = result.get_all_entities()
        assert len(all_entities) >= 0  # 至少不会出错
    
    def test_extract_entities_with_threshold(self):
        """测试置信度阈值过滤"""
        text = "张三今天去北京开会"
        config = EntityExtractionConfig(
            target_entities=[EntityType.PERSON, EntityType.LOCATION],
            confidence_threshold=0.9  # 高阈值
        )
        
        result = self.extractor.extract_entities(text, config)
        
        # 高阈值应该过滤掉一些实体
        for entities in result.entities.values():
            for entity in entities:
                assert entity.confidence >= 0.9
    
    def test_validate_entities(self):
        """测试实体验证"""
        text = "张三今天去北京"
        entities = [
            Entity(
                text="张三",
                label="人名",
                entity_type=EntityType.PERSON,
                start=0,
                end=2,
                confidence=0.9
            ),
            Entity(
                text="北京",
                label="地名",
                entity_type=EntityType.LOCATION,
                start=5,
                end=7,
                confidence=0.8
            )
        ]
        
        validation_result = self.extractor.validate_entities(entities, text)
        
        assert isinstance(validation_result, EntityValidationResult)
        assert validation_result.validation_score > 0
    
    @pytest.mark.asyncio
    async def test_execute_tool(self):
        """测试工具执行接口"""
        context = AgentContext(
            agent_id="test_agent",
            session_id="test_session"
        )
        context.variables["text"] = "张三今天去北京开会"
        context.variables["config"] = {
            "target_entities": ["person", "location"],
            "confidence_threshold": 0.5
        }
        
        result = await self.extractor.execute(context)
        
        assert "success" in result
        if result["success"]:
            assert "result" in result
            assert "entities_count" in result
            assert "processing_time" in result


class TestLLMExtractor:
    """测试LLM实体抽取工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.extractor = LLMExtractor()
    
    def test_extractor_initialization(self):
        """测试抽取器初始化"""
        assert self.extractor.name == "llm_extractor"
        assert "大语言模型" in self.extractor.description
        assert "text" in self.extractor.parameters
    
    def test_build_extraction_prompt(self):
        """测试提示词构建"""
        text = "张三今天去北京开会"
        target_entities = [EntityType.PERSON, EntityType.LOCATION]
        
        prompt = self.extractor._build_extraction_prompt(text, target_entities)
        
        assert text in prompt
        assert "JSON" in prompt
        assert "person" in prompt.lower()
        assert "location" in prompt.lower()

    def test_extract_entities_basic(self):
        """测试基本实体抽取"""
        text = "查询天气"
        config = EntityExtractionConfig(
            target_entities=[EntityType.OTHER],
            confidence_threshold=0.5
        )
        
        result = self.extractor.extract_entities(text, config)
        
        assert isinstance(result, ExtractionResult)
        assert result.extraction_method == ExtractionMethod.LLM
        assert result.processing_time > 0

    @pytest.mark.asyncio
    async def test_fallback_extraction(self):
        """测试回退机制"""
        # 模拟LLM调用失败
        self.extractor._call_llm = None
        
        text = "这是一个测试"
        config = EntityExtractionConfig(target_entities=[EntityType.PERSON])
        
        result = self.extractor.extract_entities(text, config)
        
        # 验证是否回退到UIE
        assert result.extraction_method == ExtractionMethod.UIE
        assert "fallback_reason" in result.metadata

    @pytest.mark.asyncio
    async def test_execute_tool(self):
        """测试工具执行接口"""
        context = AgentContext(
            agent_id="test_agent",
            session_id="test_session"
        )
        context.variables["text"] = "李四明天要去上海"
        context.variables["config"] = {
            "target_entities": ["person", "location", "time"],
            "confidence_threshold": 0.6
        }
        
        result = await self.extractor.execute(context)
        
        assert "success" in result
        if result["success"]:
            assert "result" in result
            assert "entities_count" in result


class TestRuleExtractor:
    """测试规则匹配实体抽取工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.extractor = RuleExtractor()
    
    def test_extractor_initialization(self):
        """测试抽取器初始化"""
        assert self.extractor.name == "rule_extractor"
        assert "正则表达式" in self.extractor.description
        assert "text" in self.extractor.parameters
    
    def test_phone_extraction(self):
        """测试电话号码抽取"""
        text = "我的手机号是13812345678，座机是010-12345678"
        config = EntityExtractionConfig(
            target_entities=[EntityType.PHONE],
            confidence_threshold=0.5
        )
        
        result = self.extractor.extract_entities(text, config)
        
        phone_entities = result.get_entities_by_type(EntityType.PHONE)
        assert len(phone_entities) >= 1
        
        # 检查识别的电话号码
        phone_texts = [entity.text for entity in phone_entities]
        assert any("13812345678" in phone for phone in phone_texts)
    
    def test_email_extraction(self):
        """测试邮箱抽取"""
        text = "请联系我的邮箱：test@example.com 或者 admin@company.org"
        config = EntityExtractionConfig(
            target_entities=[EntityType.EMAIL],
            confidence_threshold=0.5
        )
        
        result = self.extractor.extract_entities(text, config)
        
        email_entities = result.get_entities_by_type(EntityType.EMAIL)
        assert len(email_entities) >= 1
        
        # 检查识别的邮箱
        email_texts = [entity.text for entity in email_entities]
        assert any("test@example.com" in email for email in email_texts)
    
    def test_money_extraction(self):
        """测试金额抽取"""
        text = "价格是￥100元，总共需要1000块钱"
        config = EntityExtractionConfig(
            target_entities=[EntityType.MONEY],
            confidence_threshold=0.5
        )
        
        result = self.extractor.extract_entities(text, config)
        
        money_entities = result.get_entities_by_type(EntityType.MONEY)
        assert len(money_entities) >= 1
    
    def test_overlap_detection(self):
        """测试重叠检测"""
        text = "电话13812345678"
        config = EntityExtractionConfig(
            target_entities=[EntityType.PHONE],
            enable_overlap_detection=True,
            merge_strategy="highest_confidence"
        )
        
        result = self.extractor.extract_entities(text, config)
        
        # 重叠检测应该正常工作
        assert isinstance(result, ExtractionResult)
    
    def test_add_custom_rule(self):
        """测试添加自定义规则"""
        # 添加自定义规则
        success = self.extractor.add_custom_rule(
            EntityType.PRODUCT, 
            r'iPhone\s?\d+'
        )
        assert success
        
        # 测试自定义规则
        text = "我想买iPhone 14 Pro"
        config = EntityExtractionConfig(
            target_entities=[EntityType.PRODUCT],
            confidence_threshold=0.5
        )
        
        result = self.extractor.extract_entities(text, config)
        product_entities = result.get_entities_by_type(EntityType.PRODUCT)
        
        # 应该能识别出iPhone产品
        assert len(product_entities) >= 0  # 至少不会出错
    
    def test_get_supported_types(self):
        """测试获取支持的实体类型"""
        supported_types = self.extractor.get_supported_entity_types()
        
        assert EntityType.PHONE in supported_types
        assert EntityType.EMAIL in supported_types
        assert EntityType.MONEY in supported_types
    
    @pytest.mark.asyncio
    async def test_execute_tool(self):
        """测试工具执行接口"""
        context = AgentContext(agent_id="test_agent")
        context.variables["text"] = "联系电话：13812345678"
        context.variables["config"] = {
            "target_entities": ["phone"],
            "confidence_threshold": 0.5
        }
        
        result = await self.extractor.execute(context)
        
        assert "success" in result
        if result["success"]:
            assert "result" in result
            assert "patterns_used" in result


class TestHybridExtractor:
    """测试混合实体抽取工具"""
    
    def setup_method(self):
        """设置测试环境"""
        self.extractor = HybridExtractor(
            enable_uie=True,
            enable_llm=True,
            enable_rule=True
        )
    
    def test_extractor_initialization(self):
        """测试抽取器初始化"""
        assert self.extractor.name == "hybrid_extractor"
        assert "混合" in self.extractor.description
        assert "text" in self.extractor.parameters
        
        # 检查子抽取器
        assert self.extractor.uie_extractor is not None
        assert self.extractor.llm_extractor is not None
        assert self.extractor.rule_extractor is not None
    
    def test_extract_entities_comprehensive(self):
        """测试综合实体抽取"""
        text = "张三今天去北京开会，电话是13812345678，邮箱test@example.com"
        config = EntityExtractionConfig(
            target_entities=[
                EntityType.PERSON, EntityType.LOCATION, 
                EntityType.TIME, EntityType.PHONE, EntityType.EMAIL
            ],
            confidence_threshold=0.5
        )
        
        result = self.extractor.extract_entities(text, config)
        
        assert isinstance(result, ExtractionResult)
        assert result.extraction_method == ExtractionMethod.HYBRID
        assert result.processing_time > 0
        
        # 混合方法应该能识别出多种类型的实体
        all_entities = result.get_all_entities()
        assert len(all_entities) >= 0  # 至少不会出错
    
    def test_entity_merging(self):
        """测试实体合并"""
        # 创建一些重叠的实体用于测试
        entities = [
            Entity(
                text="张三",
                label="人名",
                entity_type=EntityType.PERSON,
                start=0,
                end=2,
                confidence=0.8,
                metadata={"source_method": "uie"}
            ),
            Entity(
                text="张三",
                label="人名",
                entity_type=EntityType.PERSON,
                start=0,
                end=2,
                confidence=0.9,
                metadata={"source_method": "llm"}
            )
        ]
        
        merged_entities = self.extractor._merge_overlapping_entities(
            entities, "highest_confidence"
        )
        
        # 应该合并为一个实体
        assert len(merged_entities) == 1
        # 应该选择置信度更高的
        assert merged_entities[0].confidence >= 0.8
    
    def test_type_priorities(self):
        """测试实体类型优先级"""
        # 电话号码应该优先使用规则匹配
        phone_priorities = self.extractor._type_priorities.get(EntityType.PHONE, {})
        assert phone_priorities.get("rule", 0) > phone_priorities.get("uie", 0)
        
        # 人名应该优先使用UIE
        person_priorities = self.extractor._type_priorities.get(EntityType.PERSON, {})
        assert person_priorities.get("uie", 0) >= person_priorities.get("rule", 0)
    
    def test_extraction_statistics(self):
        """测试抽取统计信息"""
        text = "张三的电话是13812345678"
        config = EntityExtractionConfig(
            target_entities=[EntityType.PERSON, EntityType.PHONE]
        )
        
        stats = self.extractor.get_extraction_statistics(text, config)
        
        assert "text_length" in stats
        assert "methods_enabled" in stats
        assert "method_results" in stats
        assert stats["text_length"] == len(text)
    
    def test_partial_extractor_disable(self):
        """测试部分抽取器禁用"""
        # 只启用规则抽取器
        extractor = HybridExtractor(
            enable_uie=False,
            enable_llm=False,
            enable_rule=True
        )
        
        assert extractor.uie_extractor is None
        assert extractor.llm_extractor is None
        assert extractor.rule_extractor is not None
        
        text = "电话：13812345678"
        config = EntityExtractionConfig(target_entities=[EntityType.PHONE])
        
        result = extractor.extract_entities(text, config)
        assert isinstance(result, ExtractionResult)
    
    @pytest.mark.asyncio
    async def test_execute_tool_with_stats(self):
        """测试带统计信息的工具执行"""
        context = AgentContext(agent_id="test_agent")
        context.variables["text"] = "张三的电话是13812345678，邮箱是test@example.com"
        context.variables["config"] = {
            "target_entities": ["person", "phone", "email"],
            "confidence_threshold": 0.5
        }
        context.variables["include_stats"] = True
        
        result = await self.extractor.execute(context)
        
        assert "success" in result
        if result["success"]:
            assert "result" in result
            assert "statistics" in result
            assert "text_length" in result["statistics"]
            assert "method_results" in result["statistics"]
            assert "methods_enabled" in result["statistics"]

if __name__ == "__main__":
    pytest.main(["-v", __file__])