"""
AgenticX M8.5: 协作框架枚举定义

定义协作模式、冲突解决策略和修复策略等枚举类型。
"""

from enum import Enum
from typing import List


class CollaborationMode(Enum):
    """协作模式枚举"""
    MASTER_SLAVE = "master_slave"      # 主从层次模式
    REFLECTION = "reflection"          # 反思模式
    DEBATE = "debate"                  # 辩论模式
    GROUP_CHAT = "group_chat"          # 群聊模式
    PARALLEL = "parallel"              # 并行化模式
    NESTED = "nested"                  # 嵌套模式
    DYNAMIC = "dynamic"                # 动态添加模式
    ASYNC = "async"                    # 异步协作模式


class ConflictResolutionStrategy(Enum):
    """冲突解决策略枚举"""
    MAJORITY_VOTE = "majority_vote"    # 多数投票
    WEIGHTED_VOTE = "weighted_vote"    # 加权投票
    CONSENSUS = "consensus"            # 共识机制
    HIERARCHICAL = "hierarchical"      # 层次决策
    MEDIATION = "mediation"            # 调解机制
    RANDOM = "random"                  # 随机选择
    FIRST_COME = "first_come"          # 先到先得
    LAST_COME = "last_come"            # 后到先得


class RepairStrategy(Enum):
    """修复策略枚举"""
    NONE = "none"                      # 不修复，直接失败
    SIMPLE = "simple"                  # 简单修复（格式调整）
    LLM_GUIDED = "llm_guided"          # LLM 指导修复
    INTERACTIVE = "interactive"         # 交互式修复
    RETRY = "retry"                    # 重试机制
    FALLBACK = "fallback"              # 降级处理


class CollaborationStatus(Enum):
    """协作状态枚举"""
    INITIALIZING = "initializing"      # 初始化中
    RUNNING = "running"                # 运行中
    PAUSED = "paused"                  # 暂停
    COMPLETED = "completed"            # 已完成
    FAILED = "failed"                  # 失败
    CANCELLED = "cancelled"            # 已取消
    TIMEOUT = "timeout"                # 超时


class MessageType(Enum):
    """消息类型枚举"""
    TASK = "task"                      # 任务消息
    RESULT = "result"                  # 结果消息
    FEEDBACK = "feedback"              # 反馈消息
    ARGUMENT = "argument"              # 辩论论点
    DECISION = "decision"              # 决策消息
    COORDINATION = "coordination"      # 协调消息
    ERROR = "error"                    # 错误消息
    HEARTBEAT = "heartbeat"            # 心跳消息


class AgentRole(Enum):
    """智能体角色枚举"""
    MASTER = "master"                  # 主控智能体
    SLAVE = "slave"                    # 从属智能体
    EXECUTOR = "executor"              # 执行智能体
    REVIEWER = "reviewer"              # 审查智能体
    DEBATER = "debater"                # 辩论智能体
    AGGREGATOR = "aggregator"          # 聚合智能体
    PARTICIPANT = "participant"        # 参与智能体
    WORKER = "worker"                  # 工作智能体
    COORDINATOR = "coordinator"        # 协调智能体
    MEDIATOR = "mediator"              # 调解智能体


def get_collaboration_modes() -> List[CollaborationMode]:
    """获取所有协作模式"""
    return list(CollaborationMode)


def get_conflict_resolution_strategies() -> List[ConflictResolutionStrategy]:
    """获取所有冲突解决策略"""
    return list(ConflictResolutionStrategy)


def get_repair_strategies() -> List[RepairStrategy]:
    """获取所有修复策略"""
    return list(RepairStrategy)


def get_agent_roles() -> List[AgentRole]:
    """获取所有智能体角色"""
    return list(AgentRole) 