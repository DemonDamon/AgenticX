"""任务合成器

负责从用户行为中合成复杂任务，并将复杂任务分解为可执行的子任务。
"""

import time
import logging
from typing import Dict, List, Optional, Any, Tuple, Set
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

from .models import (
    ComplexTask, TaskComplexity, ActionTrace, TaskPattern,
    Workflow, ExecutionTrace, Pattern, PatternType
)
from agenticx.embodiment.core.models import GUIAction, ScreenState
from agenticx.embodiment.core.agent import GUITask, ActionResult


class SynthesisStrategy(Enum):
    """合成策略枚举"""
    FREQUENCY_BASED = "frequency_based"
    PATTERN_BASED = "pattern_based"
    GOAL_ORIENTED = "goal_oriented"
    HYBRID = "hybrid"


class DecompositionMethod(Enum):
    """分解方法枚举"""
    SEQUENTIAL = "sequential"
    HIERARCHICAL = "hierarchical"
    PARALLEL = "parallel"
    CONDITIONAL = "conditional"


@dataclass
class SynthesisResult:
    """合成结果"""
    synthesized_tasks: List[ComplexTask]
    task_patterns: List[TaskPattern]
    workflows: List[Workflow]
    confidence_scores: Dict[str, float]
    metadata: Dict[str, Any]


@dataclass
class DecompositionResult:
    """分解结果"""
    sub_tasks: List[GUITask]
    execution_order: List[int]
    dependencies: Dict[int, List[int]]
    estimated_time: float
    success_probability: float
    metadata: Dict[str, Any]


class TaskSynthesizer(ABC):
    """任务合成器抽象基类"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化任务合成器
        
        Args:
            config: 配置参数
        """
        self.config = config or {}
        self.logger = logging.getLogger(self.__class__.__name__)
        self._task_patterns: Dict[str, TaskPattern] = {}
        self._synthesized_tasks: Dict[str, ComplexTask] = {}
        self._workflows: Dict[str, Workflow] = {}
        
    @abstractmethod
    def synthesize_tasks_from_traces(self, action_traces: List[ActionTrace],
                                   strategy: SynthesisStrategy = SynthesisStrategy.HYBRID) -> SynthesisResult:
        """从动作轨迹合成任务
        
        Args:
            action_traces: 动作轨迹列表
            strategy: 合成策略
            
        Returns:
            SynthesisResult: 合成结果
        """
        pass
    
    @abstractmethod
    def decompose_complex_task(self, complex_task: ComplexTask,
                             method: DecompositionMethod = DecompositionMethod.HIERARCHICAL) -> DecompositionResult:
        """分解复杂任务
        
        Args:
            complex_task: 复杂任务
            method: 分解方法
            
        Returns:
            DecompositionResult: 分解结果
        """
        pass
    
    @abstractmethod
    def identify_task_patterns(self, tasks: List[ComplexTask]) -> List[TaskPattern]:
        """识别任务模式
        
        Args:
            tasks: 任务列表
            
        Returns:
            List[TaskPattern]: 任务模式列表
        """
        pass
    
    @abstractmethod
    def generate_workflows(self, task_patterns: List[TaskPattern]) -> List[Workflow]:
        """生成工作流
        
        Args:
            task_patterns: 任务模式列表
            
        Returns:
            List[Workflow]: 工作流列表
        """
        pass
    
    @abstractmethod
    def optimize_task_sequence(self, tasks: List[GUITask]) -> List[GUITask]:
        """优化任务序列
        
        Args:
            tasks: 任务列表
            
        Returns:
            List[GUITask]: 优化后的任务列表
        """
        pass
    
    def get_synthesis_statistics(self) -> Dict[str, Any]:
        """获取合成统计信息"""
        return {
            'task_patterns_count': len(self._task_patterns),
            'synthesized_tasks_count': len(self._synthesized_tasks),
            'workflows_count': len(self._workflows)
        }


