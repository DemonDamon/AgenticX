"""M3 规则匹配工具测试

测试规则匹配工具的各种功能，包括全匹配、正则匹配、流水线处理等。
"""

import pytest
import time
from typing import List, Dict, Any

from tools.rule_models import (
    RuleConfig, MatchType, PipelineConfig, ValidationResult
)
from tools.rule_matching_tool import RuleMatchingTool
from tools.full_match_tool import FullMatchTool
from tools.regex_match_tool import RegexMatchTool


class TestRuleMatchingTool:
    """规则匹配主工具测试"""
    
    def setup_method(self):
        """测试前准备"""
        self.tool = RuleMatchingTool(
            enable_full_match=True,
            enable_regex_match=True,
            enable_parallel=False
        )
        
        # 准备测试规则
        self.test_rules = [
            RuleConfig(
                intent_code="greeting",
                description="问候语识别",
                match_strategy=MatchType.FULL_MATCH,
                patterns=["你好", "hello", "hi"],
                priority=1,
                confidence_weight=1.0
            ),
            RuleConfig(
                intent_code="phone_inquiry",
                description="电话号码查询",
                match_strategy=MatchType.REGEX_MATCH,
                patterns=[r"\d{11}", r"电话.*\d+", r"手机.*\d+"],
                priority=2,
                confidence_weight=0.9
            ),
            RuleConfig(
                intent_code="time_inquiry",
                description="时间查询",
                match_strategy=MatchType.FULL_MATCH,
                patterns=["现在几点", "什么时间", "时间"],
                priority=1,
                confidence_weight=0.8
            )
        ]
    
    def test_initialization(self):
        """测试工具初始化"""
        tool = RuleMatchingTool()
        assert tool.enable_full_match is True
        assert tool.enable_regex_match is True
        assert MatchType.FULL_MATCH in tool.matchers
        assert MatchType.REGEX_MATCH in tool.matchers
        
        # 测试禁用某些匹配器
        tool_limited = RuleMatchingTool(
            enable_full_match=False,
            enable_regex_match=True
        )
        assert MatchType.FULL_MATCH not in tool_limited.matchers
        assert MatchType.REGEX_MATCH in tool_limited.matchers
    
    def test_group_rules_by_strategy(self):
        """测试规则分组"""
        grouped = self.tool.group_rules_by_strategy(self.test_rules)
        
        assert MatchType.FULL_MATCH in grouped
        assert MatchType.REGEX_MATCH in grouped
        assert len(grouped[MatchType.FULL_MATCH]) == 2  # greeting, time_inquiry
        assert len(grouped[MatchType.REGEX_MATCH]) == 1  # phone_inquiry
        
        # 测试禁用规则
        disabled_rule = RuleConfig(
            intent_code="disabled",
            description="禁用规则",
            match_strategy=MatchType.FULL_MATCH,
            patterns=["test"],
            enabled=False
        )
        rules_with_disabled = self.test_rules + [disabled_rule]
        grouped_with_disabled = self.tool.group_rules_by_strategy(rules_with_disabled)
        
        # 禁用的规则不应该被包含
        full_match_rules = grouped_with_disabled.get(MatchType.FULL_MATCH, [])
        assert len(full_match_rules) == 2
        assert all(rule.intent_code != "disabled" for rule in full_match_rules)
    
    def test_execute_strategy_full_match(self):
        """测试全匹配策略执行"""
        full_match_rules = [rule for rule in self.test_rules if rule.match_strategy == MatchType.FULL_MATCH or rule.match_strategy == "full"]
        
        # 测试匹配成功
        results = self.tool.execute_strategy("你好，现在几点？", MatchType.FULL_MATCH, full_match_rules)
        assert len(results) >= 1
        
        # 应该匹配到问候语和时间查询
        intent_codes = [result.matched_intent for result in results]
        assert "greeting" in intent_codes
        assert "time_inquiry" in intent_codes
        
        # 测试无匹配
        no_match_results = self.tool.execute_strategy("随机文本", MatchType.FULL_MATCH, full_match_rules)
        assert len(no_match_results) == 0
    
    def test_execute_strategy_regex_match(self):
        """测试正则匹配策略执行"""
        regex_rules = [rule for rule in self.test_rules if rule.match_strategy == MatchType.REGEX_MATCH or rule.match_strategy == "regex"]
        
        # 测试匹配成功
        results = self.tool.execute_strategy("我的电话是13812345678", MatchType.REGEX_MATCH, regex_rules)
        assert len(results) >= 1
        
        result = results[0]
        assert result.matched_intent == "phone_inquiry"
        assert len(result.matches) >= 1
        
        # 测试无匹配
        no_match_results = self.tool.execute_strategy("没有数字的文本", MatchType.REGEX_MATCH, regex_rules)
        assert len(no_match_results) == 0
    
    def test_merge_results(self):
        """测试结果合并"""
        from tools.rule_models import RuleMatchResult, Match
        
        # 创建测试结果
        result1 = RuleMatchResult(
            matched_intent="greeting",
            matches=[Match(text="你好", start=0, end=2, pattern="你好", confidence=0.9)],
            confidence=0.9,
            rule_name="greeting_rule_1",
            match_type=MatchType.FULL_MATCH
        )
        
        result2 = RuleMatchResult(
            matched_intent="greeting",
            matches=[Match(text="hello", start=3, end=8, pattern="hello", confidence=0.8)],
            confidence=0.8,
            rule_name="greeting_rule_2",
            match_type=MatchType.FULL_MATCH
        )
        
        result3 = RuleMatchResult(
            matched_intent="time_inquiry",
            matches=[Match(text="几点", start=9, end=11, pattern="几点", confidence=0.7)],
            confidence=0.7,
            rule_name="time_rule",
            match_type=MatchType.FULL_MATCH
        )
        
        # 测试合并
        merged = self.tool.merge_results([result1, result2, result3])
        
        assert len(merged) == 2  # greeting 和 time_inquiry
        
        # 检查合并后的greeting结果
        greeting_result = next(r for r in merged if r.matched_intent == "greeting")
        assert len(greeting_result.matches) == 2  # 合并了两个匹配
        assert greeting_result.confidence > 0.8  # 综合置信度
        assert "Combined" in greeting_result.rule_name
        
        # 检查排序（按置信度降序）
        assert merged[0].confidence >= merged[1].confidence
    
    def test_execute_pipeline(self):
        """测试流水线执行"""
        pipeline_config = PipelineConfig(
            name="test_pipeline",
            stages=["full_match", "regex_match"],
            parallel_execution=False,
            timeout=30.0,
            fallback_strategy="continue"
        )
        
        # 测试成功执行
        result = self.tool.execute_pipeline(
            "你好，我的电话是13812345678",
            pipeline_config,
            self.test_rules
        )
        
        assert result.success is True
        assert result.pipeline_name == "test_pipeline"
        assert len(result.stage_results) >= 1
        assert result.final_result is not None
        assert result.total_processing_time >= 0
        
        # 检查元数据
        assert "stages_executed" in result.metadata
        assert "total_stages" in result.metadata
    
    def test_validate_config(self):
        """测试配置验证"""
        # 测试有效配置
        validation = self.tool.validate_config(self.test_rules)
        assert validation.is_valid is True
        assert validation.confidence > 0.8
        assert len(validation.errors) == 0
        
        # 测试无效配置
        invalid_rules = [
            RuleConfig(
                intent_code="",  # 空意图代码
                description="无效规则",
                match_strategy="full",
                patterns=[]
            )
        ]
        
        invalid_validation = self.tool.validate_config(invalid_rules)
        assert invalid_validation.is_valid is False
        assert len(invalid_validation.errors) > 0
        
        # 测试空规则列表
        empty_validation = self.tool.validate_config([])
        assert empty_validation.is_valid is False
        assert "没有有效的规则配置" in empty_validation.errors
    
    def test_get_performance_metrics(self):
        """测试性能指标计算"""
        from tools.rule_models import RuleMatchResult, Match
        
        # 创建测试结果
        results = [
            RuleMatchResult(
                matched_intent="test1",
                matches=[Match(text="test", start=0, end=4, confidence=0.9, pattern="test")],
                confidence=0.9,
                rule_name="rule1",
                match_type=MatchType.FULL_MATCH,
                processing_time=0.1
            ),
            RuleMatchResult(
                matched_intent="test2",
                matches=[Match(text="test", start=5, end=9, confidence=0.8, pattern="test")],
                confidence=0.8,
                rule_name="rule2",
                match_type=MatchType.REGEX_MATCH,
                processing_time=0.2
            )
        ]
        
        metrics = self.tool.get_performance_metrics(results)
        
        assert abs(metrics.processing_time - 0.3) < 1e-10
        assert metrics.throughput > 0
        assert abs(metrics.accuracy - 0.85) < 1e-10  # (0.9 + 0.8) / 2
        assert "total_results" in metrics.metadata
        assert metrics.metadata["total_results"] == 2
        
        # 测试空结果
        empty_metrics = self.tool.get_performance_metrics([])
        assert empty_metrics.processing_time == 0.0
    
    def test_execute_with_rules_list(self):
        """测试使用规则列表执行"""
        result = self.tool.execute(
            text="你好，现在几点？",
            rules=self.test_rules,
            return_metrics=True
        )
        
        assert result["success"] is True
        assert "matches" in result["data"]
        assert "total_matches" in result["data"]
        assert "metrics" in result["data"]
        assert "processing_time" in result["metadata"]
        
        # 检查匹配结果
        matches = result["data"]["matches"]
        assert len(matches) >= 1
        
        # 应该匹配到问候语和时间查询
        intent_codes = [match["matched_intent"] for match in matches]
        assert "greeting" in intent_codes
        assert "time_inquiry" in intent_codes
    
    def test_execute_with_rule_config_dict(self):
        """测试使用配置字典执行"""
        rule_config = {
            "greeting": {
                "description": "问候语识别",
                "strategies": ["full_match"],
                "patterns": ["你好", "hello"],
                "priority": 1,
                "confidence_weight": 1.0
            },
            "phone_inquiry": {
                "description": "电话查询",
                "strategies": ["regex_match"],
                "patterns": [r"\d{11}"],
                "priority": 2,
                "confidence_weight": 0.9
            }
        }
        
        result = self.tool.execute(
            text="你好，我的电话是13812345678",
            rule_config=rule_config
        )
        
        assert result["success"] is True
        assert "matches" in result["data"]
        
        matches = result["data"]["matches"]
        intent_codes = [match["matched_intent"] for match in matches]
        assert "greeting" in intent_codes
        assert "phone_inquiry" in intent_codes
    
    def test_execute_with_pipeline(self):
        """测试使用流水线执行"""
        pipeline_config = PipelineConfig(
            name="test_pipeline",
            stages=["full_match", "regex_match"],
            parallel_execution=False,
            timeout=30.0
        )
        
        result = self.tool.execute(
            text="你好，我的电话是13812345678",
            rules=self.test_rules,
            pipeline_config=pipeline_config
        )
        
        assert result["success"] is True
        assert "pipeline_result" in result["data"]
        assert "matches" in result["data"]
        
        pipeline_result = result["data"]["pipeline_result"]
        assert pipeline_result["success"] is True
        assert pipeline_result["pipeline_name"] == "test_pipeline"
    
    def test_execute_error_handling(self):
        """测试错误处理"""
        # 测试空文本
        result = self.tool.execute(text="")
        assert result["success"] is False
        assert "输入文本不能为空" in result["error"]
        
        # 测试无效规则配置
        invalid_rules = [
            RuleConfig(
                intent_code="",
                description="无效规则",
                match_strategy=MatchType.FULL_MATCH,
                patterns=[]
            )
        ]
        
        result = self.tool.execute(
            text="测试文本",
            rules=invalid_rules
        )
        assert result["success"] is False
        assert "规则配置无效" in result["error"]
    
    def test_integration_complex_text(self):
        """测试复杂文本的综合处理"""
        complex_text = "你好！我想查询一下我的电话号码13812345678，现在几点了？"
        
        result = self.tool.execute(
            text=complex_text,
            rules=self.test_rules,
            return_metrics=True
        )
        
        assert result["success"] is True
        
        matches = result["data"]["matches"]
        assert len(matches) >= 2  # 至少匹配到问候语和电话查询
        
        # 检查意图覆盖
        intent_codes = [match["matched_intent"] for match in matches]
        assert "greeting" in intent_codes
        assert "phone_inquiry" in intent_codes
        
        # 检查性能指标
        metrics = result["data"]["metrics"]
        assert metrics["processing_time"] >= 0
        assert metrics["accuracy"] > 0
        
        # 检查元数据
        assert "rules_count" in result["metadata"]
        assert "strategies_used" in result["metadata"]
        assert "validation" in result["metadata"]


