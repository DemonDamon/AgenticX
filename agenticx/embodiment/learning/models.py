"""人类对齐学习引擎数据模型

定义了学习引擎中使用的各种数据结构和模型类。
"""

import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Union, Tuple
from enum import Enum

from agenticx.embodiment.core.models import GUIAction, InteractionElement, ScreenState
from agenticx.embodiment.core.agent import ActionResult, GUITask


class TaskComplexity(Enum):
    """任务复杂度枚举"""
    SIMPLE = "simple"
    MEDIUM = "medium"
    COMPLEX = "complex"
    EXPERT = "expert"


class PatternType(Enum):
    """模式类型枚举"""
    UI_PATTERN = "ui_pattern"
    TASK_PATTERN = "task_pattern"
    EFFICIENCY_PATTERN = "efficiency_pattern"
    KNOWLEDGE_PATTERN = "knowledge_pattern"


class AnomalyType(Enum):
    """异常类型枚举"""
    EXECUTION_FAILURE = "execution_failure"
    UNEXPECTED_STATE = "unexpected_state"
    TIMEOUT = "timeout"
    ELEMENT_NOT_FOUND = "element_not_found"
    PERMISSION_DENIED = "permission_denied"
    NETWORK_ERROR = "network_error"
    OTHER = "other"


class ConflictType(Enum):
    """知识冲突类型枚举"""
    CONTRADICTORY = "contradictory"
    OUTDATED = "outdated"
    INCOMPLETE = "incomplete"
    AMBIGUOUS = "ambiguous"


@dataclass
class AppContext:
    """应用上下文信息"""
    app_name: str  # 应用名称
    app_package: str  # 应用包名
    app_version: str  # 应用版本
    app_category: str  # 应用类别
    description: str  # 应用描述
    common_features: List[str] = field(default_factory=list)  # 常见功能
    ui_framework: Optional[str] = None  # UI框架
    platform: str = "unknown"  # 平台
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "app_name": self.app_name,
            "app_package": self.app_package,
            "app_version": self.app_version,
            "app_category": self.app_category,
            "description": self.description,
            "common_features": self.common_features,
            "ui_framework": self.ui_framework,
            "platform": self.platform,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class UIPattern:
    """UI模式"""
    pattern_id: str  # 模式ID
    pattern_type: str  # 模式类型
    elements: List[InteractionElement]  # 相关元素
    layout_description: str  # 布局描述
    interaction_flow: List[str]  # 交互流程
    frequency: int = 0  # 出现频率
    confidence: float = 0.0  # 置信度
    app_contexts: List[str] = field(default_factory=list)  # 应用上下文
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.pattern_id:
            self.pattern_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "pattern_id": self.pattern_id,
            "pattern_type": self.pattern_type,
            "elements": [elem.to_dict() for elem in self.elements],
            "layout_description": self.layout_description,
            "interaction_flow": self.interaction_flow,
            "frequency": self.frequency,
            "confidence": self.confidence,
            "app_contexts": self.app_contexts,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class ActionTrace:
    """动作轨迹"""
    trace_id: str  # 轨迹ID
    actions: List[GUIAction]  # 动作序列
    results: List[ActionResult]  # 结果序列
    states: List[ScreenState]  # 状态序列
    app_context: AppContext  # 应用上下文
    start_time: float  # 开始时间
    end_time: Optional[float] = None  # 结束时间
    success: bool = False  # 是否成功
    goal_description: Optional[str] = None  # 目标描述
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.trace_id:
            self.trace_id = str(uuid.uuid4())
    
    @property
    def duration(self) -> Optional[float]:
        """获取持续时间"""
        if self.end_time:
            return self.end_time - self.start_time
        return None
    
    @property
    def action_count(self) -> int:
        """获取动作数量"""
        return len(self.actions)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "trace_id": self.trace_id,
            "actions": [action.to_dict() for action in self.actions],
            "results": [result.to_dict() for result in self.results],
            "states": [state.to_dict() for state in self.states],
            "app_context": self.app_context.to_dict(),
            "start_time": self.start_time,
            "end_time": self.end_time,
            "success": self.success,
            "goal_description": self.goal_description,
            "duration": self.duration,
            "action_count": self.action_count,
            "metadata": self.metadata
        }


