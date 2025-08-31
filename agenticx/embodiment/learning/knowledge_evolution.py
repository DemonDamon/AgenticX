"""知识演化管理器

负责管理和演化GUI自动化中的知识库，包括知识冲突解决、知识验证和知识更新。
"""

import time
import logging
from typing import Dict, List, Optional, Any, Tuple, Set, Union
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
import json
import hashlib

from .models import (
    Experience, Pattern, KnowledgeConflict, ConflictType, Resolution,
    KnowledgeItem, ValidationResult, EFSM, ReflectionResult, AppContext
)
from agenticx.embodiment.core.models import GUIAction, ScreenState
from agenticx.embodiment.core.agent import GUITask, ActionResult


class EvolutionStrategy(Enum):
    """演化策略枚举"""
    INCREMENTAL = "incremental"
    REVOLUTIONARY = "revolutionary"
    CONSERVATIVE = "conservative"
    AGGRESSIVE = "aggressive"
    ADAPTIVE = "adaptive"


class KnowledgeType(Enum):
    """知识类型枚举"""
    PROCEDURAL = "procedural"
    DECLARATIVE = "declarative"
    EXPERIENTIAL = "experiential"
    CONTEXTUAL = "contextual"
    PATTERN = "pattern"


class ValidationLevel(Enum):
    """验证级别枚举"""
    BASIC = "basic"
    INTERMEDIATE = "intermediate"
    COMPREHENSIVE = "comprehensive"
    EXPERT = "expert"


@dataclass
class EvolutionMetrics:
    """演化指标"""
    knowledge_growth_rate: float
    conflict_resolution_rate: float
    validation_success_rate: float
    knowledge_utilization_rate: float
    evolution_efficiency: float
    metadata: Dict[str, Any]


@dataclass
class KnowledgeUpdate:
    """知识更新"""
    update_id: str
    knowledge_item: KnowledgeItem
    update_type: str  # add, modify, delete, merge
    reason: str
    confidence: float
    timestamp: float
    metadata: Dict[str, Any]
    
    def __post_init__(self):
        if not self.update_id:
            self.update_id = hashlib.md5(f"{self.knowledge_item.item_id}_{self.timestamp}".encode()).hexdigest()[:16]