class TestRuleMatchingIntegration:
    """规则匹配集成测试"""
    
    def test_full_workflow(self):
        """测试完整工作流程"""
        tool = RuleMatchingTool()
        
        # 定义规则配置
        rule_config = {
            "greeting": {
                "description": "问候语识别",
                "strategies": ["full_match"],
                "patterns": ["你好", "hello", "hi", "早上好"],
                "priority": 1
            },
            "goodbye": {
                "description": "告别语识别",
                "strategies": ["full_match"],
                "patterns": ["再见", "bye", "goodbye"],
                "priority": 1
            },
            "phone_inquiry": {
                "description": "电话查询",
                "strategies": ["regex_match"],
                "patterns": [r"\d{11}", r"电话.*\d+", r"手机.*\d+"],
                "priority": 2
            },
            "time_inquiry": {
                "description": "时间查询",
                "strategies": ["full_match", "regex_match"],
                "patterns": ["几点", "时间", r"\d+点"],
                "priority": 1
            }
        }
        
        # 测试用例
        test_cases = [
            {
                "text": "你好",
                "expected_intents": ["greeting"]
            },
            {
                "text": "我的电话是13812345678",
                "expected_intents": ["phone_inquiry"]
            },
            {
                "text": "现在几点了？",
                "expected_intents": ["time_inquiry"]
            },
            {
                "text": "你好，现在几点了？我的电话是13812345678，再见！",
                "expected_intents": ["greeting", "time_inquiry", "phone_inquiry", "goodbye"]
            }
        ]
        
        for test_case in test_cases:
            result = tool.execute(
                text=test_case["text"],
                rule_config=rule_config,
                return_metrics=True
            )
            
            assert result["success"] is True, f"Failed for text: {test_case['text']}"
            
            matches = result["data"]["matches"]
            matched_intents = [match["matched_intent"] for match in matches]
            
            for expected_intent in test_case["expected_intents"]:
                assert expected_intent in matched_intents, f"Missing intent {expected_intent} for text: {test_case['text']}"
    
    def test_performance_benchmark(self):
        """测试性能基准"""
        tool = RuleMatchingTool()
        
        # 大量规则配置
        rule_config = {}
        for i in range(50):
            rule_config[f"intent_{i}"] = {
                "description": f"Intent {i}",
                "strategies": ["full_match"],
                "patterns": [f"pattern_{i}", f"keyword_{i}"],
                "priority": 1
            }
        
        # 性能测试
        start_time = time.time()
        
        for _ in range(10):
            result = tool.execute(
                text="这是一个测试文本 pattern_25 keyword_30",
                rule_config=rule_config
            )
            assert result["success"] is True
        
        total_time = time.time() - start_time
        avg_time = total_time / 10
        
        # 性能要求：平均每次执行时间应小于1秒
        assert avg_time < 1.0, f"Performance too slow: {avg_time:.3f}s per execution"
        
        print(f"Performance benchmark: {avg_time:.3f}s per execution")