@dataclass
class ComplexTask:
    """复杂任务"""
    task_id: str  # 任务ID
    description: str  # 任务描述
    sub_tasks: List[GUITask]  # 子任务列表
    action_sequences: List[List[GUIAction]]  # 动作序列
    complexity: TaskComplexity  # 复杂度
    estimated_time: float  # 预估时间
    success_rate: float = 0.0  # 成功率
    prerequisites: List[str] = field(default_factory=list)  # 前置条件
    app_context: Optional[AppContext] = None  # 应用上下文
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.task_id:
            self.task_id = str(uuid.uuid4())
    
    @property
    def total_actions(self) -> int:
        """获取总动作数"""
        return sum(len(seq) for seq in self.action_sequences)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "task_id": self.task_id,
            "description": self.description,
            "sub_tasks": [task.to_dict() for task in self.sub_tasks],
            "action_sequences": [[action.to_dict() for action in seq] for seq in self.action_sequences],
            "complexity": self.complexity.value,
            "estimated_time": self.estimated_time,
            "success_rate": self.success_rate,
            "prerequisites": self.prerequisites,
            "app_context": self.app_context.to_dict() if self.app_context else None,
            "total_actions": self.total_actions,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class TaskPattern:
    """任务模式"""
    pattern_id: str  # 模式ID
    pattern_name: str  # 模式名称
    task_templates: List[ComplexTask]  # 任务模板
    common_sequences: List[List[GUIAction]]  # 常见序列
    success_indicators: List[str]  # 成功指标
    failure_patterns: List[str]  # 失败模式
    frequency: int = 0  # 出现频率
    confidence: float = 0.0  # 置信度
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.pattern_id:
            self.pattern_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "pattern_id": self.pattern_id,
            "pattern_name": self.pattern_name,
            "task_templates": [task.to_dict() for task in self.task_templates],
            "common_sequences": [[action.to_dict() for action in seq] for seq in self.common_sequences],
            "success_indicators": self.success_indicators,
            "failure_patterns": self.failure_patterns,
            "frequency": self.frequency,
            "confidence": self.confidence,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class Workflow:
    """工作流"""
    workflow_id: str  # 工作流ID
    name: str  # 工作流名称
    steps: List[Dict[str, Any]]  # 工作流步骤
    conditions: Dict[str, Any]  # 条件
    optimizations: List[str]  # 优化项
    estimated_time: float  # 预估时间
    success_rate: float = 0.0  # 成功率
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.workflow_id:
            self.workflow_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "workflow_id": self.workflow_id,
            "name": self.name,
            "steps": self.steps,
            "conditions": self.conditions,
            "optimizations": self.optimizations,
            "estimated_time": self.estimated_time,
            "success_rate": self.success_rate,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class ExecutionLog:
    """执行日志"""
    log_id: str  # 日志ID
    task_id: str  # 任务ID
    actions: List[GUIAction]  # 执行的动作
    results: List[ActionResult]  # 动作结果
    execution_time: float  # 执行时间
    success: bool  # 是否成功
    error_message: Optional[str] = None  # 错误信息
    performance_metrics: Dict[str, float] = field(default_factory=dict)  # 性能指标
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    timestamp: float = field(default_factory=time.time)  # 时间戳
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.log_id:
            self.log_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "log_id": self.log_id,
            "task_id": self.task_id,
            "actions": [action.to_dict() for action in self.actions],
            "results": [result.to_dict() for result in self.results],
            "execution_time": self.execution_time,
            "success": self.success,
            "error_message": self.error_message,
            "performance_metrics": self.performance_metrics,
            "metadata": self.metadata,
            "timestamp": self.timestamp
        }


@dataclass
class EfficiencyPattern:
    """效率模式"""
    pattern_id: str  # 模式ID
    pattern_name: str  # 模式名称
    optimization_type: str  # 优化类型
    time_savings: float  # 时间节省
    success_improvement: float  # 成功率提升
    applicable_tasks: List[str]  # 适用任务
    implementation_steps: List[str]  # 实现步骤
    confidence: float = 0.0  # 置信度
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.pattern_id:
            self.pattern_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "pattern_id": self.pattern_id,
            "pattern_name": self.pattern_name,
            "optimization_type": self.optimization_type,
            "time_savings": self.time_savings,
            "success_improvement": self.success_improvement,
            "applicable_tasks": self.applicable_tasks,
            "implementation_steps": self.implementation_steps,
            "confidence": self.confidence,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class ExecutionTrace:
    """执行轨迹"""
    trace_id: str  # 轨迹ID
    task_id: str  # 任务ID
    action_sequence: List[GUIAction]  # 动作序列
    state_sequence: List[ScreenState]  # 状态序列
    result_sequence: List[ActionResult]  # 结果序列
    start_time: float  # 开始时间
    end_time: Optional[float] = None  # 结束时间
    success: bool = False  # 是否成功
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.trace_id:
            self.trace_id = str(uuid.uuid4())
    
    @property
    def duration(self) -> Optional[float]:
        """获取持续时间"""
        if self.end_time:
            return self.end_time - self.start_time
        return None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "trace_id": self.trace_id,
            "task_id": self.task_id,
            "action_sequence": [action.to_dict() for action in self.action_sequence],
            "state_sequence": [state.to_dict() for state in self.state_sequence],
            "result_sequence": [result.to_dict() for result in self.result_sequence],
            "start_time": self.start_time,
            "end_time": self.end_time,
            "success": self.success,
            "duration": self.duration,
            "metadata": self.metadata
        }


