"""规则匹配主工具

协调多种匹配策略的执行，支持流水线式规则处理。
基于AgenticX BaseTool架构设计。
"""

import time
from typing import List, Dict, Any, Optional, Union
from agenticx.tools import BaseTool
from typing import Dict, Any as ToolResult
from .rule_models import (
    RuleConfig, RuleMatchResult, Match, MatchType, ValidationResult,
    PipelineConfig, PipelineResult, PerformanceMetrics
)
from .full_match_tool import FullMatchTool
from .regex_match_tool import RegexMatchTool


class RuleMatchingTool(BaseTool):
    """规则匹配主工具
    
    继承AgenticX BaseTool，协调多种匹配策略的执行。
    支持全匹配、正则匹配等多种策略，提供统一的接口。
    """
    
    def __init__(self, 
                 enable_full_match: bool = True,
                 enable_regex_match: bool = True,
                 enable_parallel: bool = False,
                 max_workers: int = 4,
                 timeout: float = 30.0,
                 **kwargs):
        """初始化规则匹配工具
        
        Args:
            enable_full_match: 是否启用全匹配
            enable_regex_match: 是否启用正则匹配
            enable_parallel: 是否启用并行处理
            max_workers: 最大工作线程数
            timeout: 超时时间(秒)
        """
        super().__init__(**kwargs)
        self.enable_full_match = enable_full_match
        self.enable_regex_match = enable_regex_match
        self.enable_parallel = enable_parallel
        self.max_workers = max_workers
        self.timeout = timeout
        
        # 初始化子工具
        self.matchers = {}
        
        if self.enable_full_match:
            self.matchers[MatchType.FULL_MATCH] = FullMatchTool(
                case_sensitive=False,
                normalize_whitespace=True
            )
        
        if self.enable_regex_match:
            self.matchers[MatchType.REGEX_MATCH] = RegexMatchTool(
                case_sensitive=False,
                cache_patterns=True
            )
    
    def group_rules_by_strategy(self, rules: List[RuleConfig]) -> Dict[MatchType, List[RuleConfig]]:
        """按匹配策略分组规则
        
        Args:
            rules: 规则配置列表
            
        Returns:
            按策略分组的规则字典
        """
        grouped = {}
        
        for rule in rules:
            if not rule.enabled:
                continue
            
            strategy = rule.match_strategy
            # 确保strategy是MatchType枚举
            if isinstance(strategy, str):
                # 将字符串转换为MatchType枚举
                if strategy == "full":
                    strategy = MatchType.FULL_MATCH
                elif strategy == "regex":
                    strategy = MatchType.REGEX_MATCH
                else:
                    continue  # 跳过不支持的策略
            
            if strategy not in grouped:
                grouped[strategy] = []
            grouped[strategy].append(rule)
        
        return grouped
    
    def execute_strategy(self, text: str, strategy: MatchType, rules: List[RuleConfig]) -> List[RuleMatchResult]:
        """执行特定策略的匹配
        
        Args:
            text: 待匹配文本
            strategy: 匹配策略
            rules: 规则列表
            
        Returns:
            匹配结果列表
        """
        if strategy not in self.matchers:
            return []
        
        matcher = self.matchers[strategy]
        
        try:
            return matcher.match_rules(text, rules)
        except Exception as e:
            # 记录错误但不中断整个流程
            return []
    
    def merge_results(self, all_results: List[RuleMatchResult]) -> List[RuleMatchResult]:
        """合并多个策略的匹配结果
        
        Args:
            all_results: 所有匹配结果
            
        Returns:
            合并后的结果列表
        """
        if not all_results:
            return []
        
        # 按意图分组
        intent_groups = {}
        for result in all_results:
            if result.matched_intent:
                intent = result.matched_intent
                if intent not in intent_groups:
                    intent_groups[intent] = []
                intent_groups[intent].append(result)
        
        # 合并同一意图的结果
        merged_results = []
        for intent, results in intent_groups.items():
            if len(results) == 1:
                merged_results.append(results[0])
            else:
                # 合并多个结果
                best_result = max(results, key=lambda x: x.confidence)
                
                # 合并所有匹配项
                all_matches = []
                total_processing_time = 0.0
                strategies = set()
                
                for result in results:
                    all_matches.extend(result.matches)
                    total_processing_time += result.processing_time
                    strategies.add(result.match_type)
                
                # 计算综合置信度
                avg_confidence = sum(r.confidence for r in results) / len(results)
                max_confidence = max(r.confidence for r in results)
                combined_confidence = (avg_confidence + max_confidence) / 2
                
                merged_result = RuleMatchResult(
                    matched_intent=intent,
                    matches=all_matches,
                    confidence=combined_confidence,
                    rule_name=f"Combined: {', '.join(r.rule_name for r in results)}",
                    match_type=best_result.match_type,
                    processing_time=total_processing_time,
                    metadata={
                        "merged_from": len(results),
                        "strategies_used": list(strategies),
                        "total_matches": len(all_matches),
                        "confidence_range": [min(r.confidence for r in results), max(r.confidence for r in results)]
                    }
                )
                merged_results.append(merged_result)
        
        # 按置信度排序
        merged_results.sort(key=lambda x: -x.confidence)
        
        return merged_results
    
    def execute_pipeline(self, text: str, pipeline_config: PipelineConfig, rules: List[RuleConfig]) -> PipelineResult:
        """执行规则匹配流水线
        
        Args:
            text: 待匹配文本
            pipeline_config: 流水线配置
            rules: 规则列表
            
        Returns:
            流水线执行结果
        """
        start_time = time.time()
        stage_results = {}
        final_result = None
        success = True
        error_message = None
        
        try:
            # 按策略分组规则
            grouped_rules = self.group_rules_by_strategy(rules)
            
            # 执行各个阶段
            all_results = []
            
            for stage in pipeline_config.stages:
                stage_start = time.time()
                
                try:
                    # 解析阶段名称为匹配策略
                    if stage == "full_match":
                        strategy = MatchType.FULL_MATCH
                    elif stage == "regex_match":
                        strategy = MatchType.REGEX_MATCH
                    else:
                        continue
                    
                    if strategy in grouped_rules:
                        stage_rules = grouped_rules[strategy]
                        results = self.execute_strategy(text, strategy, stage_rules)
                        all_results.extend(results)
                        
                        # 记录阶段结果
                        if results:
                            best_stage_result = max(results, key=lambda x: x.confidence)
                            stage_results[stage] = best_stage_result
                
                except Exception as e:
                    error_message = f"阶段 {stage} 执行失败: {str(e)}"
                    if pipeline_config.fallback_strategy != "continue":
                        success = False
                        break
            
            # 合并所有结果
            if all_results:
                merged_results = self.merge_results(all_results)
                if merged_results:
                    final_result = merged_results[0]
            
        except Exception as e:
            success = False
            error_message = f"流水线执行失败: {str(e)}"
        
        total_time = time.time() - start_time
        
        return PipelineResult(
            pipeline_name=pipeline_config.name,
            stage_results=stage_results,
            final_result=final_result,
            total_processing_time=total_time,
            success=success,
            error_message=error_message,
            metadata={
                "stages_executed": len(stage_results),
                "total_stages": len(pipeline_config.stages),
                "parallel_execution": pipeline_config.parallel_execution,
                "timeout": pipeline_config.timeout
            }
        )
    
    def validate_config(self, rules: List[RuleConfig]) -> ValidationResult:
        """验证规则配置
        
        Args:
            rules: 规则配置列表
            
        Returns:
            验证结果
        """
        errors = []
        warnings = []
        suggestions = []
        
        # 按策略分组验证
        grouped_rules = self.group_rules_by_strategy(rules)
        
        for strategy, strategy_rules in grouped_rules.items():
            if strategy in self.matchers:
                matcher = self.matchers[strategy]
                validation = matcher.validate_config(strategy_rules)
                
                # 添加策略前缀
                strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
                for error in validation.errors:
                    errors.append(f"[{strategy_name}] {error}")
                for warning in validation.warnings:
                    warnings.append(f"[{strategy_name}] {warning}")
                for suggestion in validation.suggestions:
                    suggestions.append(f"[{strategy_name}] {suggestion}")
            else:
                strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
                warnings.append(f"策略 {strategy_name} 未启用或不支持")
        
        # 检查规则分布
        if not grouped_rules:
            errors.append("没有有效的规则配置")
        
        # 检查意图覆盖
        all_intents = set()
        for rule in rules:
            if rule.enabled and rule.intent_code:
                all_intents.add(rule.intent_code)
        
        if len(all_intents) < 2:
            suggestions.append("建议配置更多意图类型以提高识别能力")
        
        is_valid = len(errors) == 0
        confidence = 1.0 if is_valid else max(0.0, 1.0 - len(errors) / max(len(rules), 1))
        
        return ValidationResult(
            is_valid=is_valid,
            confidence=confidence,
            errors=errors,
            warnings=warnings,
            suggestions=suggestions,
            metadata={
                "total_rules": len(rules),
                "enabled_rules": len([r for r in rules if r.enabled]),
                "strategies_used": list(grouped_rules.keys()),
                "intents_covered": list(all_intents)
            }
        )
    
    def get_performance_metrics(self, results: List[RuleMatchResult]) -> PerformanceMetrics:
        """计算性能指标
        
        Args:
            results: 匹配结果列表
            
        Returns:
            性能指标
        """
        if not results:
            return PerformanceMetrics()
        
        total_time = sum(r.processing_time for r in results)
        avg_time = total_time / len(results)
        
        # 计算置信度统计
        confidences = [r.confidence for r in results]
        avg_confidence = sum(confidences) / len(confidences)
        
        # 计算匹配统计
        total_matches = sum(len(r.matches) for r in results)
        
        return PerformanceMetrics(
            processing_time=total_time,
            throughput=len(results) / max(total_time, 0.001),
            accuracy=avg_confidence,
            metadata={
                "total_results": len(results),
                "avg_processing_time": avg_time,
                "total_matches": total_matches,
                "avg_matches_per_result": total_matches / len(results),
                "confidence_range": [min(confidences), max(confidences)]
            }
        )
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """
        BaseTool要求的抽象方法实现
        """
        return self.execute(**kwargs)
    
    def execute(self, 
                text: str, 
                rules: Optional[List[RuleConfig]] = None,
                rule_config: Optional[Dict[str, Any]] = None,
                pipeline_config: Optional[PipelineConfig] = None,
                return_metrics: bool = False,
                **kwargs) -> Dict[str, Any]:
        """执行规则匹配
        
        Args:
            text: 待匹配文本
            rules: 规则配置列表
            rule_config: 规则配置字典
            pipeline_config: 流水线配置
            return_metrics: 是否返回性能指标
            **kwargs: 其他参数
            
        Returns:
            工具执行结果
        """
        try:
            start_time = time.time()
            
            # 参数验证
            if not text:
                return {
                "success": False,
                "data": None,
                "error": "输入文本不能为空",
                "metadata": {"processing_time": 0.0}
            }
            
            # 处理规则配置
            if rules is None:
                rules = []
            
            if rule_config:
                # 从配置字典创建规则
                for intent_code, config in rule_config.items():
                    # 支持多种匹配策略
                    strategies = config.get("strategies", ["full_match"])
                    
                    for strategy_name in strategies:
                        if strategy_name == "full_match" or strategy_name == "full":
                            strategy = MatchType.FULL_MATCH
                        elif strategy_name == "regex_match" or strategy_name == "regex":
                            strategy = MatchType.REGEX_MATCH
                        else:
                            continue
                        
                        rule = RuleConfig(
                            intent_code=intent_code,
                            description=config.get("description", f"Rule for {intent_code} ({strategy_name})"),
                            match_strategy=strategy,
                            patterns=config.get("patterns", []),
                            priority=config.get("priority", 1),
                            confidence_weight=config.get("confidence_weight", 1.0)
                        )
                        rules.append(rule)
            
            # 验证规则配置
            validation = self.validate_config(rules)
            if not validation.is_valid:
                return {
                "success": False,
                "data": None,
                "error": f"规则配置无效: {'; '.join(validation.errors)}",
                "metadata": {
                    "validation": validation.dict(),
                    "processing_time": time.time() - start_time
                }
            }
            
            # 执行匹配
            if pipeline_config:
                # 使用流水线模式
                pipeline_result = self.execute_pipeline(text, pipeline_config, rules)
                results = [pipeline_result.final_result] if pipeline_result.final_result else []
                
                result_data = {
                    "pipeline_result": pipeline_result.dict(),
                    "matches": [r.dict() for r in results],
                    "total_matches": len(results)
                }
            else:
                # 使用标准模式
                grouped_rules = self.group_rules_by_strategy(rules)
                all_results = []
                
                for strategy, strategy_rules in grouped_rules.items():
                    strategy_results = self.execute_strategy(text, strategy, strategy_rules)
                    all_results.extend(strategy_results)
                
                results = self.merge_results(all_results)
                
                result_data = {
                    "matches": [result.dict() for result in results],
                    "total_matches": len(results),
                    "best_match": results[0].dict() if results else None
                }
            
            # 计算性能指标
            metrics = None
            if return_metrics and results:
                metrics = self.get_performance_metrics(results)
                result_data["metrics"] = metrics.dict()
            
            processing_time = time.time() - start_time
            
            return {
                "success": True,
                "data": result_data,
                "metadata": {
                    "processing_time": processing_time,
                    "rules_count": len(rules),
                    "strategies_used": list(self.group_rules_by_strategy(rules).keys()),
                    "validation": validation.dict()
                }
            }
            
        except Exception as e:
            return {
                "success": False,
                "data": None,
                "error": f"规则匹配执行失败: {str(e)}",
                "metadata": {
                    "processing_time": time.time() - start_time if 'start_time' in locals() else 0.0
                }
            }