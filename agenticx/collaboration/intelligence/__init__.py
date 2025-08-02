"""M8.5 多智能体协作框架智能调度优化模块

提供智能协作调度、动态角色分配、语义消息路由等高级功能。
"""

from .collaboration_intelligence import CollaborationIntelligence
from .role_assigner import DynamicRoleAssigner
from .message_router import SemanticMessageRouter
from .models import (
    AgentCapability,
    CollaborationContext,
    RoleAssignment,
    MessagePriority,
    RoutingDecision,
    CollaborationMetrics
)

__all__ = [
    "CollaborationIntelligence",
    "DynamicRoleAssigner",
    "SemanticMessageRouter",
    "AgentCapability",
    "CollaborationContext",
    "RoleAssignment",
    "MessagePriority",
    "RoutingDecision",
    "CollaborationMetrics"
]