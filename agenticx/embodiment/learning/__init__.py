"""人类对齐学习引擎模块

该模块实现了基于人类学习新应用自然过程的GUI智能体学习引擎，
包含应用知识检索、GUI探索、任务合成、深度使用优化、边缘情况处理和知识演化等核心组件。
"""

from agenticx.embodiment.learning.models import (
    AppContext,
    UIPattern,
    ActionTrace,
    ComplexTask,
    TaskPattern,
    Workflow,
    ExecutionLog,
    EfficiencyPattern,
    ExecutionTrace,
    Anomaly,
    EdgeCase,
    RecoveryStrategy,
    Experience,
    Pattern,
    KnowledgeConflict,
    Resolution,
    KnowledgeItem,
    ValidationResult,
    EFSM,
    ReflectionResult
)

from agenticx.embodiment.learning.app_knowledge_retriever import AppKnowledgeRetriever, DefaultAppKnowledgeRetriever
from agenticx.embodiment.learning.gui_explorer import GUIExplorer, DefaultGUIExplorer
from agenticx.embodiment.learning.task_synthesizer import TaskSynthesizer, DefaultTaskSynthesizer
from agenticx.embodiment.learning.deep_usage_optimizer import DeepUsageOptimizer, DefaultDeepUsageOptimizer
from agenticx.embodiment.learning.edge_case_handler import EdgeCaseHandler, DefaultEdgeCaseHandler
from agenticx.embodiment.learning.knowledge_evolution import KnowledgeEvolution, DefaultKnowledgeEvolution

__all__ = [
    # 数据模型
    'AppContext',
    'UIPattern',
    'ActionTrace',
    'ComplexTask',
    'TaskPattern',
    'Workflow',
    'ExecutionLog',
    'EfficiencyPattern',
    'ExecutionTrace',
    'Anomaly',
    'EdgeCase',
    'RecoveryStrategy',
    'Experience',
    'Pattern',
    'KnowledgeConflict',
    'Resolution',
    'KnowledgeItem',
    'ValidationResult',
    'EFSM',
    'ReflectionResult',
    
    # 核心组件
    'AppKnowledgeRetriever',
    'GUIExplorer',
    'TaskSynthesizer',
    'DeepUsageOptimizer',
    'EdgeCaseHandler',
    'KnowledgeEvolution',
]