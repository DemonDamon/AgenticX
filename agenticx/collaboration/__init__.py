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
from .config import (
    CollaborationConfig, 
    CollaborationManagerConfig, 
    CollaborationMemoryConfig,
    RolePlayingConfig,
)
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
from .role_playing import RolePlayingPattern
from .manager import CollaborationManager
from .memory import CollaborationMemory, CollaborationEvent
from .metrics import CollaborationMetrics, EfficiencyMetrics, ContributionMetrics
# 新增：对话管理
from .conversation import ConversationManager, ConversationEntry
# 新增：TaskLock（Eigent 兼容）
from .task_lock import TaskLock, TaskStatus, Action, ActionData, get_or_create_task_lock, remove_task_lock

__all__ = [
    # 枚举和配置
    'CollaborationMode',
    'ConflictResolutionStrategy', 
    'RepairStrategy',
    'CollaborationConfig',
    'CollaborationManagerConfig',
    'CollaborationMemoryConfig',
    'RolePlayingConfig',
    
    # 基础抽象
    'BaseCollaborationPattern',
    'CollaborationResult',
    'CollaborationState',
    
    # 协作模式（已实现）
    'MasterSlavePattern',
    'ReflectionPattern',
    'RolePlayingPattern',
    
    # 管理服务
    'CollaborationManager',
    'CollaborationMemory',
    'CollaborationEvent',
    'CollaborationMetrics',
    'EfficiencyMetrics',
    'ContributionMetrics',
    
    # 对话管理（新增）
    'ConversationManager',
    'ConversationEntry',
    
    # TaskLock（Eigent 兼容）
    'TaskLock',
    'TaskStatus',
    'Action',
    'ActionData',
    'get_or_create_task_lock',
    'remove_task_lock',
]

__version__ = "0.2.1" 