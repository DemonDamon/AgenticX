"""全匹配工具

实现精确文本匹配逻辑，支持文本标准化和模式匹配。
基于AgenticX BaseTool架构设计。
"""

import re
import time
from typing import List, Dict, Any, Optional
from agenticx.tools import BaseTool
# from agenticx.core import ToolResult
from .rule_models import RuleConfig, RuleMatchResult, Match, MatchType, ValidationResult


class FullMatchTool(BaseTool):
    """全匹配工具
    
    继承AgenticX BaseTool，实现精确文本匹配逻辑。
    支持文本标准化、大小写忽略、空白字符处理等功能。
    """
    
    def __init__(self, 
                 case_sensitive: bool = False,
                 normalize_whitespace: bool = True,
                 strip_punctuation: bool = False,
                 **kwargs):
        """初始化全匹配工具
        
        Args:
            case_sensitive: 是否区分大小写
            normalize_whitespace: 是否标准化空白字符
            strip_punctuation: 是否移除标点符号
        """
        super().__init__(**kwargs)
        self.case_sensitive = case_sensitive
        self.normalize_whitespace = normalize_whitespace
        self.strip_punctuation = strip_punctuation
        
        # 标点符号正则表达式
        self.punctuation_pattern = re.compile(r'[^\w\s]', re.UNICODE)
        # 空白字符正则表达式
        self.whitespace_pattern = re.compile(r'\s+', re.UNICODE)
    
    def normalize_text(self, text: str) -> str:
        """标准化文本
        
        Args:
            text: 原始文本
            
        Returns:
            标准化后的文本
        """
        if not text:
            return ""
        
        result = text
        
        # 标准化空白字符
        if self.normalize_whitespace:
            result = self.whitespace_pattern.sub(' ', result).strip()
        
        # 移除标点符号
        if self.strip_punctuation:
            result = self.punctuation_pattern.sub('', result)
        
        # 大小写处理
        if not self.case_sensitive:
            result = result.lower()
        
        return result
    
    def find_matches(self, text: str, pattern: str) -> List[Match]:
        """查找匹配项
        
        Args:
            text: 待匹配文本
            pattern: 匹配模式
            
        Returns:
            匹配结果列表
        """
        matches = []
        
        # 标准化文本和模式
        normalized_text = self.normalize_text(text)
        normalized_pattern = self.normalize_text(pattern)
        
        if not normalized_pattern:
            return matches
        
        # 查找所有匹配位置
        start = 0
        while True:
            pos = normalized_text.find(normalized_pattern, start)
            if pos == -1:
                break
            
            # 计算原始文本中的位置
            original_start = self._map_to_original_position(text, pos, True)
            original_end = self._map_to_original_position(text, pos + len(normalized_pattern), False)
            
            match = Match(
                text=text[original_start:original_end],
                start=original_start,
                end=original_end,
                pattern=pattern,
                confidence=1.0,
                metadata={
                    "normalized_text": normalized_text[pos:pos + len(normalized_pattern)],
                    "normalized_pattern": normalized_pattern
                }
            )
            matches.append(match)
            
            start = pos + 1
        
        return matches
    
    def _map_to_original_position(self, original_text: str, normalized_pos: int, is_start: bool) -> int:
        """将标准化文本位置映射回原始文本位置
        
        Args:
            original_text: 原始文本
            normalized_pos: 标准化文本中的位置
            is_start: 是否为起始位置
            
        Returns:
            原始文本中的位置
        """
        # 简化实现：逐字符对比找到对应位置
        normalized_chars = 0
        for i, char in enumerate(original_text):
            normalized_char = self.normalize_text(char)
            if normalized_char:
                if normalized_chars == normalized_pos:
                    return i
                normalized_chars += len(normalized_char)
        
        # 如果是结束位置且超出范围，返回文本长度
        if not is_start:
            return len(original_text)
        
        return 0
    
    def match_rules(self, text: str, rules: List[RuleConfig]) -> List[RuleMatchResult]:
        """使用规则列表进行匹配
        
        Args:
            text: 待匹配文本
            rules: 规则配置列表
            
        Returns:
            匹配结果列表
        """
        results = []
        
        for rule in rules:
            if not rule.enabled:
                continue
            
            # 处理枚举值可能被序列化为字符串的情况
            rule_strategy = rule.match_strategy
            if isinstance(rule_strategy, str):
                if rule_strategy == "full":
                    rule_strategy = MatchType.FULL_MATCH
                elif rule_strategy != MatchType.FULL_MATCH.value:
                    continue
            elif rule_strategy != MatchType.FULL_MATCH:
                continue
            
            start_time = time.time()
            all_matches = []
            
            # 对每个模式进行匹配
            for pattern in rule.patterns:
                matches = self.find_matches(text, pattern)
                all_matches.extend(matches)
            
            processing_time = time.time() - start_time
            
            # 计算置信度
            confidence = 0.0
            if all_matches:
                confidence = rule.confidence_weight
            
            result = RuleMatchResult(
                matched_intent=rule.intent_code if all_matches else None,
                matches=all_matches,
                confidence=confidence,
                rule_name=rule.description,
                match_type=MatchType.FULL_MATCH,
                processing_time=processing_time,
                metadata={
                    "rule_priority": rule.priority,
                    "patterns_count": len(rule.patterns),
                    "matches_count": len(all_matches)
                }
            )
            
            if all_matches:  # 只返回有匹配的结果
                results.append(result)
        
        # 按优先级和置信度排序
        results.sort(key=lambda x: (-x.confidence, -x.metadata.get("rule_priority", 0)))
        
        return results
    
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
        
        for i, rule in enumerate(rules):
            # 检查必要字段
            if not rule.intent_code:
                errors.append(f"规则 {i}: 缺少意图编码")
            
            if not rule.patterns:
                warnings.append(f"规则 {i}: 没有定义匹配模式")
            
            # 检查模式有效性
            for j, pattern in enumerate(rule.patterns):
                if not pattern.strip():
                    warnings.append(f"规则 {i}, 模式 {j}: 空模式")
                
                if len(pattern) < 2:
                    suggestions.append(f"规则 {i}, 模式 {j}: 模式过短，可能导致误匹配")
        
        is_valid = len(errors) == 0
        confidence = 1.0 if is_valid else 0.0
        
        return ValidationResult(
            is_valid=is_valid,
            confidence=confidence,
            errors=errors,
            warnings=warnings,
            suggestions=suggestions,
            metadata={
                "total_rules": len(rules),
                "valid_rules": len([r for r in rules if r.intent_code and r.patterns])
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
                **kwargs) -> Dict[str, Any]:
        """执行全匹配
        
        Args:
            text: 待匹配文本
            rules: 规则配置列表
            rule_config: 规则配置字典
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
                    rule = RuleConfig(
                        intent_code=intent_code,
                        description=config.get("description", f"Rule for {intent_code}"),
                        match_strategy=MatchType.FULL_MATCH,
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
            results = self.match_rules(text, rules)
            
            processing_time = time.time() - start_time
            
            return {
                "success": True,
                "data": {
                    "matches": [result.dict() for result in results],
                    "total_matches": len(results),
                    "best_match": results[0].dict() if results else None
                },
                "metadata": {
                    "processing_time": processing_time,
                    "rules_count": len(rules),
                    "validation": validation.dict()
                }
            }
            
        except Exception as e:
            return {
                "success": False,
                "data": None,
                "error": f"全匹配执行失败: {str(e)}",
                "metadata": {
                    "processing_time": time.time() - start_time if 'start_time' in locals() else 0.0
                }
            }