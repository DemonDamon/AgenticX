"""正则表达式匹配工具

实现正则表达式模式匹配，支持分组提取和命名捕获。
基于AgenticX BaseTool架构设计。
"""

import re
import time
from typing import List, Dict, Any, Optional, Pattern
from agenticx.tools import BaseTool
# from agenticx.core import ToolResult
from .rule_models import RuleConfig, RuleMatchResult, Match, MatchType, ValidationResult


class RegexMatchTool(BaseTool):
    """正则表达式匹配工具
    
    继承AgenticX BaseTool，实现正则表达式模式匹配。
    支持分组提取、命名捕获、模式编译和缓存等功能。
    """
    
    def __init__(self, 
                 case_sensitive: bool = False,
                 multiline: bool = True,
                 dotall: bool = False,
                 cache_patterns: bool = True,
                 max_cache_size: int = 1000,
                 **kwargs):
        """初始化正则匹配工具
        
        Args:
            case_sensitive: 是否区分大小写
            multiline: 是否多行模式
            dotall: 是否让.匹配换行符
            cache_patterns: 是否缓存编译的模式
            max_cache_size: 最大缓存大小
        """
        super().__init__(**kwargs)
        self.case_sensitive = case_sensitive
        self.multiline = multiline
        self.dotall = dotall
        self.cache_patterns = cache_patterns
        self.max_cache_size = max_cache_size
        
        # 模式缓存
        self._pattern_cache: Dict[str, Pattern] = {}
        
        # 构建正则标志
        self.regex_flags = 0
        if not self.case_sensitive:
            self.regex_flags |= re.IGNORECASE
        if self.multiline:
            self.regex_flags |= re.MULTILINE
        if self.dotall:
            self.regex_flags |= re.DOTALL
    
    def compile_pattern(self, pattern: str) -> Optional[Pattern]:
        """编译正则表达式模式
        
        Args:
            pattern: 正则表达式字符串
            
        Returns:
            编译后的正则表达式对象，失败返回None
        """
        if not pattern:
            return None
        
        # 检查缓存
        cache_key = f"{pattern}_{self.regex_flags}"
        if self.cache_patterns and cache_key in self._pattern_cache:
            return self._pattern_cache[cache_key]
        
        try:
            compiled_pattern = re.compile(pattern, self.regex_flags)
            
            # 添加到缓存
            if self.cache_patterns:
                # 如果缓存已满，清理最旧的条目
                if len(self._pattern_cache) >= self.max_cache_size:
                    # 简单的FIFO策略
                    oldest_key = next(iter(self._pattern_cache))
                    del self._pattern_cache[oldest_key]
                
                self._pattern_cache[cache_key] = compiled_pattern
            
            return compiled_pattern
            
        except re.error as e:
            # 正则表达式语法错误
            return None
    
    def find_matches(self, text: str, pattern: str) -> List[Match]:
        """查找正则匹配项
        
        Args:
            text: 待匹配文本
            pattern: 正则表达式模式
            
        Returns:
            匹配结果列表
        """
        matches = []
        
        compiled_pattern = self.compile_pattern(pattern)
        if not compiled_pattern:
            return matches
        
        # 查找所有匹配
        for match_obj in compiled_pattern.finditer(text):
            # 提取分组
            groups = list(match_obj.groups())
            
            # 提取命名分组
            named_groups = match_obj.groupdict()
            
            match = Match(
                text=match_obj.group(0),
                start=match_obj.start(),
                end=match_obj.end(),
                pattern=pattern,
                confidence=1.0,
                groups=groups,
                metadata={
                    "named_groups": named_groups,
                    "group_count": len(groups),
                    "full_match": match_obj.group(0),
                    "span": match_obj.span()
                }
            )
            matches.append(match)
        
        return matches
    
    def extract_entities(self, text: str, pattern: str, entity_type: str = "ENTITY") -> List[Dict[str, Any]]:
        """从正则匹配中提取实体
        
        Args:
            text: 待匹配文本
            pattern: 正则表达式模式
            entity_type: 实体类型
            
        Returns:
            实体列表
        """
        entities = []
        matches = self.find_matches(text, pattern)
        
        for match in matches:
            entity = {
                "text": match.text,
                "type": entity_type,
                "start": match.start,
                "end": match.end,
                "confidence": match.confidence,
                "groups": match.groups,
                "named_groups": match.metadata.get("named_groups", {})
            }
            entities.append(entity)
        
        return entities
    
    def match_rules(self, text: str, rules: List[RuleConfig]) -> List[RuleMatchResult]:
        """使用规则列表进行正则匹配
        
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
                if rule_strategy == "regex":
                    rule_strategy = MatchType.REGEX_MATCH
                elif rule_strategy != MatchType.REGEX_MATCH.value:
                    continue
            elif rule_strategy != MatchType.REGEX_MATCH:
                continue
            
            start_time = time.time()
            all_matches = []
            
            # 对每个正则模式进行匹配
            for pattern in rule.patterns:
                matches = self.find_matches(text, pattern)
                all_matches.extend(matches)
            
            processing_time = time.time() - start_time
            
            # 计算置信度
            confidence = 0.0
            if all_matches:
                # 基于匹配数量和规则权重计算置信度
                base_confidence = min(len(all_matches) * 0.2, 1.0)
                confidence = base_confidence * rule.confidence_weight
            
            result = RuleMatchResult(
                matched_intent=rule.intent_code if all_matches else None,
                matches=all_matches,
                confidence=confidence,
                rule_name=rule.description,
                match_type=MatchType.REGEX_MATCH,
                processing_time=processing_time,
                metadata={
                    "rule_priority": rule.priority,
                    "patterns_count": len(rule.patterns),
                    "matches_count": len(all_matches),
                    "total_groups": sum(len(m.groups) for m in all_matches)
                }
            )
            
            if all_matches:  # 只返回有匹配的结果
                results.append(result)
        
        # 按置信度和优先级排序
        results.sort(key=lambda x: (-x.confidence, -x.metadata.get("rule_priority", 0)))
        
        return results
    
    def validate_patterns(self, patterns: List[str]) -> ValidationResult:
        """验证正则表达式模式
        
        Args:
            patterns: 正则表达式模式列表
            
        Returns:
            验证结果
        """
        errors = []
        warnings = []
        suggestions = []
        
        for i, pattern in enumerate(patterns):
            if not pattern:
                errors.append(f"模式 {i}: 空模式")
                continue
            
            # 尝试编译模式
            try:
                compiled = re.compile(pattern, self.regex_flags)
                
                # 检查模式复杂度
                if len(pattern) > 200:
                    warnings.append(f"模式 {i}: 模式过长，可能影响性能")
                
                # 检查常见问题
                if '.*.*' in pattern:
                    suggestions.append(f"模式 {i}: 包含多个贪婪量词，建议优化")
                
                if pattern.count('(') != pattern.count(')'):
                    errors.append(f"模式 {i}: 括号不匹配")
                
                # 测试模式是否过于宽泛
                test_strings = ["a", "1", " ", ""]
                matches_all = all(compiled.search(s) for s in test_strings)
                if matches_all:
                    warnings.append(f"模式 {i}: 模式过于宽泛，可能产生误匹配")
                
            except re.error as e:
                errors.append(f"模式 {i}: 正则语法错误 - {str(e)}")
        
        is_valid = len(errors) == 0
        confidence = 1.0 if is_valid else max(0.0, 1.0 - len(errors) / len(patterns))
        
        return ValidationResult(
            is_valid=is_valid,
            confidence=confidence,
            errors=errors,
            warnings=warnings,
            suggestions=suggestions,
            metadata={
                "total_patterns": len(patterns),
                "valid_patterns": len(patterns) - len([e for e in errors if "语法错误" in e])
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
        
        for i, rule in enumerate(rules):
            # 检查必要字段
            if not rule.intent_code:
                errors.append(f"规则 {i}: 缺少意图编码")
            
            if not rule.patterns:
                warnings.append(f"规则 {i}: 没有定义匹配模式")
                continue
            
            # 验证正则模式
            pattern_validation = self.validate_patterns(rule.patterns)
            if not pattern_validation.is_valid:
                for error in pattern_validation.errors:
                    errors.append(f"规则 {i}, {error}")
            
            for warning in pattern_validation.warnings:
                warnings.append(f"规则 {i}, {warning}")
            
            for suggestion in pattern_validation.suggestions:
                suggestions.append(f"规则 {i}, {suggestion}")
        
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
    
    def clear_cache(self):
        """清空模式缓存"""
        self._pattern_cache.clear()
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """获取缓存统计信息"""
        return {
            "cache_size": len(self._pattern_cache),
            "max_cache_size": self.max_cache_size,
            "cache_enabled": self.cache_patterns,
            "cached_patterns": list(self._pattern_cache.keys())
        }
    
    def _run(self, **kwargs) -> Dict[str, Any]:
        """
        BaseTool要求的抽象方法实现
        """
        return self.execute(**kwargs)
    
    def execute(self, 
                text: str, 
                rules: Optional[List[RuleConfig]] = None,
                rule_config: Optional[Dict[str, Any]] = None,
                extract_entities: bool = False,
                entity_type: str = "ENTITY",
                **kwargs) -> Dict[str, Any]:
        """执行正则匹配
        
        Args:
            text: 待匹配文本
            rules: 规则配置列表
            rule_config: 规则配置字典
            extract_entities: 是否提取实体
            entity_type: 实体类型
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
                        description=config.get("description", f"Regex rule for {intent_code}"),
                        match_strategy=MatchType.REGEX_MATCH,
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
            
            # 提取实体（如果需要）
            entities = []
            if extract_entities and results:
                for result in results:
                    for match in result.matches:
                        entity_data = self.extract_entities(text, match.pattern, entity_type)
                        entities.extend(entity_data)
            
            processing_time = time.time() - start_time
            
            return {
                "success": True,
                "data": {
                    "matches": [result.dict() for result in results],
                    "total_matches": len(results),
                    "best_match": results[0].dict() if results else None,
                    "entities": entities if extract_entities else None
                },
                "metadata": {
                    "processing_time": processing_time,
                    "rules_count": len(rules),
                    "validation": validation.dict(),
                    "cache_stats": self.get_cache_stats()
                }
            }
            
        except Exception as e:
            return {
                "success": False,
                "data": None,
                "error": f"正则匹配执行失败: {str(e)}",
                "metadata": {
                    "processing_time": time.time() - start_time if 'start_time' in locals() else 0.0
                }
            }