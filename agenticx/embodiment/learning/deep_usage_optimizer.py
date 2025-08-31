"""深度使用优化器

负责分析用户的深度使用模式，优化任务执行效率和用户体验。
"""

import time
import logging
from typing import Dict, List, Optional, Any, Tuple, Set
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
import statistics

from .models import (
    EfficiencyPattern, ExecutionTrace, Workflow, Pattern, PatternType,
    AppContext, UIPattern, ActionTrace, ComplexTask
)
from agenticx.embodiment.core.models import GUIAction, ScreenState
from agenticx.embodiment.core.agent import GUITask, ActionResult


class OptimizationStrategy(Enum):
    """优化策略枚举"""
    EFFICIENCY_FOCUSED = "efficiency_focused"
    USER_EXPERIENCE = "user_experience"
    RESOURCE_OPTIMIZATION = "resource_optimization"
    ADAPTIVE = "adaptive"


class OptimizationLevel(Enum):
    """优化级别枚举"""
    BASIC = "basic"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"
    EXPERT = "expert"


@dataclass
class OptimizationResult:
    """优化结果"""
    optimized_workflows: List[Workflow]
    efficiency_patterns: List[EfficiencyPattern]
    performance_improvements: Dict[str, float]
    resource_savings: Dict[str, float]
    user_experience_score: float
    metadata: Dict[str, Any]


@dataclass
class UsageAnalysis:
    """使用分析结果"""
    frequent_patterns: List[Pattern]
    bottlenecks: List[Dict[str, Any]]
    optimization_opportunities: List[Dict[str, Any]]
    user_preferences: Dict[str, Any]
    efficiency_metrics: Dict[str, float]
    metadata: Dict[str, Any]