class KnowledgeEvolution(ABC):
    """知识演化管理器抽象基类"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化知识演化管理器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.logger = logging.getLogger(self.__class__.__name__)
        self._knowledge_base: Dict[str, KnowledgeItem] = {}
        self._experiences: Dict[str, Experience] = {}
        self._patterns: Dict[str, Pattern] = {}
        self._conflicts: Dict[str, KnowledgeConflict] = {}
        self._evolution_history: List[KnowledgeUpdate] = []
        self._validation_cache: Dict[str, ValidationResult] = {}
        
    @abstractmethod
    def evolve_knowledge(self, new_experiences: List[Experience]) -> EvolutionMetrics:
        """演化知识库
        
        Args:
            new_experiences: 新的经验列表
            
        Returns:
            EvolutionMetrics: 演化指标
        """
        pass
    
    @abstractmethod
    def resolve_conflicts(self, conflicts: List[KnowledgeConflict]) -> List[Resolution]:
        """解决知识冲突
        
        Args:
            conflicts: 知识冲突列表
            
        Returns:
            List[Resolution]: 解决方案列表
        """
        pass
    
    @abstractmethod
    def validate_knowledge(self, knowledge_items: List[KnowledgeItem],
                          validation_level: ValidationLevel = ValidationLevel.BASIC) -> List[ValidationResult]:
        """验证知识
        
        Args:
            knowledge_items: 知识项列表
            validation_level: 验证级别
            
        Returns:
            List[ValidationResult]: 验证结果列表
        """
        pass
    
    @abstractmethod
    def reflect_on_performance(self, execution_history: List[Dict[str, Any]]) -> ReflectionResult:
        """性能反思
        
        Args:
            execution_history: 执行历史
            
        Returns:
            ReflectionResult: 反思结果
        """
        pass
    
    @abstractmethod
    def generate_efsm(self, experiences: List[Experience]) -> EFSM:
        """生成扩展有限状态机
        
        Args:
            experiences: 经验列表
            
        Returns:
            EFSM: 扩展有限状态机
        """
        pass
    
    def get_knowledge_statistics(self) -> Dict[str, Any]:
        """获取知识统计信息"""
        return {
            'knowledge_items_count': len(self._knowledge_base),
            'experiences_count': len(self._experiences),
            'patterns_count': len(self._patterns),
            'conflicts_count': len(self._conflicts),
            'evolution_history_count': len(self._evolution_history)
        }


class DefaultKnowledgeEvolution(KnowledgeEvolution):
    """默认知识演化管理器实现"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化默认知识演化管理器"""
        super().__init__(config)
        self.evolution_strategy = EvolutionStrategy(self.config.get('evolution_strategy', 'adaptive'))
        self.conflict_threshold = self.config.get('conflict_threshold', 0.7)
        self.validation_threshold = self.config.get('validation_threshold', 0.8)
        self.knowledge_retention_period = self.config.get('knowledge_retention_period', 86400 * 30)  # 30天
        self.max_knowledge_items = self.config.get('max_knowledge_items', 10000)
        self.learning_rate = self.config.get('learning_rate', 0.1)
        
    def evolve_knowledge(self, new_experiences: List[Experience]) -> EvolutionMetrics:
        """演化知识库"""
        try:
            start_time = time.time()
            initial_knowledge_count = len(self._knowledge_base)
            
            # 处理新经验
            processed_experiences = self._process_new_experiences(new_experiences)
            
            # 提取知识
            extracted_knowledge = self._extract_knowledge_from_experiences(processed_experiences)
            
            # 检测冲突
            conflicts = self._detect_knowledge_conflicts(extracted_knowledge)
            
            # 解决冲突
            resolutions = self.resolve_conflicts(conflicts)
            
            # 更新知识库
            updates = self._update_knowledge_base(extracted_knowledge, resolutions)
            
            # 优化知识库
            self._optimize_knowledge_base()
            
            # 计算演化指标
            final_knowledge_count = len(self._knowledge_base)
            knowledge_growth_rate = (final_knowledge_count - initial_knowledge_count) / max(1, initial_knowledge_count)
            conflict_resolution_rate = len(resolutions) / max(1, len(conflicts)) if conflicts else 1.0
            
            # 验证更新的知识
            validation_results = self.validate_knowledge([update.knowledge_item for update in updates])
            validation_success_rate = sum(1 for result in validation_results if result.is_valid) / max(1, len(validation_results))
            
            # 计算知识利用率
            knowledge_utilization_rate = self._calculate_knowledge_utilization_rate()
            
            # 计算演化效率
            evolution_time = time.time() - start_time
            evolution_efficiency = len(updates) / max(1, evolution_time)
            
            metrics = EvolutionMetrics(
                knowledge_growth_rate=knowledge_growth_rate,
                conflict_resolution_rate=conflict_resolution_rate,
                validation_success_rate=validation_success_rate,
                knowledge_utilization_rate=knowledge_utilization_rate,
                evolution_efficiency=evolution_efficiency,
                metadata={
                    'initial_knowledge_count': initial_knowledge_count,
                    'final_knowledge_count': final_knowledge_count,
                    'new_experiences_count': len(new_experiences),
                    'conflicts_detected': len(conflicts),
                    'conflicts_resolved': len(resolutions),
                    'updates_applied': len(updates),
                    'evolution_time': evolution_time
                }
            )
            
            self.logger.info(f"知识演化完成，增长率: {knowledge_growth_rate:.2%}，冲突解决率: {conflict_resolution_rate:.2%}")
            return metrics
            
        except Exception as e:
            self.logger.error(f"知识演化失败: {e}")
            return EvolutionMetrics(
                knowledge_growth_rate=0.0,
                conflict_resolution_rate=0.0,
                validation_success_rate=0.0,
                knowledge_utilization_rate=0.0,
                evolution_efficiency=0.0,
                metadata={'error': str(e)}
            )
    
    def resolve_conflicts(self, conflicts: List[KnowledgeConflict]) -> List[Resolution]:
        """解决知识冲突"""
        try:
            resolutions = []
            
            for conflict in conflicts:
                resolution = self._resolve_single_conflict(conflict)
                if resolution:
                    resolutions.append(resolution)
                    self._conflicts[conflict.conflict_id] = conflict
            
            self.logger.info(f"解决了 {len(resolutions)} 个知识冲突")
            return resolutions
            
        except Exception as e:
            self.logger.error(f"冲突解决失败: {e}")
            return []
    
    def validate_knowledge(self, knowledge_items: List[KnowledgeItem],
                          validation_level: ValidationLevel = ValidationLevel.BASIC) -> List[ValidationResult]:
        """验证知识"""
        try:
            results = []
            
            for item in knowledge_items:
                # 检查缓存
                cache_key = f"{item.item_id}_{validation_level.value}"
                if cache_key in self._validation_cache:
                    cached_result = self._validation_cache[cache_key]
                    # 检查缓存是否过期（1小时）
                    if time.time() - cached_result.validation_time < 3600:
                        results.append(cached_result)
                        continue
                
                # 执行验证
                result = self._validate_single_knowledge_item(item, validation_level)
                results.append(result)
                
                # 缓存结果
                self._validation_cache[cache_key] = result
            
            # 清理过期缓存
            self._cleanup_validation_cache()
            
            valid_count = sum(1 for result in results if result.is_valid)
            self.logger.info(f"验证了 {len(results)} 个知识项，{valid_count} 个有效")
            return results
            
        except Exception as e:
            self.logger.error(f"知识验证失败: {e}")
            return []
    
    def reflect_on_performance(self, execution_history: List[Dict[str, Any]]) -> ReflectionResult:
        """性能反思"""
        try:
            # 分析执行历史
            performance_metrics = self._analyze_execution_performance(execution_history)
            
            # 识别改进机会
            improvement_opportunities = self._identify_improvement_opportunities(execution_history)
            
            # 生成学习建议
            learning_recommendations = self._generate_learning_recommendations(performance_metrics, improvement_opportunities)
            
            # 识别知识缺口
            knowledge_gaps = self._identify_knowledge_gaps(execution_history)
            
            # 评估知识质量
            knowledge_quality_assessment = self._assess_knowledge_quality()
            
            result = ReflectionResult(
                reflection_id="",  # 将在__post_init__中生成
                task_id="performance_reflection",
                reflection_type="performance",
                insights=["Performance analysis completed"],
                lessons_learned=["Knowledge base optimization needed"],
                improvement_suggestions=improvement_opportunities,
                confidence=0.8,
                impact_assessment=performance_metrics,
                metadata={
                    'execution_history_count': len(execution_history),
                    'knowledge_base_size': len(self._knowledge_base)
                }
            )
            
            self.logger.info(f"性能反思完成，识别了 {len(improvement_opportunities)} 个改进机会")
            return result
            
        except Exception as e:
            self.logger.error(f"性能反思失败: {e}")
            return ReflectionResult(
                reflection_id="",
                task_id="performance_reflection_error",
                reflection_type="error",
                insights=[],
                lessons_learned=[],
                improvement_suggestions=[],
                confidence=0.0,
                impact_assessment={},
                metadata={'error': str(e)}
            )
    
    def generate_efsm(self, experiences: List[Experience]) -> EFSM:
        """生成扩展有限状态机"""
        try:
            # 提取状态
            states = self._extract_states_from_experiences(experiences)
            
            # 提取转换
            transitions = self._extract_transitions_from_experiences(experiences)
            
            # 提取动作
            actions = self._extract_actions_from_experiences(experiences)
            
            # 提取条件
            conditions = self._extract_conditions_from_experiences(experiences)
            
            # 识别初始状态
            initial_state = self._identify_initial_state(states, experiences)
            
            # 识别最终状态
            final_states = self._identify_final_states(states, experiences)
            
            efsm = EFSM(
                fsm_id="",  # 将在__post_init__中生成
                name="Experience_EFSM",
                states=states,
                transitions=transitions,
                initial_state=initial_state,
                final_states=final_states,
                actions=actions,
                metadata={
                    'experience_count': len(experiences),
                    'generation_time': time.time()
                }
            )
            
            self.logger.info(f"生成了包含 {len(states)} 个状态和 {len(transitions)} 个转换的EFSM")
            return efsm
            
        except Exception as e:
            self.logger.error(f"EFSM生成失败: {e}")
            return EFSM(
                fsm_id="",
                name="Error_EFSM",
                states=[],
                transitions={},
                initial_state="",
                final_states=[],
                actions={},
                metadata={'error': str(e)}
            )
    
    def _process_new_experiences(self, experiences: List[Experience]) -> List[Experience]:
        """处理新经验"""
        processed = []
        
        for experience in experiences:
            # 去重
            if experience.experience_id not in self._experiences:
                # 标准化经验
                normalized_experience = self._normalize_experience(experience)
                processed.append(normalized_experience)
                self._experiences[experience.experience_id] = normalized_experience
        
        return processed
    
    def _extract_knowledge_from_experiences(self, experiences: List[Experience]) -> List[KnowledgeItem]:
        """从经验中提取知识"""
        knowledge_items = []
        
        for experience in experiences:
            # 提取程序性知识
            procedural_knowledge = self._extract_procedural_knowledge(experience)
            knowledge_items.extend(procedural_knowledge)
            
            # 提取声明性知识
            declarative_knowledge = self._extract_declarative_knowledge(experience)
            knowledge_items.extend(declarative_knowledge)
            
            # 提取经验性知识
            experiential_knowledge = self._extract_experiential_knowledge(experience)
            knowledge_items.extend(experiential_knowledge)
            
            # 提取上下文知识
            contextual_knowledge = self._extract_contextual_knowledge(experience)
            knowledge_items.extend(contextual_knowledge)
        
        return knowledge_items
    
    def _detect_knowledge_conflicts(self, knowledge_items: List[KnowledgeItem]) -> List[KnowledgeConflict]:
        """检测知识冲突"""
        conflicts = []
        
        # 检查与现有知识的冲突
        for new_item in knowledge_items:
            for existing_id, existing_item in self._knowledge_base.items():
                conflict = self._check_knowledge_conflict(new_item, existing_item)
                if conflict:
                    conflicts.append(conflict)
        
        # 检查新知识之间的冲突
        for i, item1 in enumerate(knowledge_items):
            for j, item2 in enumerate(knowledge_items[i+1:], i+1):
                conflict = self._check_knowledge_conflict(item1, item2)
                if conflict:
                    conflicts.append(conflict)
        
        return conflicts
    
    def _update_knowledge_base(self, knowledge_items: List[KnowledgeItem], 
                              resolutions: List[Resolution]) -> List[KnowledgeUpdate]:
        """更新知识库"""
        updates = []
        
        # 应用冲突解决方案
        resolved_items = self._apply_conflict_resolutions(knowledge_items, resolutions)
        
        # 更新知识库
        for item in resolved_items:
            if item.item_id in self._knowledge_base:
                # 合并或更新现有知识
                merged_item = self._merge_knowledge_items(self._knowledge_base[item.item_id], item)
                self._knowledge_base[item.item_id] = merged_item
                
                update = KnowledgeUpdate(
                    update_id="",
                    knowledge_item=merged_item,
                    update_type="modify",
                    reason="Knowledge merge",
                    confidence=merged_item.confidence,
                    created_at=time.time(),
                    metadata={'original_item_id': item.item_id}
                )
                updates.append(update)
            else:
                # 添加新知识
                self._knowledge_base[item.item_id] = item
                
                update = KnowledgeUpdate(
                    update_id="",
                    knowledge_item=item,
                    update_type="add",
                    reason="New knowledge",
                    confidence=item.confidence,
                    created_at=time.time(),
                    metadata={'new_item': True}
                )
                updates.append(update)
        
        # 记录更新历史
        self._evolution_history.extend(updates)
        
        return updates
    
    def _optimize_knowledge_base(self):
        """优化知识库"""
        # 清理过期知识
        self._cleanup_expired_knowledge()
        
        # 合并相似知识
        self._merge_similar_knowledge()
        
        # 限制知识库大小
        self._limit_knowledge_base_size()
    
    def _calculate_knowledge_utilization_rate(self) -> float:
        """计算知识利用率"""
        if not self._knowledge_base:
            return 0.0
        
        # 统计最近使用的知识
        recent_threshold = time.time() - 86400 * 7  # 7天内
        recently_used = sum(
            1 for item in self._knowledge_base.values()
            if item.last_used and item.last_used > recent_threshold
        )
        
        return recently_used / len(self._knowledge_base)
    
    def _resolve_single_conflict(self, conflict: KnowledgeConflict) -> Optional[Resolution]:
        """解决单个知识冲突"""
        try:
            resolution_strategy = self._select_resolution_strategy(conflict)
            
            if resolution_strategy == "merge":
                return self._create_merge_resolution(conflict)
            elif resolution_strategy == "prefer_new":
                return self._create_prefer_new_resolution(conflict)
            elif resolution_strategy == "prefer_existing":
                return self._create_prefer_existing_resolution(conflict)
            elif resolution_strategy == "context_dependent":
                return self._create_context_dependent_resolution(conflict)
            else:
                return self._create_default_resolution(conflict)
                
        except Exception as e:
            self.logger.error(f"单个冲突解决失败: {e}")
            return None
    
    def _validate_single_knowledge_item(self, item: KnowledgeItem, 
                                       validation_level: ValidationLevel) -> ValidationResult:
        """验证单个知识项"""
        try:
            validation_checks = []
            
            # 基本验证
            if validation_level.value in ['basic', 'intermediate', 'comprehensive', 'expert']:
                validation_checks.extend(self._perform_basic_validation(item))
            
            # 中级验证
            if validation_level.value in ['intermediate', 'comprehensive', 'expert']:
                validation_checks.extend(self._perform_intermediate_validation(item))
            
            # 全面验证
            if validation_level.value in ['comprehensive', 'expert']:
                validation_checks.extend(self._perform_comprehensive_validation(item))
            
            # 专家验证
            if validation_level.value == 'expert':
                validation_checks.extend(self._perform_expert_validation(item))
            
            # 计算验证结果
            passed_checks = sum(1 for check in validation_checks if check['passed'])
            total_checks = len(validation_checks)
            confidence = passed_checks / max(1, total_checks)
            is_valid = confidence >= self.validation_threshold
            
            result = ValidationResult(
                validation_id="",  # 将在__post_init__中生成
                knowledge_item_id=item.item_id,
                is_valid=is_valid,
                confidence=confidence,
                validation_level=validation_level.value,
                issues=[check['issue'] for check in validation_checks if not check['passed']],
                recommendations=[check.get('recommendation', '') for check in validation_checks if not check['passed']],
                validation_time=time.time(),
                metadata={
                    'total_checks': total_checks,
                    'passed_checks': passed_checks,
                    'validation_details': validation_checks
                }
            )
            
            return result
            
        except Exception as e:
            self.logger.error(f"知识项验证失败: {e}")
            return ValidationResult(
                validation_id="",
                knowledge_item_id=item.item_id,
                is_valid=False,
                confidence=0.0,
                validation_level=validation_level.value,
                issues=[f"Validation error: {e}"],
                recommendations=["Review knowledge item structure"],
                validation_time=time.time(),
                metadata={'error': str(e)}
            )
    
    def _analyze_execution_performance(self, execution_history: List[Dict[str, Any]]) -> Dict[str, Any]:
        """分析执行性能"""
        if not execution_history:
            return {}
        
        # 计算基本指标
        total_executions = len(execution_history)
        successful_executions = sum(1 for exec in execution_history if exec.get('success', False))
        success_rate = successful_executions / total_executions
        
        # 计算平均执行时间
        execution_times = [exec.get('execution_time', 0) for exec in execution_history if exec.get('execution_time')]
        avg_execution_time = sum(execution_times) / len(execution_times) if execution_times else 0
        
        # 分析错误类型
        error_types = {}
        for exec in execution_history:
            if not exec.get('success', False) and exec.get('error_type'):
                error_type = exec['error_type']
                error_types[error_type] = error_types.get(error_type, 0) + 1
        
        return {
            'total_executions': total_executions,
            'success_rate': success_rate,
            'avg_execution_time': avg_execution_time,
            'error_types': error_types,
            'performance_trend': self._calculate_performance_trend(execution_history)
        }
    
    def _identify_improvement_opportunities(self, execution_history: List[Dict[str, Any]]) -> List[str]:
        """识别改进机会"""
        opportunities = []
        
        # 分析失败模式
        failures = [exec for exec in execution_history if not exec.get('success', False)]
        if len(failures) > len(execution_history) * 0.2:  # 失败率超过20%
            opportunities.append("High failure rate detected - review error handling strategies")
        
        # 分析性能问题
        execution_times = [exec.get('execution_time', 0) for exec in execution_history if exec.get('execution_time')]
        if execution_times:
            avg_time = sum(execution_times) / len(execution_times)
            slow_executions = [t for t in execution_times if t > avg_time * 2]
            if len(slow_executions) > len(execution_times) * 0.1:  # 超过10%的执行过慢
                opportunities.append("Performance optimization needed - many slow executions detected")
        
        # 分析知识覆盖
        if len(self._knowledge_base) < 100:  # 知识库较小
            opportunities.append("Expand knowledge base - current coverage may be insufficient")
        
        return opportunities
    
    def _generate_learning_recommendations(self, performance_metrics: Dict[str, Any], 
                                         opportunities: List[str]) -> List[str]:
        """生成学习建议"""
        recommendations = []
        
        success_rate = performance_metrics.get('success_rate', 0)
        if success_rate < 0.8:
            recommendations.append("Focus on improving success rate through better error handling")
        
        avg_time = performance_metrics.get('avg_execution_time', 0)
        if avg_time > 30:  # 超过30秒
            recommendations.append("Optimize execution speed through better action planning")
        
        error_types = performance_metrics.get('error_types', {})
        if error_types:
            most_common_error = max(error_types.items(), key=lambda x: x[1])[0]
            recommendations.append(f"Address most common error type: {most_common_error}")
        
        return recommendations
    
    def _identify_knowledge_gaps(self, execution_history: List[Dict[str, Any]]) -> List[str]:
        """识别知识缺口"""
        gaps = []
        
        # 分析未覆盖的场景
        unique_contexts = set()
        for exec in execution_history:
            context = exec.get('context', {})
            if context:
                context_key = json.dumps(context, sort_keys=True)
                unique_contexts.add(context_key)
        
        # 检查知识库覆盖
        covered_contexts = set()
        for item in self._knowledge_base.values():
            if item.context:
                context_key = json.dumps(item.context, sort_keys=True)
                covered_contexts.add(context_key)
        
        uncovered_contexts = unique_contexts - covered_contexts
        if uncovered_contexts:
            gaps.append(f"Missing knowledge for {len(uncovered_contexts)} execution contexts")
        
        return gaps
    
    def _assess_knowledge_quality(self) -> Dict[str, Any]:
        """评估知识质量"""
        if not self._knowledge_base:
            return {'overall_quality': 0.0}
        
        # 计算平均置信度
        avg_confidence = sum(item.confidence for item in self._knowledge_base.values()) / len(self._knowledge_base)
        
        # 计算知识新鲜度
        current_time = time.time()
        recent_threshold = current_time - 86400 * 7  # 7天
        recent_knowledge = sum(
            1 for item in self._knowledge_base.values()
            if item.creation_time > recent_threshold
        )
        freshness = recent_knowledge / len(self._knowledge_base)
        
        # 计算知识多样性
        knowledge_types = set(item.knowledge_type for item in self._knowledge_base.values())
        diversity = len(knowledge_types) / 5  # 假设有5种知识类型
        
        overall_quality = (avg_confidence * 0.4 + freshness * 0.3 + diversity * 0.3)
        
        return {
            'overall_quality': overall_quality,
            'avg_confidence': avg_confidence,
            'freshness': freshness,
            'diversity': diversity,
            'total_items': len(self._knowledge_base)
        }
    
    def _extract_states_from_experiences(self, experiences: List[Experience]) -> List[str]:
        """从经验中提取状态"""
        states = set()
        
        for experience in experiences:
            if experience.context:
                # 从上下文中提取状态信息
                state_info = experience.context.get('state', {})
                if isinstance(state_info, dict):
                    state_id = json.dumps(state_info, sort_keys=True)
                    states.add(state_id)
        
        return list(states)
    
    def _extract_transitions_from_experiences(self, experiences: List[Experience]) -> List[Dict[str, Any]]:
        """从经验中提取转换"""
        transitions = []
        
        for experience in experiences:
            if experience.outcome and experience.context:
                transition = {
                    'from_state': json.dumps(experience.context.get('initial_state', {}), sort_keys=True),
                    'to_state': json.dumps(experience.outcome.get('final_state', {}), sort_keys=True),
                    'action': experience.outcome.get('action', ''),
                    'condition': experience.context.get('condition', '')
                }
                transitions.append(transition)
        
        return transitions
    
    def _extract_actions_from_experiences(self, experiences: List[Experience]) -> List[str]:
        """从经验中提取动作"""
        actions = set()
        
        for experience in experiences:
            if experience.outcome:
                action = experience.outcome.get('action', '')
                if action:
                    actions.add(action)
        
        return list(actions)
    
    def _extract_conditions_from_experiences(self, experiences: List[Experience]) -> List[str]:
        """从经验中提取条件"""
        conditions = set()
        
        for experience in experiences:
            if experience.context:
                condition = experience.context.get('condition', '')
                if condition:
                    conditions.add(condition)
        
        return list(conditions)
    
    def _identify_initial_state(self, states: List[str], experiences: List[Experience]) -> str:
        """识别初始状态"""
        if not states:
            return ""
        
        # 简单实现：返回第一个状态
        return states[0] if states else ""
    
    def _identify_final_states(self, states: List[str], experiences: List[Experience]) -> List[str]:
        """识别最终状态"""
        final_states = set()
        
        for experience in experiences:
            if experience.outcome and experience.outcome.get('success', False):
                final_state = json.dumps(experience.outcome.get('final_state', {}), sort_keys=True)
                if final_state in states:
                    final_states.add(final_state)
        
        return list(final_states)
    
    def _normalize_experience(self, experience: Experience) -> Experience:
        """标准化经验"""
        # 简单的标准化实现
        return experience
    
    def _extract_procedural_knowledge(self, experience: Experience) -> List[KnowledgeItem]:
        """提取程序性知识"""
        knowledge_items = []
        
        if experience.outcome and experience.outcome.get('action_sequence'):
            item = KnowledgeItem(
                item_id="",  # 将在__post_init__中生成
                knowledge_type=KnowledgeType.PROCEDURAL.value,
                content={
                    'action_sequence': experience.outcome['action_sequence'],
                    'context': experience.context
                },
                confidence=experience.confidence,
                context=experience.context,
                creation_time=time.time(),
                last_used=time.time(),
                usage_count=1,
                metadata={'source_experience_id': experience.experience_id}
            )
            knowledge_items.append(item)
        
        return knowledge_items
    
    def _extract_declarative_knowledge(self, experience: Experience) -> List[KnowledgeItem]:
        """提取声明性知识"""
        knowledge_items = []
        
        if experience.context:
            item = KnowledgeItem(
                item_id="",  # 将在__post_init__中生成
                knowledge_type=KnowledgeType.DECLARATIVE.value,
                content={
                    'facts': experience.context,
                    'domain': experience.context.get('domain', 'general')
                },
                confidence=experience.confidence,
                context=experience.context,
                creation_time=time.time(),
                last_used=time.time(),
                usage_count=1,
                metadata={'source_experience_id': experience.experience_id}
            )
            knowledge_items.append(item)
        
        return knowledge_items
    
    def _extract_experiential_knowledge(self, experience: Experience) -> List[KnowledgeItem]:
        """提取经验性知识"""
        knowledge_items = []
        
        item = KnowledgeItem(
            item_id="",  # 将在__post_init__中生成
            knowledge_type=KnowledgeType.EXPERIENTIAL.value,
            content={
                'experience': experience.to_dict(),
                'lessons_learned': experience.outcome.get('lessons_learned', []) if experience.outcome else []
            },
            confidence=experience.confidence,
            context=experience.context,
            creation_time=time.time(),
            last_used=time.time(),
            usage_count=1,
            metadata={'source_experience_id': experience.experience_id}
        )
        knowledge_items.append(item)
        
        return knowledge_items
    
    def _extract_contextual_knowledge(self, experience: Experience) -> List[KnowledgeItem]:
        """提取上下文知识"""
        knowledge_items = []
        
        if experience.context:
            item = KnowledgeItem(
                item_id="",  # 将在__post_init__中生成
                knowledge_type=KnowledgeType.CONTEXTUAL.value,
                content={
                    'context_patterns': experience.context,
                    'applicability': experience.outcome.get('applicability', {}) if experience.outcome else {}
                },
                confidence=experience.confidence,
                context=experience.context,
                creation_time=time.time(),
                last_used=time.time(),
                usage_count=1,
                metadata={'source_experience_id': experience.experience_id}
            )
            knowledge_items.append(item)
        
        return knowledge_items
    
    def _check_knowledge_conflict(self, item1: KnowledgeItem, item2: KnowledgeItem) -> Optional[KnowledgeConflict]:
        """检查知识冲突"""
        # 检查是否为相同类型的知识
        if item1.knowledge_type != item2.knowledge_type:
            return None
        
        # 检查上下文相似性
        context_similarity = self._calculate_context_similarity(item1.context, item2.context)
        
        if context_similarity > 0.8:  # 上下文高度相似
            # 检查内容冲突
            content_conflict = self._detect_content_conflict(item1.content, item2.content)
            
            if content_conflict:
                conflict = KnowledgeConflict(
                    conflict_id="",  # 将在__post_init__中生成
                    conflicting_items=[item1.item_id, item2.item_id],
                    conflict_type=ConflictType.CONTRADICTORY,
                    description=f"Content conflict between {item1.item_id} and {item2.item_id}",
                    severity=abs(item1.confidence - item2.confidence),
                    detection_time=time.time(),
                    metadata={
                        'context_similarity': context_similarity,
                        'content_conflict_details': content_conflict
                    }
                )
                return conflict
        
        return None
    
    def _apply_conflict_resolutions(self, knowledge_items: List[KnowledgeItem], 
                                   resolutions: List[Resolution]) -> List[KnowledgeItem]:
        """应用冲突解决方案"""
        resolved_items = knowledge_items.copy()
        
        for resolution in resolutions:
            if resolution.resolution_type == "merge":
                resolved_items = self._apply_merge_resolution(resolved_items, resolution)
            elif resolution.resolution_type == "prefer_new":
                resolved_items = self._apply_prefer_new_resolution(resolved_items, resolution)
            elif resolution.resolution_type == "prefer_existing":
                resolved_items = self._apply_prefer_existing_resolution(resolved_items, resolution)
        
        return resolved_items
    
    def _merge_knowledge_items(self, existing_item: KnowledgeItem, new_item: KnowledgeItem) -> KnowledgeItem:
        """合并知识项"""
        # 合并内容
        merged_content = existing_item.content.copy()
        merged_content.update(new_item.content)
        
        # 计算新的置信度
        merged_confidence = (existing_item.confidence * existing_item.usage_count + 
                           new_item.confidence * new_item.usage_count) / \
                          (existing_item.usage_count + new_item.usage_count)
        
        # 合并上下文
        merged_context = existing_item.context.copy() if existing_item.context else {}
        if new_item.context:
            merged_context.update(new_item.context)
        
        merged_item = KnowledgeItem(
            item_id=existing_item.item_id,
            knowledge_type=existing_item.knowledge_type,
            content=merged_content,
            confidence=merged_confidence,
            context=merged_context,
            creation_time=existing_item.creation_time,
            last_used=max(existing_item.last_used or 0, new_item.last_used or 0),
            usage_count=existing_item.usage_count + new_item.usage_count,
            metadata={
                'merged_from': [existing_item.item_id, new_item.item_id],
                'merge_time': time.time()
            }
        )
        
        return merged_item
    
    def _cleanup_expired_knowledge(self):
        """清理过期知识"""
        current_time = time.time()
        expired_threshold = current_time - self.knowledge_retention_period
        
        expired_items = [
            item_id for item_id, item in self._knowledge_base.items()
            if item.last_used and item.last_used < expired_threshold
        ]
        
        for item_id in expired_items:
            del self._knowledge_base[item_id]
        
        if expired_items:
            self.logger.info(f"清理了 {len(expired_items)} 个过期知识项")
    
    def _merge_similar_knowledge(self):
        """合并相似知识"""
        # 简化实现：基于内容相似性合并
        items_to_merge = []
        processed_items = set()
        
        for item1_id, item1 in self._knowledge_base.items():
            if item1_id in processed_items:
                continue
                
            similar_items = [item1]
            for item2_id, item2 in self._knowledge_base.items():
                if item2_id != item1_id and item2_id not in processed_items:
                    similarity = self._calculate_knowledge_similarity(item1, item2)
                    if similarity > 0.9:  # 高度相似
                        similar_items.append(item2)
                        processed_items.add(item2_id)
            
            if len(similar_items) > 1:
                items_to_merge.append(similar_items)
                processed_items.add(item1_id)
        
        # 执行合并
        for similar_group in items_to_merge:
            merged_item = similar_group[0]
            for item in similar_group[1:]:
                merged_item = self._merge_knowledge_items(merged_item, item)
                if item.item_id in self._knowledge_base:
                    del self._knowledge_base[item.item_id]
            
            self._knowledge_base[merged_item.item_id] = merged_item
    
    def _limit_knowledge_base_size(self):
        """限制知识库大小"""
        if len(self._knowledge_base) <= self.max_knowledge_items:
            return
        
        # 按使用频率和置信度排序
        sorted_items = sorted(
            self._knowledge_base.items(),
            key=lambda x: (x[1].usage_count * x[1].confidence, x[1].last_used or 0),
            reverse=True
        )
        
        # 保留前N个项目
        items_to_keep = dict(sorted_items[:self.max_knowledge_items])
        removed_count = len(self._knowledge_base) - len(items_to_keep)
        
        self._knowledge_base = items_to_keep
        
        if removed_count > 0:
            self.logger.info(f"移除了 {removed_count} 个低价值知识项以限制知识库大小")
    
    def _cleanup_validation_cache(self):
        """清理验证缓存"""
        current_time = time.time()
        cache_expiry = 3600  # 1小时
        
        expired_keys = [
            key for key, result in self._validation_cache.items()
            if current_time - result.validation_time > cache_expiry
        ]
        
        for key in expired_keys:
            del self._validation_cache[key]
    
    def _select_resolution_strategy(self, conflict: KnowledgeConflict) -> str:
        """选择解决策略"""
        if conflict.conflict_type == ConflictType.CONTRADICTORY:
            return "merge"
        elif conflict.conflict_type == ConflictType.CONFIDENCE_DISCREPANCY:
            return "prefer_new" if conflict.severity > 0.5 else "prefer_existing"
        else:
            return "context_dependent"
    
    def _create_merge_resolution(self, conflict: KnowledgeConflict) -> Resolution:
        """创建合并解决方案"""
        return Resolution(
            resolution_id="",  # 将在__post_init__中生成
            conflict_id=conflict.conflict_id,
            resolution_type="merge",
            description="Merge conflicting knowledge items",
            confidence=0.8,
            metadata={'strategy': 'merge'}
        )
    
    def _create_prefer_new_resolution(self, conflict: KnowledgeConflict) -> Resolution:
        """创建偏好新知识解决方案"""
        return Resolution(
            resolution_id="",  # 将在__post_init__中生成
            conflict_id=conflict.conflict_id,
            resolution_type="prefer_new",
            description="Prefer newer knowledge item",
            confidence=0.7,
            metadata={'strategy': 'prefer_new'}
        )
    
    def _create_prefer_existing_resolution(self, conflict: KnowledgeConflict) -> Resolution:
        """创建偏好现有知识解决方案"""
        return Resolution(
            resolution_id="",  # 将在__post_init__中生成
            conflict_id=conflict.conflict_id,
            resolution_type="prefer_existing",
            description="Prefer existing knowledge item",
            confidence=0.6,
            metadata={'strategy': 'prefer_existing'}
        )
    
    def _create_context_dependent_resolution(self, conflict: KnowledgeConflict) -> Resolution:
        """创建上下文相关解决方案"""
        return Resolution(
            resolution_id="",  # 将在__post_init__中生成
            conflict_id=conflict.conflict_id,
            resolution_type="context_dependent",
            description="Use context-dependent resolution",
            confidence=0.9,
            metadata={'strategy': 'context_dependent'}
        )
    
    def _create_default_resolution(self, conflict: KnowledgeConflict) -> Resolution:
        """创建默认解决方案"""
        return Resolution(
            resolution_id="",  # 将在__post_init__中生成
            conflict_id=conflict.conflict_id,
            resolution_type="default",
            description="Apply default resolution strategy",
            confidence=0.5,
            metadata={'strategy': 'default'}
        )
    
    def _perform_basic_validation(self, item: KnowledgeItem) -> List[Dict[str, Any]]:
        """执行基本验证"""
        checks = []
        
        # 检查必要字段
        checks.append({
            'name': 'required_fields',
            'passed': bool(item.item_id and item.knowledge_type and item.content),
            'issue': 'Missing required fields' if not (item.item_id and item.knowledge_type and item.content) else None
        })
        
        # 检查置信度范围
        checks.append({
            'name': 'confidence_range',
            'passed': 0.0 <= item.confidence <= 1.0,
            'issue': 'Confidence out of range [0,1]' if not (0.0 <= item.confidence <= 1.0) else None
        })
        
        return checks
    
    def _perform_intermediate_validation(self, item: KnowledgeItem) -> List[Dict[str, Any]]:
        """执行中级验证"""
        checks = []
        
        # 检查内容结构
        checks.append({
            'name': 'content_structure',
            'passed': isinstance(item.content, dict) and len(item.content) > 0,
            'issue': 'Invalid content structure' if not (isinstance(item.content, dict) and len(item.content) > 0) else None
        })
        
        # 检查使用统计
        checks.append({
            'name': 'usage_statistics',
            'passed': item.usage_count >= 0,
            'issue': 'Invalid usage count' if item.usage_count < 0 else None
        })
        
        return checks
    
    def _perform_comprehensive_validation(self, item: KnowledgeItem) -> List[Dict[str, Any]]:
        """执行全面验证"""
        checks = []
        
        # 检查时间戳
        current_time = time.time()
        checks.append({
            'name': 'timestamp_validity',
            'passed': item.creation_time <= current_time,
            'issue': 'Future creation time' if item.creation_time > current_time else None
        })
        
        # 检查上下文一致性
        if item.context:
            checks.append({
                'name': 'context_consistency',
                'passed': isinstance(item.context, dict),
                'issue': 'Invalid context format' if not isinstance(item.context, dict) else None
            })
        
        return checks
    
    def _perform_expert_validation(self, item: KnowledgeItem) -> List[Dict[str, Any]]:
        """执行专家验证"""
        checks = []
        
        # 检查知识类型一致性
        expected_content_keys = self._get_expected_content_keys(item.knowledge_type)
        actual_content_keys = set(item.content.keys()) if isinstance(item.content, dict) else set()
        
        checks.append({
            'name': 'knowledge_type_consistency',
            'passed': bool(expected_content_keys.intersection(actual_content_keys)),
            'issue': f'Content does not match knowledge type {item.knowledge_type}' if not expected_content_keys.intersection(actual_content_keys) else None
        })
        
        return checks
    
    def _get_expected_content_keys(self, knowledge_type: str) -> Set[str]:
        """获取预期的内容键"""
        type_mapping = {
            KnowledgeType.PROCEDURAL.value: {'action_sequence', 'steps', 'procedure'},
            KnowledgeType.DECLARATIVE.value: {'facts', 'rules', 'concepts'},
            KnowledgeType.EXPERIENTIAL.value: {'experience', 'lessons_learned', 'outcomes'},
            KnowledgeType.CONTEXTUAL.value: {'context_patterns', 'applicability', 'conditions'},
            KnowledgeType.PATTERN.value: {'pattern', 'structure', 'examples'}
        }
        
        return type_mapping.get(knowledge_type, set())
    
    def _calculate_performance_trend(self, execution_history: List[Dict[str, Any]]) -> str:
        """计算性能趋势"""
        if len(execution_history) < 2:
            return "insufficient_data"
        
        # 简单的趋势分析：比较前半部分和后半部分的成功率
        mid_point = len(execution_history) // 2
        first_half = execution_history[:mid_point]
        second_half = execution_history[mid_point:]
        
        first_half_success_rate = sum(1 for exec in first_half if exec.get('success', False)) / len(first_half)
        second_half_success_rate = sum(1 for exec in second_half if exec.get('success', False)) / len(second_half)
        
        if second_half_success_rate > first_half_success_rate + 0.1:
            return "improving"
        elif second_half_success_rate < first_half_success_rate - 0.1:
            return "declining"
        else:
            return "stable"
    
    def _calculate_context_similarity(self, context1: Optional[Dict[str, Any]], 
                                     context2: Optional[Dict[str, Any]]) -> float:
        """计算上下文相似性"""
        if not context1 or not context2:
            return 0.0
        
        # 简单的相似性计算：共同键的比例
        keys1 = set(context1.keys())
        keys2 = set(context2.keys())
        
        if not keys1 and not keys2:
            return 1.0
        
        common_keys = keys1.intersection(keys2)
        total_keys = keys1.union(keys2)
        
        return len(common_keys) / len(total_keys) if total_keys else 0.0
    
    def _detect_content_conflict(self, content1: Dict[str, Any], content2: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """检测内容冲突"""
        conflicts = {}
        
        for key in content1.keys():
            if key in content2:
                if content1[key] != content2[key]:
                    conflicts[key] = {
                        'value1': content1[key],
                        'value2': content2[key]
                    }
        
        return conflicts if conflicts else None
    
    def _apply_merge_resolution(self, items: List[KnowledgeItem], resolution: Resolution) -> List[KnowledgeItem]:
        """应用合并解决方案"""
        # 简化实现
        return items
    
    def _apply_prefer_new_resolution(self, items: List[KnowledgeItem], resolution: Resolution) -> List[KnowledgeItem]:
        """应用偏好新知识解决方案"""
        # 简化实现
        return items
    
    def _apply_prefer_existing_resolution(self, items: List[KnowledgeItem], resolution: Resolution) -> List[KnowledgeItem]:
        """应用偏好现有知识解决方案"""
        # 简化实现
        return items
    
    def _calculate_knowledge_similarity(self, item1: KnowledgeItem, item2: KnowledgeItem) -> float:
        """计算知识相似性"""
        # 简单的相似性计算
        if item1.knowledge_type != item2.knowledge_type:
            return 0.0
        
        context_similarity = self._calculate_context_similarity(item1.context, item2.context)
        
        # 内容相似性（简化）
        content_similarity = 0.5  # 简化实现
        
        return (context_similarity + content_similarity) / 2.0