class DefaultTaskSynthesizer(TaskSynthesizer):
    """默认任务合成器实现"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """初始化默认任务合成器"""
        super().__init__(config)
        self.min_pattern_frequency = self.config.get('min_pattern_frequency', 3)
        self.max_task_complexity = self.config.get('max_task_complexity', TaskComplexity.EXPERT)
        self.similarity_threshold = self.config.get('similarity_threshold', 0.8)
        self.max_subtasks = self.config.get('max_subtasks', 10)
        
    def synthesize_tasks_from_traces(self, action_traces: List[ActionTrace],
                                   strategy: SynthesisStrategy = SynthesisStrategy.HYBRID) -> SynthesisResult:
        """从动作轨迹合成任务"""
        try:
            synthesized_tasks = []
            task_patterns = []
            workflows = []
            confidence_scores = {}
            
            if strategy == SynthesisStrategy.FREQUENCY_BASED:
                synthesized_tasks = self._synthesize_by_frequency(action_traces)
            elif strategy == SynthesisStrategy.PATTERN_BASED:
                synthesized_tasks = self._synthesize_by_patterns(action_traces)
            elif strategy == SynthesisStrategy.GOAL_ORIENTED:
                synthesized_tasks = self._synthesize_by_goals(action_traces)
            elif strategy == SynthesisStrategy.HYBRID:
                synthesized_tasks = self._synthesize_hybrid(action_traces)
            
            # 识别任务模式
            task_patterns = self.identify_task_patterns(synthesized_tasks)
            
            # 生成工作流
            workflows = self.generate_workflows(task_patterns)
            
            # 计算置信度分数
            confidence_scores = self._calculate_confidence_scores(synthesized_tasks, action_traces)
            
            result = SynthesisResult(
                synthesized_tasks=synthesized_tasks,
                task_patterns=task_patterns,
                workflows=workflows,
                confidence_scores=confidence_scores,
                metadata={
                    'strategy': strategy.value,
                    'trace_count': len(action_traces),
                    'synthesis_time': time.time()
                }
            )
            
            self.logger.info(f"合成了 {len(synthesized_tasks)} 个任务")
            return result
            
        except Exception as e:
            self.logger.error(f"任务合成失败: {e}")
            return SynthesisResult(
                synthesized_tasks=[],
                task_patterns=[],
                workflows=[],
                confidence_scores={},
                metadata={'error': str(e)}
            )
    
    def decompose_complex_task(self, complex_task: ComplexTask,
                             method: DecompositionMethod = DecompositionMethod.HIERARCHICAL) -> DecompositionResult:
        """分解复杂任务"""
        try:
            sub_tasks = []
            execution_order = []
            dependencies = {}
            
            if method == DecompositionMethod.SEQUENTIAL:
                sub_tasks, execution_order = self._decompose_sequential(complex_task)
            elif method == DecompositionMethod.HIERARCHICAL:
                sub_tasks, execution_order, dependencies = self._decompose_hierarchical(complex_task)
            elif method == DecompositionMethod.PARALLEL:
                sub_tasks, execution_order = self._decompose_parallel(complex_task)
            elif method == DecompositionMethod.CONDITIONAL:
                sub_tasks, execution_order, dependencies = self._decompose_conditional(complex_task)
            
            # 估算执行时间和成功概率
            estimated_time = self._estimate_execution_time(sub_tasks)
            success_probability = self._estimate_success_probability(sub_tasks)
            
            result = DecompositionResult(
                sub_tasks=sub_tasks,
                execution_order=execution_order,
                dependencies=dependencies,
                estimated_time=estimated_time,
                success_probability=success_probability,
                metadata={
                    'method': method.value,
                    'original_task_id': complex_task.task_id,
                    'decomposition_time': time.time()
                }
            )
            
            self.logger.info(f"将任务 {complex_task.task_id} 分解为 {len(sub_tasks)} 个子任务")
            return result
            
        except Exception as e:
            self.logger.error(f"任务分解失败: {e}")
            return DecompositionResult(
                sub_tasks=[],
                execution_order=[],
                dependencies={},
                estimated_time=0.0,
                success_probability=0.0,
                metadata={'error': str(e)}
            )
    
    def identify_task_patterns(self, tasks: List[ComplexTask]) -> List[TaskPattern]:
        """识别任务模式"""
        try:
            patterns = []
            
            # 按复杂度分组任务
            complexity_groups = self._group_tasks_by_complexity(tasks)
            
            for complexity, task_group in complexity_groups.items():
                if len(task_group) >= self.min_pattern_frequency:
                    pattern = self._create_task_pattern(complexity, task_group)
                    if pattern:
                        patterns.append(pattern)
                        self._task_patterns[pattern.pattern_id] = pattern
            
            # 识别序列模式
            sequence_patterns = self._identify_sequence_patterns(tasks)
            patterns.extend(sequence_patterns)
            
            self.logger.info(f"识别了 {len(patterns)} 个任务模式")
            return patterns
            
        except Exception as e:
            self.logger.error(f"识别任务模式失败: {e}")
            return []
    
    def generate_workflows(self, task_patterns: List[TaskPattern]) -> List[Workflow]:
        """生成工作流"""
        try:
            workflows = []
            
            for pattern in task_patterns:
                workflow = self._create_workflow_from_pattern(pattern)
                if workflow:
                    workflows.append(workflow)
                    self._workflows[workflow.workflow_id] = workflow
            
            # 合并相似工作流
            workflows = self._merge_similar_workflows(workflows)
            
            self.logger.info(f"生成了 {len(workflows)} 个工作流")
            return workflows
            
        except Exception as e:
            self.logger.error(f"生成工作流失败: {e}")
            return []
    
    def optimize_task_sequence(self, tasks: List[GUITask]) -> List[GUITask]:
        """优化任务序列"""
        try:
            if not tasks:
                return tasks
            
            # 按优先级和依赖关系排序
            optimized_tasks = self._sort_by_priority_and_dependencies(tasks)
            
            # 合并可并行执行的任务
            optimized_tasks = self._merge_parallel_tasks(optimized_tasks)
            
            # 优化资源使用
            optimized_tasks = self._optimize_resource_usage(optimized_tasks)
            
            self.logger.info(f"优化了 {len(tasks)} 个任务的执行序列")
            return optimized_tasks
            
        except Exception as e:
            self.logger.error(f"优化任务序列失败: {e}")
            return tasks
    
    def _synthesize_by_frequency(self, action_traces: List[ActionTrace]) -> List[ComplexTask]:
        """基于频率合成任务"""
        tasks = []
        
        # 统计动作序列频率
        sequence_counts = {}
        for trace in action_traces:
            sequence = tuple(action.action_type.value for action in trace.actions)
            sequence_counts[sequence] = sequence_counts.get(sequence, 0) + 1
        
        # 创建高频序列的任务
        for sequence, count in sequence_counts.items():
            if count >= self.min_pattern_frequency:
                task = self._create_task_from_sequence(sequence, count)
                if task:
                    tasks.append(task)
        
        return tasks
    
    def _synthesize_by_patterns(self, action_traces: List[ActionTrace]) -> List[ComplexTask]:
        """基于模式合成任务"""
        tasks = []
        
        # 识别动作模式
        patterns = self._identify_action_patterns(action_traces)
        
        # 为每个模式创建任务
        for pattern in patterns:
            task = self._create_task_from_pattern(pattern)
            if task:
                tasks.append(task)
        
        return tasks
    
    def _synthesize_by_goals(self, action_traces: List[ActionTrace]) -> List[ComplexTask]:
        """基于目标合成任务"""
        tasks = []
        
        # 按目标分组轨迹
        goal_groups = self._group_traces_by_goal(action_traces)
        
        # 为每个目标创建任务
        for goal, traces in goal_groups.items():
            task = self._create_task_from_goal(goal, traces)
            if task:
                tasks.append(task)
        
        return tasks
    
    def _synthesize_hybrid(self, action_traces: List[ActionTrace]) -> List[ComplexTask]:
        """混合策略合成任务"""
        frequency_tasks = self._synthesize_by_frequency(action_traces)
        pattern_tasks = self._synthesize_by_patterns(action_traces)
        goal_tasks = self._synthesize_by_goals(action_traces)
        
        # 合并并去重
        all_tasks = frequency_tasks + pattern_tasks + goal_tasks
        unique_tasks = self._deduplicate_tasks(all_tasks)
        
        return unique_tasks
    
    def _decompose_sequential(self, complex_task: ComplexTask) -> Tuple[List[GUITask], List[int]]:
        """顺序分解"""
        sub_tasks = []
        execution_order = []
        
        for i, action_sequence in enumerate(complex_task.action_sequences):
            sub_task = GUITask(
                task_id=f"{complex_task.task_id}_sub_{i}",
                description=f"Sub-task {i+1} of {complex_task.description}",
                goal=f"Execute action sequence {i+1}",
                metadata={'parent_task_id': complex_task.task_id, 'sequence_index': i}
            )
            sub_tasks.append(sub_task)
            execution_order.append(i)
        
        return sub_tasks, execution_order
    
    def _decompose_hierarchical(self, complex_task: ComplexTask) -> Tuple[List[GUITask], List[int], Dict[int, List[int]]]:
        """层次分解"""
        sub_tasks = []
        execution_order = []
        dependencies = {}
        
        # 创建主要子任务
        for i, sub_task_template in enumerate(complex_task.sub_tasks):
            sub_task = GUITask(
                task_id=f"{complex_task.task_id}_main_{i}",
                description=sub_task_template.description,
                goal=sub_task_template.goal,
                metadata={'parent_task_id': complex_task.task_id, 'level': 'main'}
            )
            sub_tasks.append(sub_task)
            execution_order.append(i)
            
            # 设置依赖关系
            if i > 0:
                dependencies[i] = [i-1]
        
        return sub_tasks, execution_order, dependencies
    
    def _decompose_parallel(self, complex_task: ComplexTask) -> Tuple[List[GUITask], List[int]]:
        """并行分解"""
        sub_tasks = []
        execution_order = []
        
        # 识别可并行执行的动作序列
        parallel_groups = self._identify_parallel_sequences(complex_task.action_sequences)
        
        for group_id, sequences in parallel_groups.items():
            for i, sequence in enumerate(sequences):
                sub_task = GUITask(
                    task_id=f"{complex_task.task_id}_parallel_{group_id}_{i}",
                    description=f"Parallel sub-task {i+1} in group {group_id}",
                    goal=f"Execute parallel sequence {i+1}",
                    metadata={'parent_task_id': complex_task.task_id, 'parallel_group': group_id}
                )
                sub_tasks.append(sub_task)
                execution_order.append(len(sub_tasks) - 1)
        
        return sub_tasks, execution_order
    
    def _decompose_conditional(self, complex_task: ComplexTask) -> Tuple[List[GUITask], List[int], Dict[int, List[int]]]:
        """条件分解"""
        sub_tasks = []
        execution_order = []
        dependencies = {}
        
        # 创建条件检查任务
        condition_task = GUITask(
            task_id=f"{complex_task.task_id}_condition",
            description="Check execution conditions",
            goal="Verify prerequisites",
            metadata={'parent_task_id': complex_task.task_id, 'type': 'condition'}
        )
        sub_tasks.append(condition_task)
        execution_order.append(0)
        
        # 创建条件分支任务
        for i, prerequisite in enumerate(complex_task.prerequisites):
            branch_task = GUITask(
                task_id=f"{complex_task.task_id}_branch_{i}",
                description=f"Execute branch for {prerequisite}",
                goal=f"Handle condition: {prerequisite}",
                metadata={'parent_task_id': complex_task.task_id, 'condition': prerequisite}
            )
            sub_tasks.append(branch_task)
            execution_order.append(i + 1)
            dependencies[i + 1] = [0]  # 依赖条件检查任务
        
        return sub_tasks, execution_order, dependencies
    
    def _group_tasks_by_complexity(self, tasks: List[ComplexTask]) -> Dict[TaskComplexity, List[ComplexTask]]:
        """按复杂度分组任务"""
        groups = {}
        for task in tasks:
            if task.complexity not in groups:
                groups[task.complexity] = []
            groups[task.complexity].append(task)
        return groups
    
    def _create_task_pattern(self, complexity: TaskComplexity, tasks: List[ComplexTask]) -> Optional[TaskPattern]:
        """创建任务模式"""
        if not tasks:
            return None
        
        # 分析共同特征
        common_sequences = self._find_common_action_sequences(tasks)
        success_indicators = self._extract_success_indicators(tasks)
        failure_patterns = self._extract_failure_patterns(tasks)
        
        pattern = TaskPattern(
            pattern_id="",  # 将在__post_init__中生成
            pattern_name=f"{complexity.value}_task_pattern",
            task_templates=tasks[:3],  # 限制模板数量
            common_sequences=common_sequences,
            success_indicators=success_indicators,
            failure_patterns=failure_patterns,
            frequency=len(tasks),
            confidence=min(1.0, len(tasks) / 10.0)
        )
        
        return pattern
    
    def _identify_sequence_patterns(self, tasks: List[ComplexTask]) -> List[TaskPattern]:
        """识别序列模式"""
        patterns = []
        
        # 提取所有动作序列
        all_sequences = []
        for task in tasks:
            all_sequences.extend(task.action_sequences)
        
        # 找到常见的子序列
        common_subsequences = self._find_common_subsequences(all_sequences)
        
        # 为每个常见子序列创建模式
        for subsequence in common_subsequences:
            pattern = TaskPattern(
                pattern_id="",  # 将在__post_init__中生成
                pattern_name=f"sequence_pattern_{len(subsequence)}",
                task_templates=[],
                common_sequences=[subsequence],
                success_indicators=["Sequence completed successfully"],
                failure_patterns=["Sequence interrupted"],
                frequency=1,
                confidence=0.8
            )
            patterns.append(pattern)
        
        return patterns
    
    def _create_workflow_from_pattern(self, pattern: TaskPattern) -> Optional[Workflow]:
        """从模式创建工作流"""
        if not pattern.common_sequences:
            return None
        
        steps = []
        for i, sequence in enumerate(pattern.common_sequences):
            step = {
                'step_id': i,
                'name': f"Execute sequence {i+1}",
                'actions': [action.to_dict() for action in sequence],
                'type': 'action_sequence'
            }
            steps.append(step)
        
        workflow = Workflow(
            workflow_id="",  # 将在__post_init__中生成
            name=f"Workflow for {pattern.pattern_name}",
            steps=steps,
            conditions={'pattern_id': pattern.pattern_id},
            optimizations=['sequence_optimization', 'parallel_execution'],
            estimated_time=len(steps) * 10.0,  # 简单估算
            success_rate=pattern.confidence
        )
        
        return workflow
    
    def _merge_similar_workflows(self, workflows: List[Workflow]) -> List[Workflow]:
        """合并相似工作流"""
        merged = []
        used_indices = set()
        
        for i, workflow1 in enumerate(workflows):
            if i in used_indices:
                continue
            
            similar_workflows = [workflow1]
            used_indices.add(i)
            
            for j, workflow2 in enumerate(workflows[i+1:], i+1):
                if j not in used_indices and self._workflows_similar(workflow1, workflow2):
                    similar_workflows.append(workflow2)
                    used_indices.add(j)
            
            if len(similar_workflows) > 1:
                merged_workflow = self._merge_workflows(similar_workflows)
                merged.append(merged_workflow)
            else:
                merged.append(workflow1)
        
        return merged
    
    def _workflows_similar(self, workflow1: Workflow, workflow2: Workflow) -> bool:
        """检查工作流是否相似"""
        # 简单的相似性检查
        return (len(workflow1.steps) == len(workflow2.steps) and
                abs(workflow1.estimated_time - workflow2.estimated_time) < 30.0)
    
    def _merge_workflows(self, workflows: List[Workflow]) -> Workflow:
        """合并工作流"""
        if not workflows:
            return workflows[0]
        
        base_workflow = workflows[0]
        
        # 合并步骤
        all_steps = []
        for workflow in workflows:
            all_steps.extend(workflow.steps)
        
        # 去重步骤
        unique_steps = self._deduplicate_workflow_steps(all_steps)
        
        merged_workflow = Workflow(
            workflow_id="",  # 将在__post_init__中生成
            name=f"Merged workflow from {len(workflows)} workflows",
            steps=unique_steps,
            conditions=base_workflow.conditions,
            optimizations=base_workflow.optimizations,
            estimated_time=sum(w.estimated_time for w in workflows) / len(workflows),
            success_rate=sum(w.success_rate for w in workflows) / len(workflows)
        )
        
        return merged_workflow
    
    def _deduplicate_workflow_steps(self, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """去重工作流步骤"""
        unique_steps = []
        seen_steps = set()
        
        for step in steps:
            step_key = f"{step.get('name', '')}_{len(step.get('actions', []))}"
            if step_key not in seen_steps:
                seen_steps.add(step_key)
                unique_steps.append(step)
        
        return unique_steps
    
    def _sort_by_priority_and_dependencies(self, tasks: List[GUITask]) -> List[GUITask]:
        """按优先级和依赖关系排序"""
        # 简单的优先级排序
        return sorted(tasks, key=lambda t: (t.priority.value, t.created_at))
    
    def _merge_parallel_tasks(self, tasks: List[GUITask]) -> List[GUITask]:
        """合并可并行执行的任务"""
        # 简单实现：返回原任务列表
        return tasks
    
    def _optimize_resource_usage(self, tasks: List[GUITask]) -> List[GUITask]:
        """优化资源使用"""
        # 简单实现：返回原任务列表
        return tasks
    
    def _calculate_confidence_scores(self, tasks: List[ComplexTask], traces: List[ActionTrace]) -> Dict[str, float]:
        """计算置信度分数"""
        scores = {}
        
        for task in tasks:
            # 基于成功率计算置信度
            scores[task.task_id] = task.success_rate
        
        return scores
    
    def _estimate_execution_time(self, tasks: List[GUITask]) -> float:
        """估算执行时间"""
        # 简单估算：每个任务10秒
        return len(tasks) * 10.0
    
    def _estimate_success_probability(self, tasks: List[GUITask]) -> float:
        """估算成功概率"""
        # 简单估算：基于任务数量
        if not tasks:
            return 1.0
        return max(0.1, 1.0 - len(tasks) * 0.05)
    
    def _create_task_from_sequence(self, sequence: Tuple[str, ...], frequency: int) -> Optional[ComplexTask]:
        """从序列创建任务"""
        if not sequence:
            return None
        
        task = ComplexTask(
            task_id="",  # 将在__post_init__中生成
            description=f"Task with sequence: {' -> '.join(sequence)}",
            sub_tasks=[],
            action_sequences=[],  # 需要从序列重建
            complexity=self._determine_complexity(len(sequence)),
            estimated_time=len(sequence) * 2.0,
            success_rate=min(1.0, frequency / 10.0),
            metadata={'sequence': sequence, 'frequency': frequency}
        )
        
        return task
    
    def _determine_complexity(self, sequence_length: int) -> TaskComplexity:
        """确定任务复杂度"""
        if sequence_length <= 3:
            return TaskComplexity.SIMPLE
        elif sequence_length <= 6:
            return TaskComplexity.MEDIUM
        elif sequence_length <= 10:
            return TaskComplexity.COMPLEX
        else:
            return TaskComplexity.EXPERT
    
    def _identify_action_patterns(self, traces: List[ActionTrace]) -> List[Pattern]:
        """识别动作模式"""
        patterns = []
        
        # 简单的模式识别
        for trace in traces:
            if len(trace.actions) >= 3:
                pattern = Pattern(
                    pattern_id="",  # 将在__post_init__中生成
                    pattern_type=PatternType.TASK_PATTERN,
                    pattern_name=f"Action pattern from trace {trace.trace_id}",
                    description="Pattern extracted from action trace",
                    structure={'actions': [a.action_type.value for a in trace.actions]},
                    examples=[{'trace_id': trace.trace_id}],
                    frequency=1,
                    confidence=0.8 if trace.success else 0.4
                )
                patterns.append(pattern)
        
        return patterns
    
    def _create_task_from_pattern(self, pattern: Pattern) -> Optional[ComplexTask]:
        """从模式创建任务"""
        actions = pattern.structure.get('actions', [])
        if not actions:
            return None
        
        task = ComplexTask(
            task_id="",  # 将在__post_init__中生成
            description=f"Task based on pattern: {pattern.pattern_name}",
            sub_tasks=[],
            action_sequences=[],
            complexity=self._determine_complexity(len(actions)),
            estimated_time=len(actions) * 3.0,
            success_rate=pattern.confidence,
            metadata={'pattern_id': pattern.pattern_id}
        )
        
        return task
    
    def _group_traces_by_goal(self, traces: List[ActionTrace]) -> Dict[str, List[ActionTrace]]:
        """按目标分组轨迹"""
        groups = {}
        
        for trace in traces:
            goal = trace.goal_description or "unknown_goal"
            if goal not in groups:
                groups[goal] = []
            groups[goal].append(trace)
        
        return groups
    
    def _create_task_from_goal(self, goal: str, traces: List[ActionTrace]) -> Optional[ComplexTask]:
        """从目标创建任务"""
        if not traces:
            return None
        
        # 计算平均执行时间和成功率
        avg_duration = sum(t.duration or 0 for t in traces) / len(traces)
        success_rate = sum(1 for t in traces if t.success) / len(traces)
        
        task = ComplexTask(
            task_id="",  # 将在__post_init__中生成
            description=f"Task for goal: {goal}",
            sub_tasks=[],
            action_sequences=[],
            complexity=self._determine_complexity(len(traces[0].actions) if traces else 1),
            estimated_time=avg_duration,
            success_rate=success_rate,
            metadata={'goal': goal, 'trace_count': len(traces)}
        )
        
        return task
    
    def _deduplicate_tasks(self, tasks: List[ComplexTask]) -> List[ComplexTask]:
        """去重任务"""
        unique_tasks = []
        seen_descriptions = set()
        
        for task in tasks:
            if task.description not in seen_descriptions:
                seen_descriptions.add(task.description)
                unique_tasks.append(task)
        
        return unique_tasks
    
    def _find_common_action_sequences(self, tasks: List[ComplexTask]) -> List[List[GUIAction]]:
        """找到共同的动作序列"""
        # 简单实现：返回第一个任务的序列
        if tasks and tasks[0].action_sequences:
            return tasks[0].action_sequences[:3]  # 限制数量
        return []
    
    def _extract_success_indicators(self, tasks: List[ComplexTask]) -> List[str]:
        """提取成功指标"""
        indicators = []
        
        for task in tasks:
            if task.success_rate > 0.8:
                indicators.append(f"High success rate: {task.success_rate:.2f}")
        
        return list(set(indicators))  # 去重
    
    def _extract_failure_patterns(self, tasks: List[ComplexTask]) -> List[str]:
        """提取失败模式"""
        patterns = []
        
        for task in tasks:
            if task.success_rate < 0.5:
                patterns.append(f"Low success rate: {task.success_rate:.2f}")
        
        return list(set(patterns))  # 去重
    
    def _find_common_subsequences(self, sequences: List[List[GUIAction]]) -> List[List[GUIAction]]:
        """找到常见的子序列"""
        # 简化实现：返回前几个序列
        return sequences[:3] if sequences else []
    
    def _identify_parallel_sequences(self, sequences: List[List[GUIAction]]) -> Dict[int, List[List[GUIAction]]]:
        """识别可并行执行的序列"""
        # 简化实现：将所有序列分为一组
        return {0: sequences} if sequences else {}