@dataclass
class Anomaly:
    """异常情况"""
    anomaly_id: str  # 异常ID
    anomaly_type: AnomalyType  # 异常类型
    description: str  # 异常描述
    context: Dict[str, Any]  # 异常上下文
    severity: str  # 严重程度
    frequency: int = 1  # 出现频率
    related_actions: List[GUIAction] = field(default_factory=list)  # 相关动作
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    detected_at: float = field(default_factory=time.time)  # 检测时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.anomaly_id:
            self.anomaly_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "anomaly_id": self.anomaly_id,
            "anomaly_type": self.anomaly_type.value,
            "description": self.description,
            "context": self.context,
            "severity": self.severity,
            "frequency": self.frequency,
            "related_actions": [action.to_dict() for action in self.related_actions],
            "metadata": self.metadata,
            "detected_at": self.detected_at
        }


@dataclass
class EdgeCase:
    """边缘情况"""
    case_id: str  # 情况ID
    case_name: str  # 情况名称
    description: str  # 描述
    triggers: List[str]  # 触发条件
    symptoms: List[str]  # 症状
    impact: str  # 影响
    frequency: int = 0  # 出现频率
    related_anomalies: List[str] = field(default_factory=list)  # 相关异常
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.case_id:
            self.case_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "case_id": self.case_id,
            "case_name": self.case_name,
            "description": self.description,
            "triggers": self.triggers,
            "symptoms": self.symptoms,
            "impact": self.impact,
            "frequency": self.frequency,
            "related_anomalies": self.related_anomalies,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class RecoveryStrategy:
    """恢复策略"""
    strategy_id: str  # 策略ID
    strategy_name: str  # 策略名称
    description: str  # 描述
    steps: List[str]  # 恢复步骤
    applicable_cases: List[str]  # 适用情况
    success_rate: float = 0.0  # 成功率
    estimated_time: float = 0.0  # 预估时间
    priority: int = 0  # 优先级
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.strategy_id:
            self.strategy_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "strategy_id": self.strategy_id,
            "strategy_name": self.strategy_name,
            "description": self.description,
            "steps": self.steps,
            "applicable_cases": self.applicable_cases,
            "success_rate": self.success_rate,
            "estimated_time": self.estimated_time,
            "priority": self.priority,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class Experience:
    """经验数据"""
    experience_id: str  # 经验ID
    experience_type: str  # 经验类型
    content: Dict[str, Any]  # 经验内容
    context: Dict[str, Any]  # 经验上下文
    outcome: str  # 结果
    confidence: float = 0.0  # 置信度
    relevance_score: float = 0.0  # 相关性分数
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.experience_id:
            self.experience_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "experience_id": self.experience_id,
            "experience_type": self.experience_type,
            "content": self.content,
            "context": self.context,
            "outcome": self.outcome,
            "confidence": self.confidence,
            "relevance_score": self.relevance_score,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class Pattern:
    """通用模式"""
    pattern_id: str  # 模式ID
    pattern_type: PatternType  # 模式类型
    pattern_name: str  # 模式名称
    description: str  # 描述
    structure: Dict[str, Any]  # 模式结构
    examples: List[Dict[str, Any]]  # 示例
    frequency: int = 0  # 出现频率
    confidence: float = 0.0  # 置信度
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.pattern_id:
            self.pattern_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "pattern_id": self.pattern_id,
            "pattern_type": self.pattern_type.value,
            "pattern_name": self.pattern_name,
            "description": self.description,
            "structure": self.structure,
            "examples": self.examples,
            "frequency": self.frequency,
            "confidence": self.confidence,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class KnowledgeConflict:
    """知识冲突"""
    conflict_id: str  # 冲突ID
    conflict_type: ConflictType  # 冲突类型
    description: str  # 冲突描述
    conflicting_items: List[str]  # 冲突项
    severity: str  # 严重程度
    context: Dict[str, Any]  # 冲突上下文
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    detected_at: float = field(default_factory=time.time)  # 检测时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.conflict_id:
            self.conflict_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "conflict_id": self.conflict_id,
            "conflict_type": self.conflict_type.value,
            "description": self.description,
            "conflicting_items": self.conflicting_items,
            "severity": self.severity,
            "context": self.context,
            "metadata": self.metadata,
            "detected_at": self.detected_at
        }


