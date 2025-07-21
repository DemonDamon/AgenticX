"""
AgenticX M8.5: 协作框架配置模型

定义协作配置和管理器配置等数据模型。
"""

from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field
from .enums import CollaborationMode, ConflictResolutionStrategy, RepairStrategy


class CollaborationConfig(BaseModel):
    """协作配置模型"""
    mode: CollaborationMode = Field(description="协作模式")
    max_iterations: int = Field(default=5, description="最大迭代次数")
    timeout: float = Field(default=300.0, description="超时时间（秒）")
    enable_memory_sharing: bool = Field(default=True, description="启用记忆共享")
    enable_context_sharing: bool = Field(default=True, description="启用上下文共享")
    conflict_resolution_strategy: ConflictResolutionStrategy = Field(
        default=ConflictResolutionStrategy.CONSENSUS,
        description="冲突解决策略"
    )
    repair_strategy: RepairStrategy = Field(
        default=RepairStrategy.LLM_GUIDED,
        description="修复策略"
    )
    max_repair_attempts: int = Field(default=3, description="最大修复尝试次数")
    enable_metrics: bool = Field(default=True, description="启用指标收集")
    enable_logging: bool = Field(default=True, description="启用日志记录")
    custom_config: Optional[Dict[str, Any]] = Field(default=None, description="自定义配置")


class CollaborationManagerConfig(BaseModel):
    """协作管理器配置模型"""
    default_timeout: float = Field(default=300.0, description="默认超时时间")
    max_concurrent_collaborations: int = Field(default=10, description="最大并发协作数")
    enable_auto_optimization: bool = Field(default=True, description="启用自动优化")
    enable_conflict_resolution: bool = Field(default=True, description="启用冲突解决")
    enable_metrics_collection: bool = Field(default=True, description="启用指标收集")
    enable_memory_persistence: bool = Field(default=True, description="启用记忆持久化")
    log_level: str = Field(default="INFO", description="日志级别")
    storage_backend: str = Field(default="memory", description="存储后端")
    custom_config: Optional[Dict[str, Any]] = Field(default=None, description="自定义配置")


class CollaborationMemoryConfig(BaseModel):
    """协作记忆配置模型"""
    max_events: int = Field(default=10000, description="最大事件数量")
    retention_days: int = Field(default=30, description="保留天数")
    enable_pattern_analysis: bool = Field(default=True, description="启用模式分析")
    enable_agent_memory: bool = Field(default=True, description="启用智能体记忆")
    enable_search: bool = Field(default=True, description="启用搜索功能")
    export_format: str = Field(default="json", description="导出格式")
    custom_config: Optional[Dict[str, Any]] = Field(default=None, description="自定义配置")


class PatternConfig(BaseModel):
    """模式特定配置"""
    pattern_type: CollaborationMode = Field(description="模式类型")
    config: CollaborationConfig = Field(description="协作配置")
    agent_roles: Dict[str, str] = Field(default_factory=dict, description="智能体角色映射")
    custom_params: Optional[Dict[str, Any]] = Field(default=None, description="自定义参数")


class MasterSlaveConfig(CollaborationConfig):
    """主从模式配置"""
    master_agent_id: str = Field(description="主控智能体ID")
    slave_agent_ids: List[str] = Field(description="从属智能体ID列表")
    enable_hierarchical_planning: bool = Field(default=True, description="启用层次规划")
    enable_result_aggregation: bool = Field(default=True, description="启用结果聚合")


class ReflectionConfig(CollaborationConfig):
    """反思模式配置"""
    executor_agent_id: str = Field(description="执行智能体ID")
    reviewer_agent_id: str = Field(description="审查智能体ID")
    max_reflection_rounds: int = Field(default=3, description="最大反思轮次")
    reflection_threshold: float = Field(default=0.8, description="反思阈值")
    enable_iterative_improvement: bool = Field(default=True, description="启用迭代改进")


class DebateConfig(CollaborationConfig):
    """辩论模式配置"""
    debater_agent_ids: List[str] = Field(description="辩论智能体ID列表")
    aggregator_agent_id: str = Field(description="聚合智能体ID")
    max_debate_rounds: int = Field(default=5, description="最大辩论轮次")
    voting_mechanism: str = Field(default="weighted", description="投票机制")
    enable_argument_generation: bool = Field(default=True, description="启用论点生成")


class GroupChatConfig(CollaborationConfig):
    """群聊模式配置"""
    participant_agent_ids: List[str] = Field(description="参与智能体ID列表")
    max_turn_time: float = Field(default=60.0, description="最大轮次时间")
    enable_dynamic_routing: bool = Field(default=True, description="启用动态路由")
    enable_async_messaging: bool = Field(default=True, description="启用异步消息")
    enable_discussion_summary: bool = Field(default=True, description="启用讨论总结")


class ParallelConfig(CollaborationConfig):
    """并行模式配置"""
    worker_agent_ids: List[str] = Field(description="工作智能体ID列表")
    max_workers: int = Field(default=5, description="最大工作智能体数")
    enable_task_decomposition: bool = Field(default=True, description="启用任务分解")
    enable_result_aggregation: bool = Field(default=True, description="启用结果聚合")
    load_balancing_strategy: str = Field(default="round_robin", description="负载均衡策略")


class NestedConfig(CollaborationConfig):
    """嵌套模式配置"""
    sub_patterns: List[PatternConfig] = Field(description="子模式配置列表")
    enable_workflow_composition: bool = Field(default=True, description="启用工作流组合")
    enable_optimization: bool = Field(default=True, description="启用优化")
    composition_strategy: str = Field(default="sequential", description="组合策略")


class DynamicConfig(CollaborationConfig):
    """动态模式配置"""
    base_agent_ids: List[str] = Field(description="基础智能体ID列表")
    enable_agent_creation: bool = Field(default=True, description="启用智能体创建")
    enable_agent_integration: bool = Field(default=True, description="启用智能体集成")
    enable_dependency_management: bool = Field(default=True, description="启用依赖管理")
    max_dynamic_agents: int = Field(default=10, description="最大动态智能体数")


class AsyncConfig(CollaborationConfig):
    """异步模式配置"""
    agent_ids: List[str] = Field(description="智能体ID列表")
    shared_memory_config: Dict[str, Any] = Field(default_factory=dict, description="共享内存配置")
    enable_event_handling: bool = Field(default=True, description="启用事件处理")
    enable_state_sync: bool = Field(default=True, description="启用状态同步")
    enable_conflict_resolution: bool = Field(default=True, description="启用冲突解决")


def create_pattern_config(
    mode: CollaborationMode,
    **kwargs
) -> CollaborationConfig:
    """根据模式创建对应的配置"""
    config_classes = {
        CollaborationMode.MASTER_SLAVE: MasterSlaveConfig,
        CollaborationMode.REFLECTION: ReflectionConfig,
        CollaborationMode.DEBATE: DebateConfig,
        CollaborationMode.GROUP_CHAT: GroupChatConfig,
        CollaborationMode.PARALLEL: ParallelConfig,
        CollaborationMode.NESTED: NestedConfig,
        CollaborationMode.DYNAMIC: DynamicConfig,
        CollaborationMode.ASYNC: AsyncConfig,
    }
    
    config_class = config_classes.get(mode, CollaborationConfig)
    return config_class(mode=mode, **kwargs) 