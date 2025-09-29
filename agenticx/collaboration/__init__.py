"""
AgenticX M8.5: 多智能体协作框架模块 (Multi-Agent Collaboration Framework)

本模块实现了8种核心协作模式，支持从简单任务分发到复杂团队协作的全场景覆盖。
核心理念：基于MAS系统中8种核心协作模式，构建全面的多智能体协作框架。

主要组件：
- CollaborationMode: 协作模式枚举
- BaseCollaborationPattern: 协作模式抽象基类
- CollaborationConfig: 协作配置模型
- 8种核心协作模式实现
- CollaborationManager: 协作管理器
- CollaborationMemory: 协作记忆系统
- CollaborationMetrics: 协作指标收集器
"""

from .enums import CollaborationMode, ConflictResolutionStrategy, RepairStrategy
from .config import CollaborationConfig, CollaborationManagerConfig, CollaborationMemoryConfig
from .base import BaseCollaborationPattern, CollaborationResult, CollaborationState
# 协作模式
from .patterns import (
    BaseCollaborationPattern,
    MasterSlavePattern,
    ReflectionPattern,
    DebatePattern,
    GroupChatPattern,
    ParallelPattern,
    NestedPattern,
    DynamicPattern,
    AsyncPattern,
)
from .manager import CollaborationManager
from .memory import CollaborationMemory, CollaborationEvent
from .metrics import CollaborationMetrics, EfficiencyMetrics, ContributionMetrics

__all__ = [
    # 枚举和配置
    'CollaborationMode',
    'ConflictResolutionStrategy', 
    'RepairStrategy',
    'CollaborationConfig',
    'CollaborationManagerConfig',
    'CollaborationMemoryConfig',
    
    # 基础抽象
    'BaseCollaborationPattern',
    'CollaborationResult',
    'CollaborationState',
    
    # 协作模式（已实现）
    'MasterSlavePattern',
    'ReflectionPattern',
    
    # 管理服务
    'CollaborationManager',
    'CollaborationMemory',
    'CollaborationEvent',
    'CollaborationMetrics',
    'EfficiencyMetrics',
    'ContributionMetrics'
]

__version__ = "0.1.3" 