class DeepUsageOptimizer(ABC):
    """深度使用优化器抽象基类"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化深度使用优化器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.logger = logging.getLogger(self.__class__.__name__)
        self._efficiency_patterns: Dict[str, EfficiencyPattern] = {}
        self._optimization_history: List[OptimizationResult] = []
        self._usage_analytics: Dict[str, Any] = {}
        
    @abstractmethod
    def analyze_usage_patterns(self, execution_traces: List[ExecutionTrace],
                             context: Optional[AppContext] = None) -> UsageAnalysis:
        """分析使用模式
        
        Args:
            execution_traces: 执行轨迹列表
            context: 应用上下文
            
        Returns:
            UsageAnalysis: 使用分析结果
        """
        pass
    
    @abstractmethod
    def optimize_workflows(self, workflows: List[Workflow],
                         strategy: OptimizationStrategy = OptimizationStrategy.ADAPTIVE) -> OptimizationResult:
        """优化工作流
        
        Args:
            workflows: 工作流列表
            strategy: 优化策略
            
        Returns:
            OptimizationResult: 优化结果
        """
        pass
    
    @abstractmethod
    def identify_efficiency_patterns(self, traces: List[ExecutionTrace]) -> List[EfficiencyPattern]:
        """识别效率模式
        
        Args:
            traces: 执行轨迹列表
            
        Returns:
            List[EfficiencyPattern]: 效率模式列表
        """
        pass
    
    @abstractmethod
    def optimize_resource_usage(self, workflows: List[Workflow]) -> List[Workflow]:
        """优化资源使用
        
        Args:
            workflows: 工作流列表
            
        Returns:
            List[Workflow]: 优化后的工作流列表
        """
        pass
    
    @abstractmethod
    def predict_performance_improvements(self, optimizations: List[Dict[str, Any]]) -> Dict[str, float]:
        """预测性能改进
        
        Args:
            optimizations: 优化方案列表
            
        Returns:
            Dict[str, float]: 性能改进预测
        """
        pass
    
    def get_optimization_statistics(self) -> Dict[str, Any]:
        """获取优化统计信息"""
        return {
            'efficiency_patterns_count': len(self._efficiency_patterns),
            'optimization_history_count': len(self._optimization_history),
            'total_optimizations': sum(1 for result in self._optimization_history if result.optimized_workflows)
        }


class DefaultDeepUsageOptimizer(DeepUsageOptimizer):
    """默认深度使用优化器实现"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化默认深度使用优化器"""
        super().__init__(config)
        self.min_pattern_frequency = self.config.get('min_pattern_frequency', 5)
        self.optimization_threshold = self.config.get('optimization_threshold', 0.1)
        self.max_optimization_iterations = self.config.get('max_optimization_iterations', 3)
        self.resource_weight = self.config.get('resource_weight', 0.3)
        self.efficiency_weight = self.config.get('efficiency_weight', 0.4)
        self.ux_weight = self.config.get('ux_weight', 0.3)
        
    def analyze_usage_patterns(self, execution_traces: List[ExecutionTrace],
                             context: Optional[AppContext] = None) -> UsageAnalysis:
        """分析使用模式"""
        try:
            # 识别频繁模式
            frequent_patterns = self._identify_frequent_patterns(execution_traces)
            
            # 识别瓶颈
            bottlenecks = self._identify_bottlenecks(execution_traces)
            
            # 识别优化机会
            optimization_opportunities = self._identify_optimization_opportunities(execution_traces)
            
            # 分析用户偏好
            user_preferences = self._analyze_user_preferences(execution_traces, context)
            
            # 计算效率指标
            efficiency_metrics = self._calculate_efficiency_metrics(execution_traces)
            
            analysis = UsageAnalysis(
                frequent_patterns=frequent_patterns,
                bottlenecks=bottlenecks,
                optimization_opportunities=optimization_opportunities,
                user_preferences=user_preferences,
                efficiency_metrics=efficiency_metrics,
                metadata={
                    'trace_count': len(execution_traces),
                    'analysis_time': time.time(),
                    'context_id': context.context_id if context else None
                }
            )
            
            self.logger.info(f"分析了 {len(execution_traces)} 个执行轨迹")
            return analysis
            
        except Exception as e:
            self.logger.error(f"使用模式分析失败: {e}")
            return UsageAnalysis(
                frequent_patterns=[],
                bottlenecks=[],
                optimization_opportunities=[],
                user_preferences={},
                efficiency_metrics={},
                metadata={'error': str(e)}
            )
    
    def optimize_workflows(self, workflows: List[Workflow],
                         strategy: OptimizationStrategy = OptimizationStrategy.ADAPTIVE) -> OptimizationResult:
        """优化工作流"""
        try:
            optimized_workflows = []
            efficiency_patterns = []
            performance_improvements = {}
            resource_savings = {}
            
            for workflow in workflows:
                if strategy == OptimizationStrategy.EFFICIENCY_FOCUSED:
                    optimized = self._optimize_for_efficiency(workflow)
                elif strategy == OptimizationStrategy.USER_EXPERIENCE:
                    optimized = self._optimize_for_ux(workflow)
                elif strategy == OptimizationStrategy.RESOURCE_OPTIMIZATION:
                    optimized = self._optimize_for_resources(workflow)
                elif strategy == OptimizationStrategy.ADAPTIVE:
                    optimized = self._optimize_adaptive(workflow)
                else:
                    optimized = workflow
                
                optimized_workflows.append(optimized)
                
                # 计算改进指标
                improvements = self._calculate_improvements(workflow, optimized)
                performance_improvements[workflow.workflow_id] = improvements['performance']
                resource_savings[workflow.workflow_id] = improvements['resource']
            
            # 识别效率模式
            efficiency_patterns = self._extract_efficiency_patterns(optimized_workflows)
            
            # 计算用户体验分数
            ux_score = self._calculate_ux_score(optimized_workflows)
            
            result = OptimizationResult(
                optimized_workflows=optimized_workflows,
                efficiency_patterns=efficiency_patterns,
                performance_improvements=performance_improvements,
                resource_savings=resource_savings,
                user_experience_score=ux_score,
                metadata={
                    'strategy': strategy.value,
                    'original_workflow_count': len(workflows),
                    'optimization_time': time.time()
                }
            )
            
            self._optimization_history.append(result)
            self.logger.info(f"优化了 {len(workflows)} 个工作流")
            return result
            
        except Exception as e:
            self.logger.error(f"工作流优化失败: {e}")
            return OptimizationResult(
                optimized_workflows=workflows,
                efficiency_patterns=[],
                performance_improvements={},
                resource_savings={},
                user_experience_score=0.0,
                metadata={'error': str(e)}
            )
    
    def identify_efficiency_patterns(self, traces: List[ExecutionTrace]) -> List[EfficiencyPattern]:
        """识别效率模式"""
        try:
            patterns = []
            
            # 按执行时间分组
            time_groups = self._group_traces_by_execution_time(traces)
            
            for time_range, trace_group in time_groups.items():
                if len(trace_group) >= self.min_pattern_frequency:
                    pattern = self._create_efficiency_pattern(time_range, trace_group)
                    if pattern:
                        patterns.append(pattern)
                        self._efficiency_patterns[pattern.pattern_id] = pattern
            
            # 识别资源使用模式
            resource_patterns = self._identify_resource_patterns(traces)
            patterns.extend(resource_patterns)
            
            # 识别成功率模式
            success_patterns = self._identify_success_patterns(traces)
            patterns.extend(success_patterns)
            
            self.logger.info(f"识别了 {len(patterns)} 个效率模式")
            return patterns
            
        except Exception as e:
            self.logger.error(f"效率模式识别失败: {e}")
            return []
    
    def optimize_resource_usage(self, workflows: List[Workflow]) -> List[Workflow]:
        """优化资源使用"""
        try:
            optimized_workflows = []
            
            for workflow in workflows:
                optimized = self._optimize_workflow_resources(workflow)
                optimized_workflows.append(optimized)
            
            # 全局资源优化
            optimized_workflows = self._global_resource_optimization(optimized_workflows)
            
            self.logger.info(f"优化了 {len(workflows)} 个工作流的资源使用")
            return optimized_workflows
            
        except Exception as e:
            self.logger.error(f"资源使用优化失败: {e}")
            return workflows
    
    def predict_performance_improvements(self, current_metrics: Dict[str, float], optimization_plan: Dict[str, Any]) -> Dict[str, float]:
        """预测性能改进"""
        try:
            predictions = {}
            
            strategy = optimization_plan.get('strategy', 'unknown')
            confidence = optimization_plan.get('confidence', 0.5)
            current_success_rate = current_metrics.get('success_rate', 0.0)
            current_time = current_metrics.get('avg_time', 0.0)
            
            if strategy == 'parallel_execution':
                predictions['predicted_success_rate'] = min(1.0, current_success_rate + 0.1 * confidence)
                predictions['predicted_time_reduction'] = current_time * 0.3 * confidence
            elif strategy == 'caching':
                predictions['predicted_success_rate'] = min(1.0, current_success_rate + 0.05 * confidence)
                predictions['predicted_time_reduction'] = current_time * 0.5 * confidence
            else:
                predictions['predicted_success_rate'] = min(1.0, current_success_rate + 0.05 * confidence)
                predictions['predicted_time_reduction'] = current_time * 0.2 * confidence
            
            self.logger.info(f"预测了优化策略 {strategy} 的性能改进")
            return predictions
            
        except Exception as e:
            self.logger.error(f"性能改进预测失败: {e}")
            return {}
    
    def _identify_frequent_patterns(self, traces: List[ExecutionTrace]) -> List[Pattern]:
        """识别频繁模式"""
        patterns = []
        
        # 统计动作序列频率
        sequence_counts = {}
        for trace in traces:
            if trace.action_sequence:
                sequence = tuple(action.get('type', 'unknown') for action in trace.action_sequence)
                sequence_counts[sequence] = sequence_counts.get(sequence, 0) + 1
        
        # 创建频繁模式
        for sequence, count in sequence_counts.items():
            if count >= self.min_pattern_frequency:
                pattern = Pattern(
                    pattern_id="",  # 将在__post_init__中生成
                    pattern_type=PatternType.USAGE_PATTERN,
                    pattern_name=f"Frequent sequence: {' -> '.join(sequence[:3])}",
                    description=f"Sequence appears {count} times",
                    structure={'sequence': sequence, 'frequency': count},
                    examples=[{'count': count}],
                    frequency=count,
                    confidence=min(1.0, count / len(traces))
                )
                patterns.append(pattern)
        
        return patterns
    
    def _identify_bottlenecks(self, traces: List[ExecutionTrace]) -> List[Dict[str, Any]]:
        """识别瓶颈"""
        bottlenecks = []
        
        # 分析执行时间
        execution_times = []
        for trace in traces:
            if trace.start_time and trace.end_time:
                execution_time = trace.end_time - trace.start_time
                execution_times.append(execution_time)
        
        if execution_times:
            avg_time = statistics.mean(execution_times)
            threshold = avg_time * 1.5  # 超过平均时间50%视为瓶颈
            
            for trace in traces:
                if trace.start_time and trace.end_time:
                    execution_time = trace.end_time - trace.start_time
                    if execution_time > threshold:
                        bottleneck = {
                            'type': 'execution_time',
                            'trace_id': trace.trace_id,
                            'execution_time': execution_time,
                            'threshold': threshold,
                            'severity': min(1.0, execution_time / threshold - 1.0)
                    }
                    bottlenecks.append(bottleneck)
        
        # 分析资源使用
        for trace in traces:
            if trace.resource_usage:
                for resource, usage in trace.resource_usage.items():
                    if isinstance(usage, (int, float)) and usage > 0.8:  # 使用率超过80%
                        bottleneck = {
                            'type': 'resource_usage',
                            'trace_id': trace.trace_id,
                            'resource': resource,
                            'usage': usage,
                            'severity': usage - 0.8
                        }
                        bottlenecks.append(bottleneck)
        
        return bottlenecks
    
    def _identify_optimization_opportunities(self, traces: List[ExecutionTrace]) -> List[Dict[str, Any]]:
        """识别优化机会"""
        opportunities = []
        
        # 识别可并行化的操作
        parallel_opportunities = self._find_parallel_opportunities(traces)
        opportunities.extend(parallel_opportunities)
        
        # 识别缓存机会
        cache_opportunities = self._find_cache_opportunities(traces)
        opportunities.extend(cache_opportunities)
        
        # 识别简化机会
        simplification_opportunities = self._find_simplification_opportunities(traces)
        opportunities.extend(simplification_opportunities)
        
        return opportunities
    
    def _analyze_user_preferences(self, traces: List[ExecutionTrace], context: Optional[AppContext]) -> Dict[str, Any]:
        """分析用户偏好"""
        preferences = {
            'preferred_execution_time': 'fast',
            'preferred_interaction_style': 'minimal',
            'preferred_feedback_level': 'moderate'
        }
        
        if traces:
            # 分析执行时间偏好
            execution_times = []
            for t in traces:
                if t.start_time and t.end_time:
                    execution_times.append(t.end_time - t.start_time)
            
            if execution_times:
                avg_time = statistics.mean(execution_times)
                if avg_time < 5.0:
                    preferences['preferred_execution_time'] = 'very_fast'
                elif avg_time < 15.0:
                    preferences['preferred_execution_time'] = 'fast'
                elif avg_time < 30.0:
                    preferences['preferred_execution_time'] = 'moderate'
                else:
                    preferences['preferred_execution_time'] = 'slow'
            
            # 分析交互偏好
            total_actions = sum(len(t.action_sequence or []) for t in traces)
            if total_actions > 0:
                avg_actions = total_actions / len(traces)
                if avg_actions < 3:
                    preferences['preferred_interaction_style'] = 'minimal'
                elif avg_actions < 7:
                    preferences['preferred_interaction_style'] = 'moderate'
                else:
                    preferences['preferred_interaction_style'] = 'detailed'
        
        return preferences
    
    def _calculate_efficiency_metrics(self, traces: List[ExecutionTrace]) -> Dict[str, float]:
        """计算效率指标"""
        metrics = {}
        
        if not traces:
            return metrics
        
        # 平均执行时间
        execution_times = []
        for t in traces:
            if t.start_time and t.end_time:
                execution_times.append(t.end_time - t.start_time)
        
        if execution_times:
            metrics['avg_execution_time'] = statistics.mean(execution_times)
            metrics['min_execution_time'] = min(execution_times)
            metrics['max_execution_time'] = max(execution_times)
        
        # 成功率
        success_count = sum(1 for t in traces if t.success)
        metrics['success_rate'] = success_count / len(traces)
        
        # 平均动作数
        action_counts = [len(t.action_sequence or []) for t in traces]
        if action_counts:
            metrics['avg_action_count'] = statistics.mean(action_counts)
        
        # 资源效率
        resource_usages = []
        for trace in traces:
            if trace.resource_usage:
                avg_usage = statistics.mean([v for v in trace.resource_usage.values() if isinstance(v, (int, float))])
                resource_usages.append(avg_usage)
        
        if resource_usages:
            metrics['avg_resource_usage'] = statistics.mean(resource_usages)
        
        return metrics
    
    def _optimize_for_efficiency(self, workflow: Workflow) -> Workflow:
        """为效率优化工作流"""
        optimized_steps = []
        
        for step in workflow.steps:
            # 简化步骤
            optimized_step = self._simplify_step(step)
            optimized_steps.append(optimized_step)
        
        # 合并相似步骤
        optimized_steps = self._merge_similar_steps(optimized_steps)
        
        # 重新排序以提高效率
        optimized_steps = self._reorder_for_efficiency(optimized_steps)
        
        optimized_workflow = Workflow(
            workflow_id=workflow.workflow_id,
            name=f"{workflow.name} (Efficiency Optimized)",
            steps=optimized_steps,
            conditions=workflow.conditions,
            optimizations=workflow.optimizations + ['efficiency_optimization'],
            estimated_time=workflow.estimated_time * 0.8,  # 预期20%的时间节省
            success_rate=workflow.success_rate
        )
        
        return optimized_workflow
    
    def _optimize_for_ux(self, workflow: Workflow) -> Workflow:
        """为用户体验优化工作流"""
        optimized_steps = []
        
        for step in workflow.steps:
            # 添加用户反馈
            optimized_step = self._add_user_feedback(step)
            optimized_steps.append(optimized_step)
        
        # 添加进度指示
        optimized_steps = self._add_progress_indicators(optimized_steps)
        
        optimized_workflow = Workflow(
            workflow_id=workflow.workflow_id,
            name=f"{workflow.name} (UX Optimized)",
            steps=optimized_steps,
            conditions=workflow.conditions,
            optimizations=workflow.optimizations + ['ux_optimization'],
            estimated_time=workflow.estimated_time * 1.1,  # 可能稍微增加时间
            success_rate=workflow.success_rate * 1.05  # 提高成功率
        )
        
        return optimized_workflow
    
    def _optimize_for_resources(self, workflow: Workflow) -> Workflow:
        """为资源使用优化工作流"""
        optimized_steps = []
        
        for step in workflow.steps:
            # 优化资源使用
            optimized_step = self._optimize_step_resources(step)
            optimized_steps.append(optimized_step)
        
        # 添加资源池化
        optimized_steps = self._add_resource_pooling(optimized_steps)
        
        optimized_workflow = Workflow(
            workflow_id=workflow.workflow_id,
            name=f"{workflow.name} (Resource Optimized)",
            steps=optimized_steps,
            conditions=workflow.conditions,
            optimizations=workflow.optimizations + ['resource_optimization'],
            estimated_time=workflow.estimated_time,
            success_rate=workflow.success_rate
        )
        
        return optimized_workflow
    
    def _optimize_adaptive(self, workflow: Workflow) -> Workflow:
        """自适应优化工作流"""
        # 综合多种优化策略
        efficiency_optimized = self._optimize_for_efficiency(workflow)
        ux_optimized = self._optimize_for_ux(workflow)
        resource_optimized = self._optimize_for_resources(workflow)
        
        # 选择最佳优化
        best_workflow = self._select_best_optimization([
            efficiency_optimized, ux_optimized, resource_optimized
        ])
        
        best_workflow.name = f"{workflow.name} (Adaptive Optimized)"
        best_workflow.optimizations = workflow.optimizations + ['adaptive_optimization']
        
        return best_workflow
    
    def _select_best_optimization(self, workflows: List[Workflow]) -> Workflow:
        """选择最佳优化"""
        if not workflows:
            return workflows[0]
        
        # 简单的评分机制
        best_workflow = workflows[0]
        best_score = 0.0
        
        for workflow in workflows:
            score = (
                (1.0 / workflow.estimated_time) * self.efficiency_weight +
                workflow.success_rate * self.ux_weight +
                len(workflow.optimizations) * self.resource_weight
            )
            
            if score > best_score:
                best_score = score
                best_workflow = workflow
        
        return best_workflow
    
    def _calculate_improvements(self, original: Workflow, optimized: Workflow) -> Dict[str, float]:
        """计算改进指标"""
        improvements = {
            'performance': 0.0,
            'resource': 0.0
        }
        
        # 性能改进
        if original.estimated_time > 0:
            time_improvement = (original.estimated_time - optimized.estimated_time) / original.estimated_time
            improvements['performance'] = max(0.0, time_improvement)
        
        # 资源改进（基于优化数量）
        optimization_improvement = len(optimized.optimizations) - len(original.optimizations)
        improvements['resource'] = max(0.0, optimization_improvement * 0.1)
        
        return improvements
    
    def _extract_efficiency_patterns(self, workflows: List[Workflow]) -> List[EfficiencyPattern]:
        """提取效率模式"""
        patterns = []
        
        for workflow in workflows:
            if 'efficiency_optimization' in workflow.optimizations:
                pattern = EfficiencyPattern(
                    pattern_id="",  # 将在__post_init__中生成
                    pattern_name=f"Efficiency pattern for {workflow.name}",
                    optimization_techniques=['step_simplification', 'step_merging'],
                    performance_metrics={'estimated_time': workflow.estimated_time},
                    resource_savings={'time_saved': 0.2},
                    applicability_conditions={'workflow_type': 'general'},
                    success_rate=workflow.success_rate,
                    confidence=0.8
                )
                patterns.append(pattern)
        
        return patterns
    
    def _calculate_ux_score(self, workflows: List[Workflow]) -> float:
        """计算用户体验分数"""
        if not workflows:
            return 0.0
        
        total_score = 0.0
        for workflow in workflows:
            # 基于成功率和优化数量计算分数
            score = workflow.success_rate * 0.7 + len(workflow.optimizations) * 0.1
            total_score += min(1.0, score)
        
        return total_score / len(workflows)
    
    def _group_traces_by_execution_time(self, traces: List[ExecutionTrace]) -> Dict[str, List[ExecutionTrace]]:
        """按执行时间分组轨迹"""
        groups = {
            'fast': [],      # < 10s
            'medium': [],    # 10-30s
            'slow': []       # > 30s
        }
        
        for trace in traces:
            if trace.start_time and trace.end_time:
                execution_time = trace.end_time - trace.start_time
                if execution_time < 10.0:
                    groups['fast'].append(trace)
                elif execution_time < 30.0:
                    groups['medium'].append(trace)
                else:
                    groups['slow'].append(trace)
        
        return groups
    
    def _create_efficiency_pattern(self, time_range: str, traces: List[ExecutionTrace]) -> Optional[EfficiencyPattern]:
        """创建效率模式"""
        if not traces:
            return None
        
        # 计算平均指标
        execution_times = []
        for t in traces:
            if t.start_time and t.end_time:
                execution_times.append(t.end_time - t.start_time)
        
        if not execution_times:
            return None
            
        avg_time = statistics.mean(execution_times)
        success_rate = sum(1 for t in traces if t.success) / len(traces)
        
        pattern = EfficiencyPattern(
            pattern_id="",  # 将在__post_init__中生成
            pattern_name=f"Efficiency pattern for {time_range} execution",
            optimization_techniques=['time_optimization'],
            performance_metrics={'avg_execution_time': avg_time},
            resource_savings={'time_category': time_range},
            applicability_conditions={'execution_time_range': time_range},
            success_rate=success_rate,
            confidence=min(1.0, len(traces) / 10.0)
        )
        
        return pattern
    
    def _identify_resource_patterns(self, traces: List[ExecutionTrace]) -> List[EfficiencyPattern]:
        """识别资源模式"""
        patterns = []
        
        # 分析资源使用
        resource_data = {}
        for trace in traces:
            if trace.resource_usage:
                for resource, usage in trace.resource_usage.items():
                    if resource not in resource_data:
                        resource_data[resource] = []
                    if isinstance(usage, (int, float)):
                        resource_data[resource].append(usage)
        
        # 为每种资源创建模式
        for resource, usages in resource_data.items():
            if len(usages) >= self.min_pattern_frequency:
                avg_usage = statistics.mean(usages)
                pattern = EfficiencyPattern(
                    pattern_id="",  # 将在__post_init__中生成
                    pattern_name=f"Resource pattern for {resource}",
                    optimization_techniques=['resource_optimization'],
                    performance_metrics={f'{resource}_usage': avg_usage},
                    resource_savings={resource: max(0.0, 1.0 - avg_usage)},
                    applicability_conditions={'resource_type': resource},
                    success_rate=0.8,
                    confidence=min(1.0, len(usages) / 20.0)
                )
                patterns.append(pattern)
        
        return patterns
    
    def _identify_success_patterns(self, traces: List[ExecutionTrace]) -> List[EfficiencyPattern]:
        """识别成功模式"""
        patterns = []
        
        # 分析成功和失败的轨迹
        successful_traces = [t for t in traces if t.success]
        failed_traces = [t for t in traces if not t.success]
        
        if len(successful_traces) >= self.min_pattern_frequency:
            # 成功模式
            success_times = []
            for t in successful_traces:
                if t.start_time and t.end_time:
                    success_times.append(t.end_time - t.start_time)
            
            if success_times:
                avg_success_time = statistics.mean(success_times)
            else:
                avg_success_time = 0.0
            pattern = EfficiencyPattern(
                pattern_id="",  # 将在__post_init__中生成
                pattern_name="Success execution pattern",
                optimization_techniques=['success_optimization'],
                performance_metrics={'avg_success_time': avg_success_time},
                resource_savings={'success_rate_improvement': 0.1},
                applicability_conditions={'target': 'success_optimization'},
                success_rate=1.0,
                confidence=len(successful_traces) / len(traces)
            )
            patterns.append(pattern)
        
        return patterns
    
    def _optimize_workflow_resources(self, workflow: Workflow) -> Workflow:
        """优化单个工作流的资源使用"""
        optimized_steps = []
        
        for step in workflow.steps:
            # 添加资源优化标记
            optimized_step = step.copy()
            if 'metadata' not in optimized_step:
                optimized_step['metadata'] = {}
            optimized_step['metadata']['resource_optimized'] = True
            optimized_steps.append(optimized_step)
        
        return Workflow(
            workflow_id=workflow.workflow_id,
            name=workflow.name,
            steps=optimized_steps,
            conditions=workflow.conditions,
            optimizations=workflow.optimizations + ['individual_resource_optimization'],
            estimated_time=workflow.estimated_time,
            success_rate=workflow.success_rate
        )
    
    def _global_resource_optimization(self, workflows: List[Workflow]) -> List[Workflow]:
        """全局资源优化"""
        # 简单实现：为所有工作流添加全局优化标记
        optimized_workflows = []
        
        for workflow in workflows:
            optimized = Workflow(
                workflow_id=workflow.workflow_id,
                name=workflow.name,
                steps=workflow.steps,
                conditions=workflow.conditions,
                optimizations=workflow.optimizations + ['global_resource_optimization'],
                estimated_time=workflow.estimated_time * 0.95,  # 5%的全局优化
                success_rate=workflow.success_rate
            )
            optimized_workflows.append(optimized)
        
        return optimized_workflows
    
    def _find_parallel_opportunities(self, traces: List[ExecutionTrace]) -> List[Dict[str, Any]]:
        """找到并行化机会"""
        opportunities = []
        
        for trace in traces:
            if trace.action_sequence and len(trace.action_sequence) > 2:
                opportunity = {
                    'type': 'parallel_execution',
                    'trace_id': trace.trace_id,
                    'parallel_factor': 1.5,
                    'potential_savings': 0.3,
                    'description': 'Actions can be executed in parallel'
                }
                opportunities.append(opportunity)
        
        return opportunities
    
    def _find_cache_opportunities(self, traces: List[ExecutionTrace]) -> List[Dict[str, Any]]:
        """找到缓存机会"""
        opportunities = []
        
        # 统计重复的动作序列
        sequence_counts = {}
        for trace in traces:
            if trace.action_sequence:
                sequence_key = str(trace.action_sequence)
                sequence_counts[sequence_key] = sequence_counts.get(sequence_key, 0) + 1
        
        for sequence, count in sequence_counts.items():
            if count > 2:  # 出现超过2次的序列可以缓存
                opportunity = {
                    'type': 'caching',
                    'sequence': sequence,
                    'frequency': count,
                    'cache_hit_ratio': min(0.9, count / len(traces)),
                    'potential_savings': min(0.5, count * 0.1),
                    'description': f'Sequence appears {count} times, suitable for caching'
                }
                opportunities.append(opportunity)
        
        return opportunities
    
    def _find_simplification_opportunities(self, traces: List[ExecutionTrace]) -> List[Dict[str, Any]]:
        """找到简化机会"""
        opportunities = []
        
        for trace in traces:
            if trace.action_sequence and len(trace.action_sequence) > 5:
                opportunity = {
                    'type': 'workflow_simplification',
                    'trace_id': trace.trace_id,
                    'current_steps': len(trace.action_sequence),
                    'simplified_steps': max(3, len(trace.action_sequence) // 2),
                    'simplification_ratio': 0.5,
                    'potential_savings': 0.2,
                    'description': 'Complex workflow can be simplified'
                }
                opportunities.append(opportunity)
        
        return opportunities
    
    def _simplify_step(self, step: Dict[str, Any]) -> Dict[str, Any]:
        """简化步骤"""
        simplified_step = step.copy()
        
        # 移除非必要的动作
        if 'actions' in simplified_step:
            essential_actions = []
            for action in simplified_step['actions']:
                if action.get('essential', True):  # 默认认为是必要的
                    essential_actions.append(action)
            simplified_step['actions'] = essential_actions
        
        return simplified_step
    
    def _merge_similar_steps(self, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """合并相似步骤"""
        merged_steps = []
        i = 0
        
        while i < len(steps):
            current_step = steps[i]
            
            # 查找可以合并的后续步骤
            j = i + 1
            while j < len(steps) and self._steps_similar(current_step, steps[j]):
                # 合并步骤
                current_step = self._merge_two_steps(current_step, steps[j])
                j += 1
            
            merged_steps.append(current_step)
            i = j
        
        return merged_steps
    
    def _steps_similar(self, step1: Dict[str, Any], step2: Dict[str, Any]) -> bool:
        """检查步骤是否相似"""
        # 简单的相似性检查
        return (step1.get('type') == step2.get('type') and
                len(step1.get('actions', [])) == len(step2.get('actions', [])))
    
    def _merge_two_steps(self, step1: Dict[str, Any], step2: Dict[str, Any]) -> Dict[str, Any]:
        """合并两个步骤"""
        merged_step = step1.copy()
        
        # 合并动作
        if 'actions' in step1 and 'actions' in step2:
            merged_step['actions'] = step1['actions'] + step2['actions']
        
        # 更新名称
        merged_step['name'] = f"{step1.get('name', 'Step')} + {step2.get('name', 'Step')}"
        
        return merged_step
    
    def _reorder_for_efficiency(self, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """为效率重新排序步骤"""
        # 简单的排序：按动作数量排序（少的先执行）
        return sorted(steps, key=lambda s: len(s.get('actions', [])))
    
    def _add_user_feedback(self, step: Dict[str, Any]) -> Dict[str, Any]:
        """添加用户反馈"""
        enhanced_step = step.copy()
        
        if 'metadata' not in enhanced_step:
            enhanced_step['metadata'] = {}
        
        enhanced_step['metadata']['user_feedback'] = True
        enhanced_step['metadata']['feedback_type'] = 'progress_update'
        
        return enhanced_step
    
    def _add_progress_indicators(self, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """添加进度指示器"""
        enhanced_steps = []
        
        for i, step in enumerate(steps):
            enhanced_step = step.copy()
            
            if 'metadata' not in enhanced_step:
                enhanced_step['metadata'] = {}
            
            enhanced_step['metadata']['progress'] = {
                'current': i + 1,
                'total': len(steps),
                'percentage': ((i + 1) / len(steps)) * 100
            }
            
            enhanced_steps.append(enhanced_step)
        
        return enhanced_steps
    
    def _optimize_step_resources(self, step: Dict[str, Any]) -> Dict[str, Any]:
        """优化步骤资源使用"""
        optimized_step = step.copy()
        
        if 'metadata' not in optimized_step:
            optimized_step['metadata'] = {}
        
        optimized_step['metadata']['resource_optimized'] = True
        optimized_step['metadata']['optimization_techniques'] = ['memory_pooling', 'lazy_loading']
        
        return optimized_step
    
    def _add_resource_pooling(self, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """添加资源池化"""
        pooled_steps = []
        
        for step in steps:
            pooled_step = step.copy()
            
            if 'metadata' not in pooled_step:
                pooled_step['metadata'] = {}
            
            pooled_step['metadata']['resource_pooling'] = True
            pooled_step['metadata']['pool_type'] = 'shared_resources'
            
            pooled_steps.append(pooled_step)
        
        return pooled_steps