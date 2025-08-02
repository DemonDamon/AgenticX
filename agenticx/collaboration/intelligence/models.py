"""M8.5 协作框架智能调度的数据模型

定义智能体能力、协作上下文、角色分配等核心数据结构。
"""

from enum import Enum
from typing import List, Dict, Any, Optional, Set
from datetime import datetime
from pydantic import BaseModel, Field


class AgentCapability(BaseModel):
    """智能体能力模型"""
    name: str = Field(description="能力名称")
    level: int = Field(1, ge=1, le=10, description="能力等级 1-10")
    domain: str = Field(description="能力领域")
    description: str = Field(description="能力描述")
    prerequisites: List[str] = Field(default_factory=list, description="前置能力要求")
    resource_cost: float = Field(0.0, description="资源消耗")
    execution_time: float = Field(0.0, description="预估执行时间")


class AgentStatus(str, Enum):
    """智能体状态枚举"""
    IDLE = "idle"              # 空闲
    BUSY = "busy"              # 忙碌
    OVERLOADED = "overloaded"  # 过载
    OFFLINE = "offline"        # 离线
    ERROR = "error"            # 错误状态


class TaskPriority(str, Enum):
    """任务优先级枚举"""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"
    CRITICAL = "critical"


class MessagePriority(str, Enum):
    """消息优先级枚举"""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"
    CRITICAL = "critical"
    BROADCAST = "broadcast"


class CollaborationContext(BaseModel):
    """协作上下文模型"""
    session_id: str = Field(description="协作会话ID")
    participants: List[str] = Field(description="参与者ID列表")
    current_phase: str = Field(description="当前协作阶段")
    shared_state: Dict[str, Any] = Field(default_factory=dict, description="共享状态")
    constraints: Dict[str, Any] = Field(default_factory=dict, description="协作约束")
    objectives: List[str] = Field(description="协作目标")
    deadline: Optional[datetime] = Field(None, description="截止时间")
    priority: TaskPriority = Field(TaskPriority.NORMAL, description="任务优先级")
    resource_budget: Dict[str, float] = Field(default_factory=dict, description="资源预算")


class AgentProfile(BaseModel):
    """智能体档案模型"""
    agent_id: str = Field(description="智能体ID")
    name: str = Field(description="智能体名称")
    capabilities: List[AgentCapability] = Field(description="能力列表")
    current_status: AgentStatus = Field(AgentStatus.IDLE, description="当前状态")
    current_load: float = Field(0.0, ge=0.0, le=1.0, description="当前负载 0.0-1.0")
    max_concurrent_tasks: int = Field(1, description="最大并发任务数")
    performance_history: Dict[str, float] = Field(default_factory=dict, description="历史性能数据")
    specializations: List[str] = Field(default_factory=list, description="专业领域")
    collaboration_preferences: Dict[str, Any] = Field(default_factory=dict, description="协作偏好")
    last_active: datetime = Field(default_factory=datetime.now, description="最后活跃时间")


class RoleAssignment(BaseModel):
    """角色分配模型"""
    agent_id: str = Field(description="智能体ID")
    session_id: Optional[str] = Field(None, description="会话ID")
    assignment_id: Optional[str] = Field(None, description="分配ID")
    role: str = Field(description="分配的角色")
    role_name: Optional[str] = Field(None, description="角色名称")
    role_description: Optional[str] = Field(None, description="角色描述")
    responsibilities: List[str] = Field(description="职责列表")
    authority_level: int = Field(1, ge=1, le=5, description="权限等级")
    expected_workload: float = Field(description="预期工作量")
    assignment_reason: str = Field(description="分配理由")
    confidence_score: float = Field(ge=0.0, le=1.0, description="分配置信度")
    assignment_score: Optional[float] = Field(None, description="分配分数")
    assignment_time: Optional[datetime] = Field(None, description="分配时间")
    start_time: datetime = Field(default_factory=datetime.now, description="开始时间")
    estimated_duration: Optional[float] = Field(None, description="预估持续时间")
    status: Optional[str] = Field("active", description="分配状态")
    end_time: Optional[datetime] = Field(None, description="结束时间")
    reassignment_reason: Optional[str] = Field(None, description="重新分配原因")