@dataclass
class Resolution:
    """解决方案"""
    resolution_id: str  # 解决方案ID
    resolution_type: str  # 解决方案类型
    description: str  # 描述
    steps: List[str]  # 解决步骤
    outcome: str  # 预期结果
    confidence: float = 0.0  # 置信度
    estimated_effort: float = 0.0  # 预估工作量
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.resolution_id:
            self.resolution_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "resolution_id": self.resolution_id,
            "resolution_type": self.resolution_type,
            "description": self.description,
            "steps": self.steps,
            "outcome": self.outcome,
            "confidence": self.confidence,
            "estimated_effort": self.estimated_effort,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class KnowledgeItem:
    """知识项"""
    item_id: str  # 知识项ID
    item_type: str  # 知识项类型
    content: Dict[str, Any]  # 知识内容
    source: str  # 知识来源
    confidence: float = 0.0  # 置信度
    relevance: float = 0.0  # 相关性
    usage_count: int = 0  # 使用次数
    last_used: Optional[float] = None  # 最后使用时间
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.item_id:
            self.item_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "item_id": self.item_id,
            "item_type": self.item_type,
            "content": self.content,
            "source": self.source,
            "confidence": self.confidence,
            "relevance": self.relevance,
            "usage_count": self.usage_count,
            "last_used": self.last_used,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class ValidationResult:
    """验证结果"""
    validation_id: str  # 验证ID
    task_name: str  # 任务名称
    success: bool  # 是否成功
    score: float  # 验证分数
    details: Dict[str, Any]  # 详细信息
    errors: List[str] = field(default_factory=list)  # 错误列表
    warnings: List[str] = field(default_factory=list)  # 警告列表
    execution_time: float = 0.0  # 执行时间
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    timestamp: float = field(default_factory=time.time)  # 时间戳
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.validation_id:
            self.validation_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "validation_id": self.validation_id,
            "task_name": self.task_name,
            "success": self.success,
            "score": self.score,
            "details": self.details,
            "errors": self.errors,
            "warnings": self.warnings,
            "execution_time": self.execution_time,
            "metadata": self.metadata,
            "timestamp": self.timestamp
        }


@dataclass
class EFSM:
    """扩展有限状态机"""
    fsm_id: str  # 状态机ID
    name: str  # 状态机名称
    states: List[str]  # 状态列表
    transitions: Dict[str, Dict[str, str]]  # 状态转换
    initial_state: str  # 初始状态
    final_states: List[str]  # 终止状态
    variables: Dict[str, Any] = field(default_factory=dict)  # 变量
    guards: Dict[str, str] = field(default_factory=dict)  # 守卫条件
    actions: Dict[str, List[str]] = field(default_factory=dict)  # 动作
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.fsm_id:
            self.fsm_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "fsm_id": self.fsm_id,
            "name": self.name,
            "states": self.states,
            "transitions": self.transitions,
            "initial_state": self.initial_state,
            "final_states": self.final_states,
            "variables": self.variables,
            "guards": self.guards,
            "actions": self.actions,
            "metadata": self.metadata,
            "created_at": self.created_at
        }


@dataclass
class ReflectionResult:
    """反思结果"""
    reflection_id: str  # 反思ID
    task_id: str  # 任务ID
    reflection_type: str  # 反思类型
    insights: List[str]  # 洞察
    lessons_learned: List[str]  # 经验教训
    improvement_suggestions: List[str]  # 改进建议
    confidence: float = 0.0  # 置信度
    impact_assessment: Dict[str, float] = field(default_factory=dict)  # 影响评估
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.reflection_id:
            self.reflection_id = str(uuid.uuid4())
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "reflection_id": self.reflection_id,
            "task_id": self.task_id,
            "reflection_type": self.reflection_type,
            "insights": self.insights,
            "lessons_learned": self.lessons_learned,
            "improvement_suggestions": self.improvement_suggestions,
            "confidence": self.confidence,
            "impact_assessment": self.impact_assessment,
            "metadata": self.metadata,
            "created_at": self.created_at
        }