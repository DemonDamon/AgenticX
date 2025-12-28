"""
Discovery Module - 发现循环机制

内化自 AgentScope 的动态能力扩展理念

提供 Worker -> Planner 的发现通知能力：
- Worker 在执行任务时发现新工具/API/能力
- 通过 DiscoveryBus 通知 Planner
- Planner 可以动态调整计划以利用新发现

设计原则：
- 松耦合：通过事件总线通信，不直接依赖
- 可追溯：所有发现都有完整记录
- 可操作：发现可以直接转换为计划调整建议
"""

from typing import Optional, Dict, Any, List, Callable, Awaitable, Union
from datetime import datetime, timezone
from enum import Enum
from collections import OrderedDict
import asyncio
import logging
import uuid

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# =============================================================================
# 发现类型枚举
# =============================================================================

class DiscoveryType(str, Enum):
    """发现的类型"""
    TOOL = "tool"           # 新工具
    API = "api"             # 新 API 端点
    CAPABILITY = "capability"  # 新能力
    INSIGHT = "insight"     # 关键洞察
    RESOURCE = "resource"   # 新资源（文件、URL等）
    PATTERN = "pattern"     # 新模式/规律
    ERROR = "error"         # 错误/异常信息


class DiscoveryPriority(str, Enum):
    """发现的优先级"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class DiscoveryStatus(str, Enum):
    """发现的处理状态"""
    PENDING = "pending"     # 待处理
    ACKNOWLEDGED = "acknowledged"  # 已确认
    INTEGRATED = "integrated"  # 已集成到计划
    REJECTED = "rejected"   # 被拒绝
    DEFERRED = "deferred"   # 延后处理


# =============================================================================
# 发现数据模型
# =============================================================================

class Discovery(BaseModel):
    """
    发现记录。
    
    表示 Worker 在执行过程中发现的新能力或信息。
    """
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4())[:8],
        description="发现 ID"
    )
    type: DiscoveryType = Field(
        description="发现类型"
    )
    name: str = Field(
        description="发现的名称"
    )
    description: str = Field(
        description="详细描述"
    )
    source_worker_id: str = Field(
        description="发现者 Worker ID"
    )
    source_task: Optional[str] = Field(
        default=None,
        description="发现时正在执行的任务"
    )
    priority: DiscoveryPriority = Field(
        default=DiscoveryPriority.MEDIUM,
        description="优先级"
    )
    status: DiscoveryStatus = Field(
        default=DiscoveryStatus.PENDING,
        description="处理状态"
    )
    data: Dict[str, Any] = Field(
        default_factory=dict,
        description="发现的详细数据"
    )
    action_suggestions: List[str] = Field(
        default_factory=list,
        description="建议的后续行动"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    processed_at: Optional[str] = Field(
        default=None,
        description="处理时间"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="额外元数据"
    )
    
    def acknowledge(self) -> None:
        """确认发现"""
        self.status = DiscoveryStatus.ACKNOWLEDGED
        self.processed_at = datetime.now(timezone.utc).isoformat()
    
    def integrate(self) -> None:
        """标记为已集成"""
        self.status = DiscoveryStatus.INTEGRATED
        self.processed_at = datetime.now(timezone.utc).isoformat()
    
    def reject(self, reason: str) -> None:
        """拒绝发现"""
        self.status = DiscoveryStatus.REJECTED
        self.processed_at = datetime.now(timezone.utc).isoformat()
        self.metadata["rejection_reason"] = reason
    
    def to_plan_suggestion(self) -> Dict[str, Any]:
        """
        转换为计划调整建议。
        
        Returns:
            可用于 PlanNotebook.revise_current_plan() 的建议
        """
        suggestion = {
            "discovery_id": self.id,
            "discovery_type": self.type,
            "suggested_action": "add" if self.type in [DiscoveryType.TOOL, DiscoveryType.API] else "revise",
            "subtask": {
                "name": f"Utilize: {self.name}",
                "description": f"基于发现 '{self.name}': {self.description}",
                "expected_outcome": f"成功利用新发现的 {self.type}",
            }
        }
        
        if self.action_suggestions:
            suggestion["subtask"]["description"] += f"\n建议行动: {', '.join(self.action_suggestions)}"
        
        return suggestion


# =============================================================================
# 发现事件
# =============================================================================

class DiscoveryEvent(BaseModel):
    """发现事件（用于事件总线）"""
    event_type: str = Field(default="discovery")
    discovery: Discovery
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


# =============================================================================
# 发现总线（Discovery Bus）
# =============================================================================

DiscoveryHandler = Callable[[Discovery], Union[None, Awaitable[None]]]


class DiscoveryBus:
    """
    发现总线 - Worker 和 Planner 之间的发现通信枢纽。
    
    核心功能：
    - Worker 注册发现
    - Planner 订阅发现通知
    - 异步事件分发
    
    使用示例:
    ```python
    bus = DiscoveryBus()
    
    # Planner 订阅发现
    async def handle_discovery(discovery):
        print(f"New discovery: {discovery.name}")
    
    bus.subscribe(handle_discovery, discovery_types=[DiscoveryType.TOOL])
    
    # Worker 报告发现
    await bus.publish(Discovery(
        type=DiscoveryType.TOOL,
        name="GitHub Search API",
        description="发现了 GitHub 的搜索 API",
        source_worker_id="worker-001"
    ))
    ```
    """
    
    def __init__(self, max_history: int = 100):
        """
        初始化发现总线。
        
        Args:
            max_history: 保留的历史发现数量
        """
        self.max_history = max_history
        
        # 订阅者
        self._subscribers: OrderedDict[str, Dict[str, Any]] = OrderedDict()
        
        # 发现历史
        self._discoveries: List[Discovery] = []
        
        # 待处理队列
        self._pending_queue: asyncio.Queue[Discovery] = asyncio.Queue()
        
        # 统计
        self._stats = {
            "total_published": 0,
            "total_processed": 0,
            "by_type": {},
        }
    
    def subscribe(
        self,
        handler: DiscoveryHandler,
        subscriber_id: Optional[str] = None,
        discovery_types: Optional[List[DiscoveryType]] = None,
        priority_filter: Optional[List[DiscoveryPriority]] = None,
    ) -> str:
        """
        订阅发现通知。
        
        Args:
            handler: 处理函数
            subscriber_id: 订阅者 ID（可选，自动生成）
            discovery_types: 只接收指定类型的发现（None 表示全部）
            priority_filter: 只接收指定优先级的发现（None 表示全部）
            
        Returns:
            订阅者 ID
        """
        sub_id = subscriber_id or str(uuid.uuid4())[:8]
        
        self._subscribers[sub_id] = {
            "handler": handler,
            "types": discovery_types,
            "priorities": priority_filter,
        }
        
        logger.debug(f"Subscriber {sub_id} registered for discovery bus")
        return sub_id
    
    def unsubscribe(self, subscriber_id: str) -> bool:
        """
        取消订阅。
        
        Args:
            subscriber_id: 订阅者 ID
            
        Returns:
            是否成功取消
        """
        if subscriber_id in self._subscribers:
            del self._subscribers[subscriber_id]
            return True
        return False
    
    async def publish(self, discovery: Discovery) -> None:
        """
        发布发现（异步通知所有订阅者）。
        
        Args:
            discovery: 发现对象
        """
        # 记录到历史
        self._discoveries.append(discovery)
        if len(self._discoveries) > self.max_history:
            self._discoveries = self._discoveries[-self.max_history:]
        
        # 更新统计
        self._stats["total_published"] += 1
        type_key = discovery.type.value
        self._stats["by_type"][type_key] = self._stats["by_type"].get(type_key, 0) + 1
        
        logger.info(f"Discovery published: [{discovery.type}] {discovery.name}")
        
        # 通知订阅者
        for sub_id, sub_info in self._subscribers.items():
            # 检查类型过滤
            if sub_info["types"] and discovery.type not in sub_info["types"]:
                continue
            
            # 检查优先级过滤
            if sub_info["priorities"] and discovery.priority not in sub_info["priorities"]:
                continue
            
            # 调用处理函数
            handler = sub_info["handler"]
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(discovery)
                else:
                    handler(discovery)
                    
                self._stats["total_processed"] += 1
            except Exception as e:
                logger.error(f"Discovery handler {sub_id} failed: {e}")
    
    def publish_sync(self, discovery: Discovery) -> None:
        """
        发布发现（同步版本，放入队列）。
        
        适用于不在异步上下文中的场景。
        
        Args:
            discovery: 发现对象
        """
        self._pending_queue.put_nowait(discovery)
        logger.debug(f"Discovery queued: {discovery.name}")
    
    async def process_pending(self) -> int:
        """
        处理待处理队列中的发现。
        
        Returns:
            处理的发现数量
        """
        processed = 0
        while not self._pending_queue.empty():
            try:
                discovery = self._pending_queue.get_nowait()
                await self.publish(discovery)
                processed += 1
            except asyncio.QueueEmpty:
                break
        return processed
    
    def get_discoveries(
        self,
        discovery_type: Optional[DiscoveryType] = None,
        status: Optional[DiscoveryStatus] = None,
        limit: int = 50,
    ) -> List[Discovery]:
        """
        获取发现列表。
        
        Args:
            discovery_type: 按类型过滤
            status: 按状态过滤
            limit: 返回数量限制
            
        Returns:
            发现列表
        """
        result = self._discoveries.copy()
        
        if discovery_type:
            result = [d for d in result if d.type == discovery_type]
        
        if status:
            result = [d for d in result if d.status == status]
        
        return result[-limit:]
    
    def get_pending_discoveries(self) -> List[Discovery]:
        """获取所有待处理的发现"""
        return [d for d in self._discoveries if d.status == DiscoveryStatus.PENDING]
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            **self._stats,
            "subscribers_count": len(self._subscribers),
            "history_size": len(self._discoveries),
            "pending_queue_size": self._pending_queue.qsize(),
        }


# =============================================================================
# 发现注册器（供 Worker 使用）
# =============================================================================

class DiscoveryRegistry:
    """
    发现注册器 - 供 Worker 使用的发现报告接口。
    
    提供简化的 API 让 Worker 报告各类发现。
    
    使用示例:
    ```python
    registry = DiscoveryRegistry(bus=discovery_bus, worker_id="worker-001")
    
    # 报告发现的工具
    await registry.register_tool(
        name="GitHub Search API",
        description="可以搜索 GitHub 仓库",
        endpoint="https://api.github.com/search",
    )
    
    # 报告洞察
    await registry.register_insight(
        name="MCP 使用率趋势",
        description="发现 MCP 在 AI Agent 领域的使用率快速增长",
    )
    ```
    """
    
    def __init__(
        self,
        bus: DiscoveryBus,
        worker_id: str,
        current_task: Optional[str] = None,
    ):
        """
        初始化发现注册器。
        
        Args:
            bus: 发现总线
            worker_id: Worker ID
            current_task: 当前正在执行的任务
        """
        self.bus = bus
        self.worker_id = worker_id
        self.current_task = current_task
        self._local_discoveries: List[Discovery] = []
    
    def set_current_task(self, task: str) -> None:
        """设置当前任务"""
        self.current_task = task
    
    async def register_tool(
        self,
        name: str,
        description: str,
        endpoint: Optional[str] = None,
        schema: Optional[Dict[str, Any]] = None,
        priority: DiscoveryPriority = DiscoveryPriority.HIGH,
        **kwargs
    ) -> Discovery:
        """
        注册发现的新工具。
        
        Args:
            name: 工具名称
            description: 工具描述
            endpoint: API 端点（可选）
            schema: 工具 Schema（可选）
            priority: 优先级
            
        Returns:
            创建的 Discovery 对象
        """
        discovery = Discovery(
            type=DiscoveryType.TOOL,
            name=name,
            description=description,
            source_worker_id=self.worker_id,
            source_task=self.current_task,
            priority=priority,
            data={
                "endpoint": endpoint,
                "schema": schema,
                **kwargs,
            },
            action_suggestions=[
                f"将 '{name}' 添加到可用工具列表",
                f"在后续任务中使用此工具",
            ]
        )
        
        await self._register(discovery)
        return discovery
    
    async def register_api(
        self,
        name: str,
        description: str,
        base_url: str,
        endpoints: Optional[List[Dict[str, str]]] = None,
        auth_required: bool = False,
        priority: DiscoveryPriority = DiscoveryPriority.HIGH,
        **kwargs
    ) -> Discovery:
        """
        注册发现的新 API。
        
        Args:
            name: API 名称
            description: API 描述
            base_url: 基础 URL
            endpoints: 端点列表
            auth_required: 是否需要认证
            priority: 优先级
            
        Returns:
            创建的 Discovery 对象
        """
        discovery = Discovery(
            type=DiscoveryType.API,
            name=name,
            description=description,
            source_worker_id=self.worker_id,
            source_task=self.current_task,
            priority=priority,
            data={
                "base_url": base_url,
                "endpoints": endpoints or [],
                "auth_required": auth_required,
                **kwargs,
            },
            action_suggestions=[
                f"为 '{name}' 创建 API 客户端",
                f"测试 API 连通性和可用性",
            ]
        )
        
        await self._register(discovery)
        return discovery
    
    async def register_insight(
        self,
        name: str,
        description: str,
        evidence: Optional[List[str]] = None,
        confidence: float = 0.8,
        priority: DiscoveryPriority = DiscoveryPriority.MEDIUM,
        **kwargs
    ) -> Discovery:
        """
        注册发现的洞察。
        
        Args:
            name: 洞察名称
            description: 洞察描述
            evidence: 支持证据
            confidence: 置信度 (0-1)
            priority: 优先级
            
        Returns:
            创建的 Discovery 对象
        """
        discovery = Discovery(
            type=DiscoveryType.INSIGHT,
            name=name,
            description=description,
            source_worker_id=self.worker_id,
            source_task=self.current_task,
            priority=priority,
            data={
                "evidence": evidence or [],
                "confidence": confidence,
                **kwargs,
            },
            action_suggestions=[
                f"记录洞察到知识库",
                f"考虑基于此洞察调整后续计划",
            ]
        )
        
        await self._register(discovery)
        return discovery
    
    async def register_resource(
        self,
        name: str,
        description: str,
        resource_type: str,
        location: str,
        priority: DiscoveryPriority = DiscoveryPriority.MEDIUM,
        **kwargs
    ) -> Discovery:
        """
        注册发现的资源。
        
        Args:
            name: 资源名称
            description: 资源描述
            resource_type: 资源类型（file/url/repo 等）
            location: 资源位置
            priority: 优先级
            
        Returns:
            创建的 Discovery 对象
        """
        discovery = Discovery(
            type=DiscoveryType.RESOURCE,
            name=name,
            description=description,
            source_worker_id=self.worker_id,
            source_task=self.current_task,
            priority=priority,
            data={
                "resource_type": resource_type,
                "location": location,
                **kwargs,
            },
            action_suggestions=[
                f"获取和分析资源 '{name}'",
            ]
        )
        
        await self._register(discovery)
        return discovery
    
    async def register_error(
        self,
        name: str,
        description: str,
        error_type: str,
        recoverable: bool = True,
        suggested_fix: Optional[str] = None,
        priority: DiscoveryPriority = DiscoveryPriority.HIGH,
        **kwargs
    ) -> Discovery:
        """
        注册发现的错误/异常。
        
        Args:
            name: 错误名称
            description: 错误描述
            error_type: 错误类型
            recoverable: 是否可恢复
            suggested_fix: 建议的修复方法
            priority: 优先级
            
        Returns:
            创建的 Discovery 对象
        """
        actions = []
        if recoverable and suggested_fix:
            actions.append(suggested_fix)
        elif not recoverable:
            actions.append("考虑调整计划绕过此错误")
        
        discovery = Discovery(
            type=DiscoveryType.ERROR,
            name=name,
            description=description,
            source_worker_id=self.worker_id,
            source_task=self.current_task,
            priority=priority,
            data={
                "error_type": error_type,
                "recoverable": recoverable,
                "suggested_fix": suggested_fix,
                **kwargs,
            },
            action_suggestions=actions
        )
        
        await self._register(discovery)
        return discovery
    
    async def _register(self, discovery: Discovery) -> None:
        """内部注册方法"""
        self._local_discoveries.append(discovery)
        await self.bus.publish(discovery)
    
    def get_local_discoveries(self) -> List[Discovery]:
        """获取此 Worker 的所有发现"""
        return self._local_discoveries.copy()


# =============================================================================
# 全局发现总线（单例）
# =============================================================================

_global_discovery_bus: Optional[DiscoveryBus] = None


def get_discovery_bus() -> DiscoveryBus:
    """获取全局发现总线实例"""
    global _global_discovery_bus
    if _global_discovery_bus is None:
        _global_discovery_bus = DiscoveryBus()
    return _global_discovery_bus


def reset_discovery_bus() -> None:
    """重置全局发现总线（主要用于测试）"""
    global _global_discovery_bus
    _global_discovery_bus = None