class RoutingDecision(BaseModel):
    """路由决策模型"""
    message_id: str = Field(description="消息ID")
    source_agent: str = Field(description="源智能体")
    target_agents: List[str] = Field(description="目标智能体列表")
    routing_strategy: str = Field(description="路由策略")
    priority: MessagePriority = Field(description="消息优先级")
    delivery_mode: str = Field("direct", description="传递模式")
    expected_latency: float = Field(description="预期延迟")
    reasoning: str = Field(description="路由理由")
    confidence: float = Field(ge=0.0, le=1.0, description="决策置信度")
    timestamp: datetime = Field(default_factory=datetime.now, description="决策时间")


class CollaborationMetrics(BaseModel):
    """协作指标模型"""
    session_id: str = Field(description="会话ID")
    total_participants: int = Field(description="总参与者数")
    active_participants: int = Field(description="活跃参与者数")
    message_count: int = Field(description="消息总数")
    task_completion_rate: float = Field(ge=0.0, le=1.0, description="任务完成率")
    average_response_time: float = Field(description="平均响应时间")
    collaboration_efficiency: float = Field(ge=0.0, le=1.0, description="协作效率")
    resource_utilization: Dict[str, float] = Field(default_factory=dict, description="资源利用率")
    bottlenecks: List[str] = Field(default_factory=list, description="瓶颈列表")
    quality_score: float = Field(ge=0.0, le=1.0, description="协作质量分数")
    timestamp: datetime = Field(default_factory=datetime.now, description="指标时间")


class TaskAllocation(BaseModel):
    """任务分配模型"""
    task_id: str = Field(description="任务ID")
    assigned_agent: str = Field(description="分配的智能体")
    estimated_effort: float = Field(description="预估工作量")
    deadline: Optional[datetime] = Field(None, description="截止时间")
    dependencies: List[str] = Field(default_factory=list, description="依赖任务")
    required_capabilities: List[str] = Field(description="所需能力")
    allocation_score: float = Field(ge=0.0, le=1.0, description="分配得分")
    backup_agents: List[str] = Field(default_factory=list, description="备选智能体")


class CollaborationPattern(BaseModel):
    """协作模式模型"""
    pattern_name: str = Field(description="模式名称")
    description: str = Field(description="模式描述")
    applicable_scenarios: List[str] = Field(description="适用场景")
    required_roles: List[str] = Field(description="所需角色")
    communication_flow: Dict[str, List[str]] = Field(description="通信流程")
    success_criteria: List[str] = Field(description="成功标准")
    typical_duration: float = Field(description="典型持续时间")
    complexity_level: int = Field(1, ge=1, le=5, description="复杂度等级")


class PerformanceMetrics(BaseModel):
    """性能指标模型"""
    agent_id: str = Field(description="智能体ID")
    task_success_rate: float = Field(ge=0.0, le=1.0, description="任务成功率")
    average_completion_time: float = Field(description="平均完成时间")
    quality_score: float = Field(ge=0.0, le=1.0, description="质量分数")
    collaboration_rating: float = Field(ge=0.0, le=1.0, description="协作评分")
    reliability_score: float = Field(ge=0.0, le=1.0, description="可靠性分数")
    learning_progress: float = Field(ge=0.0, description="学习进度")
    specialization_depth: Dict[str, float] = Field(default_factory=dict, description="专业化深度")
    measurement_period: str = Field(description="测量周期")
    last_updated: datetime = Field(default_factory=datetime.now, description="最后更新时间")


class ConflictResolution(BaseModel):
    """冲突解决模型"""
    conflict_id: str = Field(description="冲突ID")
    conflict_type: str = Field(description="冲突类型")
    involved_agents: List[str] = Field(description="涉及的智能体")
    conflict_description: str = Field(description="冲突描述")
    resolution_strategy: str = Field(description="解决策略")
    resolution_steps: List[str] = Field(description="解决步骤")
    mediator_agent: Optional[str] = Field(None, description="调解智能体")
    resolution_time: Optional[datetime] = Field(None, description="解决时间")
    outcome: Optional[str] = Field(None, description="解决结果")
    lessons_learned: List[str] = Field(default_factory=list, description="经验教训")


class AdaptationRule(BaseModel):
    """适应性规则模型"""
    rule_id: str = Field(description="规则ID")
    condition: str = Field(description="触发条件")
    action: str = Field(description="执行动作")
    priority: int = Field(1, description="规则优先级")
    enabled: bool = Field(True, description="是否启用")
    success_count: int = Field(0, description="成功执行次数")
    failure_count: int = Field(0, description="失败执行次数")
    last_triggered: Optional[datetime] = Field(None, description="最后触发时间")
    effectiveness_score: float = Field(0.5, ge=0.0, le=1.0, description="有效性分数")