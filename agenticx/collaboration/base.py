"""
AgenticX M8.5: 协作框架基础抽象类

定义协作模式抽象基类、结果模型和状态模型。
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Union
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

from ..core.agent import Agent
from ..core.task import Task
from .config import CollaborationConfig
from .enums import CollaborationStatus, MessageType, AgentRole


class CollaborationEvent(BaseModel):
    """协作事件模型"""
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="事件ID")
    event_type: str = Field(description="事件类型")
    source_agent_id: str = Field(description="源智能体ID")
    target_agent_id: Optional[str] = Field(default=None, description="目标智能体ID")
    data: Dict[str, Any] = Field(default_factory=dict, description="事件数据")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class CollaborationPattern(BaseModel):
    """协作模式模型"""
    pattern_type: str = Field(description="模式类型")
    frequency: float = Field(description="频率")
    participants: List[str] = Field(default_factory=list, description="参与者")
    average_interval: float = Field(description="平均间隔")
    total_events: int = Field(description="总事件数")
    first_occurrence: datetime = Field(description="首次出现时间")
    last_occurrence: datetime = Field(description="最后出现时间")


class CollaborationResult(BaseModel):
    """协作结果模型"""
    collaboration_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="协作ID")
    success: bool = Field(description="是否成功")
    result: Optional[Any] = Field(default=None, description="协作结果")
    error: Optional[str] = Field(default=None, description="错误信息")
    execution_time: float = Field(description="执行时间（秒）")
    iteration_count: int = Field(default=0, description="迭代次数")
    agent_contributions: Dict[str, Any] = Field(default_factory=dict, description="智能体贡献")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")


class CollaborationState(BaseModel):
    """协作状态模型"""
    collaboration_id: str = Field(description="协作ID")
    status: CollaborationStatus = Field(description="协作状态")
    current_iteration: int = Field(default=0, description="当前迭代次数")
    agent_states: Dict[str, Dict[str, Any]] = Field(default_factory=dict, description="智能体状态")
    shared_context: Dict[str, Any] = Field(default_factory=dict, description="共享上下文")
    messages: List[Dict[str, Any]] = Field(default_factory=list, description="消息历史")
    start_time: datetime = Field(default_factory=datetime.now, description="开始时间")
    last_update: datetime = Field(default_factory=datetime.now, description="最后更新时间")


class SubTask(BaseModel):
    """子任务模型"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="子任务ID")
    description: str = Field(description="任务描述")
    agent_id: str = Field(description="负责智能体ID")
    dependencies: List[str] = Field(default_factory=list, description="依赖的子任务ID")
    priority: int = Field(default=1, description="优先级")
    estimated_time: float = Field(default=60.0, description="预估时间（秒）")
    status: str = Field(default="pending", description="状态")


class TaskResult(BaseModel):
    """任务结果模型"""
    task_id: str = Field(description="任务ID")
    agent_id: str = Field(description="执行智能体ID")
    success: bool = Field(description="是否成功")
    result: Optional[Any] = Field(default=None, description="任务结果")
    error: Optional[str] = Field(default=None, description="错误信息")
    execution_time: float = Field(description="执行时间（秒）")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")


class Feedback(BaseModel):
    """反馈模型"""
    reviewer_id: str = Field(description="审查智能体ID")
    target_result: str = Field(description="目标结果ID")
    score: float = Field(description="评分")
    comments: str = Field(description="评论")
    suggestions: List[str] = Field(default_factory=list, description="建议")
    confidence: float = Field(default=1.0, description="置信度")


class Argument(BaseModel):
    """辩论论点模型"""
    debater_id: str = Field(description="辩论智能体ID")
    topic: str = Field(description="辩论主题")
    position: str = Field(description="立场")
    reasoning: str = Field(description="推理过程")
    evidence: List[str] = Field(default_factory=list, description="证据")
    confidence: float = Field(default=1.0, description="置信度")


class DebateRound(BaseModel):
    """辩论轮次模型"""
    round_number: int = Field(description="轮次编号")
    arguments: List[Argument] = Field(default_factory=list, description="论点列表")
    responses: List[Dict[str, Any]] = Field(default_factory=list, description="回应列表")
    round_time: float = Field(description="轮次时间（秒）")


class FinalDecision(BaseModel):
    """最终决策模型"""
    decision: str = Field(description="决策内容")
    confidence: float = Field(description="置信度")
    voting_results: Dict[str, Any] = Field(default_factory=dict, description="投票结果")
    reasoning: str = Field(description="决策推理")


