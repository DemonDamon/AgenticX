"""
AgenticX Workforce 模块

内化自 CAMEL-AI 的 Workforce 编排系统，实现智能任务分解和故障恢复机制。

参考：
- CAMEL-AI: camel/societies/workforce/workforce.py
- License: Apache 2.0 (CAMEL-AI.org)

增强功能（参考 Eigent）：
- 任务分解和执行分离
- 事件通知系统
- 上下文精细化管理
- 工作流记忆传递
"""

from .utils import (
    RecoveryStrategy,
    FailureHandlingConfig,
    TaskAnalysisResult,
    WorkforceMode,
)
from .workforce_pattern import WorkforcePattern
from .coordinator import CoordinatorAgent
from .task_planner import TaskPlannerAgent
from .worker import Worker, SingleAgentWorker
from .task_decomposer import (
    TaskDecomposer,
    SubtaskDefinition,
    TaskDecompositionResult,
)
from .task_assigner import TaskAssigner
from .failure_analyzer import FailureAnalyzer
from .recovery_strategies import RecoveryStrategyExecutor
from .worker_factory import WorkerFactory
# 新增：Eigent 增强功能
from .events import WorkforceEventBus, WorkforceEvent, WorkforceAction
from .context_manager import ContextManager
from .hooks import create_workforce_event_hooks, remove_workforce_event_hooks

__all__ = [
    "RecoveryStrategy",
    "FailureHandlingConfig",
    "TaskAnalysisResult",
    "WorkforceMode",
    "WorkforcePattern",
    "CoordinatorAgent",
    "TaskPlannerAgent",
    "Worker",
    "SingleAgentWorker",
    "TaskDecomposer",
    "SubtaskDefinition",
    "TaskDecompositionResult",
    "TaskAssigner",
    "FailureAnalyzer",
    "RecoveryStrategyExecutor",
    "WorkerFactory",
    # 新增导出
    "WorkforceEventBus",
    "WorkforceEvent",
    "WorkforceAction",
    "ContextManager",
    "create_workforce_event_hooks",
    "remove_workforce_event_hooks",
]
