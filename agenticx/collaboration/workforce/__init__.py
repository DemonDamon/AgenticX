"""
AgenticX Workforce 模块

内化自 CAMEL-AI 的 Workforce 编排系统，实现智能任务分解和故障恢复机制。

参考：
- CAMEL-AI: camel/societies/workforce/workforce.py
- License: Apache 2.0 (CAMEL-AI.org)
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
]