class Message(BaseModel):
    """消息模型"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="消息ID")
    sender_id: str = Field(description="发送者ID")
    recipient_id: Optional[str] = Field(default=None, description="接收者ID")
    message_type: MessageType = Field(description="消息类型")
    content: str = Field(description="消息内容")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class ChatContext(BaseModel):
    """聊天上下文模型"""
    topic: str = Field(description="讨论主题")
    participants: List[str] = Field(description="参与者ID列表")
    messages: List[Message] = Field(default_factory=list, description="消息列表")
    current_speaker: Optional[str] = Field(default=None, description="当前发言者")
    turn_order: List[str] = Field(default_factory=list, description="发言顺序")


class DiscussionSummary(BaseModel):
    """讨论总结模型"""
    topic: str = Field(description="讨论主题")
    key_points: List[str] = Field(default_factory=list, description="关键点")
    conclusions: List[str] = Field(default_factory=list, description="结论")
    action_items: List[str] = Field(default_factory=list, description="行动项")
    participant_contributions: Dict[str, int] = Field(default_factory=dict, description="参与者贡献")


class AgentRequirement(BaseModel):
    """智能体需求模型"""
    role: AgentRole = Field(description="所需角色")
    skills: List[str] = Field(default_factory=list, description="所需技能")
    constraints: Dict[str, Any] = Field(default_factory=dict, description="约束条件")
    priority: int = Field(default=1, description="优先级")


class DependencyGraph(BaseModel):
    """依赖图模型"""
    nodes: List[str] = Field(description="节点ID列表")
    edges: List[Dict[str, str]] = Field(default_factory=list, description="边列表")
    dependencies: Dict[str, List[str]] = Field(default_factory=dict, description="依赖关系")


class AsyncEvent(BaseModel):
    """异步事件模型"""
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="事件ID")
    event_type: str = Field(description="事件类型")
    source_agent_id: str = Field(description="源智能体ID")
    target_agent_id: Optional[str] = Field(default=None, description="目标智能体ID")
    data: Dict[str, Any] = Field(default_factory=dict, description="事件数据")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class SharedState(BaseModel):
    """共享状态模型"""
    state_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="状态ID")
    data: Dict[str, Any] = Field(default_factory=dict, description="状态数据")
    version: int = Field(default=1, description="版本号")
    last_updated: datetime = Field(default_factory=datetime.now, description="最后更新时间")
    updated_by: str = Field(description="更新者ID")


class Conflict(BaseModel):
    """冲突模型"""
    conflict_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="冲突ID")
    conflict_type: str = Field(description="冲突类型")
    involved_agents: List[str] = Field(description="涉及的智能体ID")
    description: str = Field(description="冲突描述")
    severity: str = Field(default="medium", description="严重程度")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class Resolution(BaseModel):
    """解决方案模型"""
    resolution_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="解决方案ID")
    conflict_id: str = Field(description="冲突ID")
    strategy: str = Field(description="解决策略")
    solution: str = Field(description="解决方案")
    resolved_by: str = Field(description="解决者ID")
    timestamp: datetime = Field(default_factory=datetime.now, description="时间戳")


class BaseCollaborationPattern(ABC):
    """协作模式抽象基类"""
    
    def __init__(self, agents: List[Agent], config: CollaborationConfig):
        """
        初始化协作模式
        
        Args:
            agents: 智能体列表
            config: 协作配置
        """
        self.agents = agents
        self.config = config
        self.collaboration_id = str(uuid.uuid4())
        self.state = CollaborationState(
            collaboration_id=self.collaboration_id,
            status=CollaborationStatus.INITIALIZING
        )
        self._initialize_agents()
    
    def _initialize_agents(self):
        """初始化智能体"""
        for agent in self.agents:
            self.state.agent_states[agent.id] = {
                "status": "ready",
                "role": "participant",
                "last_activity": datetime.now()
            }
    
    @abstractmethod
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行协作任务
        
        Args:
            task: 任务描述
            **kwargs: 额外参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        pass
    
    def get_collaboration_state(self) -> CollaborationState:
        """
        获取协作状态
        
        Returns:
            CollaborationState: 协作状态
        """
        return self.state
    
    def add_agent(self, agent: Agent) -> bool:
        """
        添加智能体
        
        Args:
            agent: 要添加的智能体
            
        Returns:
            bool: 是否成功添加
        """
        if agent not in self.agents:
            self.agents.append(agent)
            self.state.agent_states[agent.id] = {
                "status": "ready",
                "role": "participant",
                "last_activity": datetime.now()
            }
            return True
        return False
    
    def remove_agent(self, agent_id: str) -> bool:
        """
        移除智能体
        
        Args:
            agent_id: 要移除的智能体ID
            
        Returns:
            bool: 是否成功移除
        """
        for i, agent in enumerate(self.agents):
            if agent.id == agent_id:
                self.agents.pop(i)
                if agent_id in self.state.agent_states:
                    del self.state.agent_states[agent_id]
                return True
        return False
    
    def update_state(self, **kwargs):
        """更新协作状态"""
        self.state.last_update = datetime.now()
        for key, value in kwargs.items():
            if hasattr(self.state, key):
                setattr(self.state, key, value)
    
    def log_message(self, sender_id: str, content: str, message_type: MessageType = MessageType.COORDINATION):
        """记录消息"""
        message = Message(
            sender_id=sender_id,
            message_type=message_type,
            content=content
        )
        self.state.messages.append(message.dict())
    
    def get_agent_by_id(self, agent_id: str) -> Optional[Agent]:
        """根据ID获取智能体"""
        for agent in self.agents:
            if agent.id == agent_id:
                return agent
        return None
    
    def get_agents_by_role(self, role: str) -> List[Agent]:
        """根据角色获取智能体"""
        return [agent for agent in self.agents if agent.role == role] 