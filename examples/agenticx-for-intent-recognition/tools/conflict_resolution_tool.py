"""冲突解决工具

实现多源结果冲突解决，支持优先级和权重策略，集成冲突检测算法。
"""

import logging
import time
from typing import Dict, List, Any, Optional, Tuple, Union
from agenticx.tools import BaseTool
from agenticx.tools.intelligence.models import ToolResult
from pydantic import BaseModel, Field
from collections import defaultdict

from .post_processing_models import (
    ConflictInfo,
    ConflictType,
    ConflictResolutionResult,
    PostProcessingConfig,
    ProcessingStatus
)


class ConflictResolutionInput(BaseModel):
    """冲突解决输入模型"""
    
    results: List[Dict[str, Any]] = Field(description="多个结果源")
    resolution_strategy: Optional[str] = Field(default=None, description="解决策略")
    priority_weights: Optional[Dict[str, float]] = Field(default=None, description="优先级权重")
    config: Optional[Dict[str, Any]] = Field(default=None, description="配置参数")


class ConflictResolutionTool(BaseTool):
    """冲突解决工具
    
    检测和解决多个意图识别结果之间的冲突，支持：
    - 意图不匹配冲突检测和解决
    - 实体重叠冲突处理
    - 置信度冲突协调
    - 规则违反冲突修复
    - 多种解决策略（优先级、权重、投票等）
    """
    
    def __init__(self, config: Optional[PostProcessingConfig] = None):
        super().__init__(
            name="conflict_resolution",
            description="检测和解决多源意图识别结果之间的冲突，确保输出一致性",
            args_schema=ConflictResolutionInput
        )
        
        self.config = config or PostProcessingConfig()
        self.logger = logging.getLogger(__name__)
        
        # 冲突检测规则
        self._conflict_detection_rules = self._initialize_conflict_detection_rules()
        
        # 解决策略
        self._resolution_strategies = self._initialize_resolution_strategies()
        
        # 默认优先级权重
        self._default_priority_weights = {
            "llm_result": 0.4,
            "rule_result": 0.3,
            "hybrid_result": 0.3
        }
    
    def _initialize_conflict_detection_rules(self) -> Dict[str, Any]:
        """初始化冲突检测规则"""
        return {
            # 意图冲突检测阈值
            "intent_mismatch_threshold": 0.1,  # 置信度差异阈值
            
            # 实体重叠检测参数
            "entity_overlap_threshold": 0.5,   # 重叠度阈值
            "entity_boundary_tolerance": 2,    # 边界容忍度（字符数）
            
            # 置信度冲突检测
            "confidence_conflict_threshold": 0.3,  # 置信度差异阈值
            
            # 规则违反检测
            "rule_violation_patterns": [
                "intent_entity_mismatch",
                "confidence_threshold_violation",
                "entity_format_violation"
            ]
        }
    
    def _initialize_resolution_strategies(self) -> Dict[str, Any]:
        """初始化解决策略"""
        return {
            "priority_based": {
                "description": "基于优先级权重的解决策略",
                "method": self._resolve_by_priority
            },
            "confidence_based": {
                "description": "基于置信度的解决策略",
                "method": self._resolve_by_confidence
            },
            "voting_based": {
                "description": "基于投票的解决策略",
                "method": self._resolve_by_voting
            },
            "hybrid": {
                "description": "混合解决策略",
                "method": self._resolve_by_hybrid
            },
            "consensus": {
                "description": "一致性解决策略",
                "method": self._resolve_by_consensus
            }
        }
    
    def _run(self, **kwargs) -> ToolResult:
        """BaseTool要求的抽象方法实现"""
        if 'input_data' in kwargs:
            input_data = kwargs['input_data']
        else:
            input_data = ConflictResolutionInput(**kwargs)
        return self.execute(input_data)
    
    def execute(self, input_data: ConflictResolutionInput) -> ToolResult:
        """执行冲突解决"""
        try:
            start_time = time.time()
            
            # 执行冲突解决
            resolution_result = self._resolve_conflicts(
                results=input_data.results,
                resolution_strategy=input_data.resolution_strategy or self.config.conflict_resolution_strategy,
                priority_weights=input_data.priority_weights or self._default_priority_weights,
                config=input_data.config or {}
            )
            
            processing_time = time.time() - start_time
            
            # 记录日志
            if self.config.enable_logging:
                self.logger.info(
                    f"冲突解决完成: 检测到{resolution_result.total_conflicts}个冲突, "
                    f"解决了{resolution_result.resolved_count}个 "
                    f"(耗时: {processing_time:.3f}s)"
                )
            
            return ToolResult(
                tool_name="conflict_resolution",
                success=True,
                execution_time=processing_time,
                result_data={
                    "data": resolution_result.dict(),
                    "metadata": {
                        "processing_time": processing_time
                    }
                },
                error_message=None
            )
            
        except Exception as e:
            self.logger.error(f"冲突解决失败: {str(e)}")
            return ToolResult(
                tool_name="conflict_resolution",
                success=False,
                execution_time=0.0,
                result_data=None,
                error_message=f"冲突解决失败: {str(e)}"
            )
    
    def _resolve_conflicts(
        self,
        results: List[Dict[str, Any]],
        resolution_strategy: str,
        priority_weights: Dict[str, float],
        config: Dict[str, Any]
    ) -> ConflictResolutionResult:
        """执行冲突解决逻辑"""
        
        # 1. 检测冲突
        conflicts_detected = self._detect_conflicts(results)
        
        # 2. 解决冲突
        conflicts_resolved = []
        conflicts_unresolved = []
        
        strategy_method = self._resolution_strategies.get(
            resolution_strategy, {}
        ).get("method")
        
        if not strategy_method:
            raise ValueError(f"未知的解决策略: {resolution_strategy}")
        
        for conflict in conflicts_detected:
            try:
                resolved_conflict = strategy_method(
                    conflict, results, priority_weights, config
                )
                if resolved_conflict.resolved:
                    conflicts_resolved.append(resolved_conflict)
                else:
                    conflicts_unresolved.append(resolved_conflict)
            except Exception as e:
                self.logger.warning(f"解决冲突失败: {str(e)}")
                conflict.metadata["resolution_error"] = str(e)
                conflicts_unresolved.append(conflict)
        
        # 3. 生成最终结果
        final_result = self._generate_final_result(
            results, conflicts_resolved, resolution_strategy, priority_weights
        )
        
        # 4. 计算统计信息
        total_conflicts = len(conflicts_detected)
        resolved_count = len(conflicts_resolved)
        resolution_rate = resolved_count / total_conflicts if total_conflicts > 0 else 1.0
        
        return ConflictResolutionResult(
            conflicts_detected=conflicts_detected,
            conflicts_resolved=conflicts_resolved,
            conflicts_unresolved=conflicts_unresolved,
            total_conflicts=total_conflicts,
            resolved_count=resolved_count,
            resolution_rate=resolution_rate,
            final_result=final_result,
            metadata={
                "strategy_used": resolution_strategy,
                "priority_weights": priority_weights,
                "timestamp": time.time()
            }
        )
    
    def _detect_conflicts(self, results: List[Dict[str, Any]]) -> List[ConflictInfo]:
        """检测结果之间的冲突"""
        
        conflicts = []
        
        # 两两比较检测冲突
        for i in range(len(results)):
            for j in range(i + 1, len(results)):
                result_a = results[i]
                result_b = results[j]
                
                # 检测意图冲突
                intent_conflicts = self._detect_intent_conflicts(result_a, result_b)
                conflicts.extend(intent_conflicts)
                
                # 检测实体冲突
                entity_conflicts = self._detect_entity_conflicts(result_a, result_b)
                conflicts.extend(entity_conflicts)
                
                # 检测置信度冲突
                confidence_conflicts = self._detect_confidence_conflicts(result_a, result_b)
                conflicts.extend(confidence_conflicts)
        
        # 检测规则违反
        rule_conflicts = self._detect_rule_violations(results)
        conflicts.extend(rule_conflicts)
        
        return conflicts
    
    def _detect_intent_conflicts(
        self, result_a: Dict[str, Any], result_b: Dict[str, Any]
    ) -> List[ConflictInfo]:
        """检测意图冲突"""
        
        conflicts = []
        
        intent_a = result_a.get("intent")
        intent_b = result_b.get("intent")
        confidence_a = result_a.get("confidence", 0.0)
        confidence_b = result_b.get("confidence", 0.0)
        
        if intent_a != intent_b:
            # 计算冲突严重程度
            confidence_diff = abs(confidence_a - confidence_b)
            severity = min(1.0, confidence_diff / self._conflict_detection_rules["intent_mismatch_threshold"])
            
            conflict = ConflictInfo(
                conflict_type=ConflictType.INTENT_MISMATCH,
                description=f"意图不匹配: {intent_a} vs {intent_b}",
                source_a=result_a,
                source_b=result_b,
                severity=severity,
                metadata={
                    "intent_a": intent_a,
                    "intent_b": intent_b,
                    "confidence_a": confidence_a,
                    "confidence_b": confidence_b,
                    "confidence_diff": confidence_diff
                }
            )
            conflicts.append(conflict)
        
        return conflicts
    
    def _detect_entity_conflicts(
        self, result_a: Dict[str, Any], result_b: Dict[str, Any]
    ) -> List[ConflictInfo]:
        """检测实体冲突"""
        
        conflicts = []
        
        entities_a = result_a.get("entities", [])
        entities_b = result_b.get("entities", [])
        
        # 检测实体重叠
        for entity_a in entities_a:
            for entity_b in entities_b:
                overlap_ratio = self._calculate_entity_overlap(entity_a, entity_b)
                
                if overlap_ratio > self._conflict_detection_rules["entity_overlap_threshold"]:
                    # 检查是否为同一实体的不同识别结果
                    if entity_a.get("type") != entity_b.get("type"):
                        conflict = ConflictInfo(
                            conflict_type=ConflictType.ENTITY_OVERLAP,
                            description=f"实体重叠但类型不同: {entity_a.get('type')} vs {entity_b.get('type')}",
                            source_a=result_a,
                            source_b=result_b,
                            severity=overlap_ratio,
                            metadata={
                                "entity_a": entity_a,
                                "entity_b": entity_b,
                                "overlap_ratio": overlap_ratio
                            }
                        )
                        conflicts.append(conflict)
        
        return conflicts
    
    def _detect_confidence_conflicts(
        self, result_a: Dict[str, Any], result_b: Dict[str, Any]
    ) -> List[ConflictInfo]:
        """检测置信度冲突"""
        
        conflicts = []
        
        confidence_a = result_a.get("confidence", 0.0)
        confidence_b = result_b.get("confidence", 0.0)
        confidence_diff = abs(confidence_a - confidence_b)
        
        if confidence_diff > self._conflict_detection_rules["confidence_conflict_threshold"]:
            conflict = ConflictInfo(
                conflict_type=ConflictType.CONFIDENCE_CONFLICT,
                description=f"置信度差异过大: {confidence_a:.3f} vs {confidence_b:.3f}",
                source_a=result_a,
                source_b=result_b,
                severity=confidence_diff,
                metadata={
                    "confidence_a": confidence_a,
                    "confidence_b": confidence_b,
                    "confidence_diff": confidence_diff
                }
            )
            conflicts.append(conflict)
        
        return conflicts
    
    def _detect_rule_violations(self, results: List[Dict[str, Any]]) -> List[ConflictInfo]:
        """检测规则违反"""
        
        conflicts = []
        
        for result in results:
            # 检查意图-实体匹配规则
            intent = result.get("intent")
            entities = result.get("entities", [])
            
            if intent == "001" and not any(e.get("type") == "QUERY" for e in entities):
                conflict = ConflictInfo(
                    conflict_type=ConflictType.RULE_VIOLATION,
                    description="搜索意图缺少查询实体",
                    source_a=result,
                    source_b={},
                    severity=0.8,
                    metadata={
                        "rule": "search_intent_requires_query",
                        "intent": intent,
                        "entities": entities
                    }
                )
                conflicts.append(conflict)
            
            elif intent == "002" and not any(e.get("type") == "ACTION" for e in entities):
                conflict = ConflictInfo(
                    conflict_type=ConflictType.RULE_VIOLATION,
                    description="工具调用意图缺少动作实体",
                    source_a=result,
                    source_b={},
                    severity=0.8,
                    metadata={
                        "rule": "function_intent_requires_action",
                        "intent": intent,
                        "entities": entities
                    }
                )
                conflicts.append(conflict)
        
        return conflicts
    
    def _calculate_entity_overlap(
        self, entity_a: Dict[str, Any], entity_b: Dict[str, Any]
    ) -> float:
        """计算实体重叠度"""
        
        start_a = entity_a.get("start", 0)
        end_a = entity_a.get("end", 0)
        start_b = entity_b.get("start", 0)
        end_b = entity_b.get("end", 0)
        
        # 计算重叠区间
        overlap_start = max(start_a, start_b)
        overlap_end = min(end_a, end_b)
        
        if overlap_start >= overlap_end:
            return 0.0
        
        # 计算重叠长度
        overlap_length = overlap_end - overlap_start
        total_length = max(end_a - start_a, end_b - start_b)
        
        return overlap_length / total_length if total_length > 0 else 0.0
    
    def _resolve_by_priority(
        self, conflict: ConflictInfo, results: List[Dict[str, Any]], 
        priority_weights: Dict[str, float], config: Dict[str, Any]
    ) -> ConflictInfo:
        """基于优先级权重解决冲突"""
        
        source_a = conflict.source_a
        source_b = conflict.source_b
        
        # 获取源的权重
        weight_a = priority_weights.get(source_a.get("source", "unknown"), 0.0)
        weight_b = priority_weights.get(source_b.get("source", "unknown"), 0.0)
        
        if weight_a > weight_b:
            conflict.resolution_strategy = f"选择源A(权重{weight_a})"
            conflict.resolved = True
        elif weight_b > weight_a:
            conflict.resolution_strategy = f"选择源B(权重{weight_b})"
            conflict.resolved = True
        else:
            conflict.resolution_strategy = "权重相等，无法解决"
            conflict.resolved = False
        
        return conflict
    
    def _resolve_by_confidence(
        self, conflict: ConflictInfo, results: List[Dict[str, Any]], 
        priority_weights: Dict[str, float], config: Dict[str, Any]
    ) -> ConflictInfo:
        """基于置信度解决冲突"""
        
        source_a = conflict.source_a
        source_b = conflict.source_b
        
        confidence_a = source_a.get("confidence", 0.0)
        confidence_b = source_b.get("confidence", 0.0)
        
        if confidence_a > confidence_b:
            conflict.resolution_strategy = f"选择高置信度源A({confidence_a:.3f})"
            conflict.resolved = True
        elif confidence_b > confidence_a:
            conflict.resolution_strategy = f"选择高置信度源B({confidence_b:.3f})"
            conflict.resolved = True
        else:
            conflict.resolution_strategy = "置信度相等，无法解决"
            conflict.resolved = False
        
        return conflict
    
    def _resolve_by_voting(
        self, conflict: ConflictInfo, results: List[Dict[str, Any]], 
        priority_weights: Dict[str, float], config: Dict[str, Any]
    ) -> ConflictInfo:
        """基于投票解决冲突"""
        
        if conflict.conflict_type == ConflictType.INTENT_MISMATCH:
            # 统计意图投票
            intent_votes = defaultdict(int)
            for result in results:
                intent = result.get("intent")
                if intent:
                    intent_votes[intent] += 1
            
            if intent_votes:
                winning_intent = max(intent_votes.items(), key=lambda x: x[1])
                conflict.resolution_strategy = f"投票选择意图{winning_intent[0]}({winning_intent[1]}票)"
                conflict.resolved = True
            else:
                conflict.resolution_strategy = "无有效投票"
                conflict.resolved = False
        else:
            conflict.resolution_strategy = "投票策略不适用于此冲突类型"
            conflict.resolved = False
        
        return conflict
    
    def _resolve_by_hybrid(
        self, conflict: ConflictInfo, results: List[Dict[str, Any]], 
        priority_weights: Dict[str, float], config: Dict[str, Any]
    ) -> ConflictInfo:
        """混合策略解决冲突"""
        
        # 先尝试置信度策略
        confidence_resolved = self._resolve_by_confidence(
            conflict, results, priority_weights, config
        )
        
        if confidence_resolved.resolved:
            confidence_resolved.resolution_strategy += " (混合策略-置信度)"
            return confidence_resolved
        
        # 再尝试优先级策略
        priority_resolved = self._resolve_by_priority(
            conflict, results, priority_weights, config
        )
        
        if priority_resolved.resolved:
            priority_resolved.resolution_strategy += " (混合策略-优先级)"
            return priority_resolved
        
        # 最后尝试投票策略
        voting_resolved = self._resolve_by_voting(
            conflict, results, priority_weights, config
        )
        
        if voting_resolved.resolved:
            voting_resolved.resolution_strategy += " (混合策略-投票)"
            return voting_resolved
        
        conflict.resolution_strategy = "混合策略无法解决"
        conflict.resolved = False
        return conflict
    
    def _resolve_by_consensus(
        self, conflict: ConflictInfo, results: List[Dict[str, Any]], 
        priority_weights: Dict[str, float], config: Dict[str, Any]
    ) -> ConflictInfo:
        """一致性策略解决冲突"""
        
        # 寻找一致性结果
        if conflict.conflict_type == ConflictType.INTENT_MISMATCH:
            intents = [r.get("intent") for r in results if r.get("intent")]
            intent_counts = defaultdict(int)
            for intent in intents:
                intent_counts[intent] += 1
            
            # 检查是否有绝对多数
            total_results = len(results)
            for intent, count in intent_counts.items():
                if count > total_results / 2:
                    conflict.resolution_strategy = f"一致性选择意图{intent}(占{count}/{total_results})"
                    conflict.resolved = True
                    return conflict
        
        conflict.resolution_strategy = "无法达成一致性"
        conflict.resolved = False
        return conflict
    
    def _generate_final_result(
        self, results: List[Dict[str, Any]], resolved_conflicts: List[ConflictInfo],
        strategy: str, priority_weights: Dict[str, float]
    ) -> Dict[str, Any]:
        """生成最终结果"""
        
        if not results:
            return {}
        
        # 基于策略选择最终结果
        if strategy == "priority_based":
            # 选择权重最高的结果
            best_result = max(
                results, 
                key=lambda r: priority_weights.get(r.get("source", "unknown"), 0.0)
            )
        elif strategy == "confidence_based":
            # 选择置信度最高的结果
            best_result = max(results, key=lambda r: r.get("confidence", 0.0))
        else:
            # 默认选择第一个结果
            best_result = results[0]
        
        # 应用冲突解决的修改
        final_result = best_result.copy()
        final_result["conflict_resolution"] = {
            "strategy_used": strategy,
            "conflicts_resolved": len(resolved_conflicts),
            "resolution_applied": True
        }
        
        return final_result
    
    def get_conflict_statistics(self) -> Dict[str, Any]:
        """获取冲突统计信息"""
        return {
            "conflict_detection_rules": self._conflict_detection_rules,
            "resolution_strategies": {k: v["description"] for k, v in self._resolution_strategies.items()},
            "default_priority_weights": self._default_priority_weights,
            "config": self.config.to_dict()
        }