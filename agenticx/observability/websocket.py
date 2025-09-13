"""
AgenticX M9: WebSocket实时监控 (WebSocket Real-time Monitoring)

本模块实现了基于WebSocket的实时事件推送功能，支持前端实时监控和可视化。
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional, Set, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import uuid
import websockets
import threading
from collections import deque

from .callbacks import BaseCallbackHandler, CallbackHandlerConfig
from ..core.event import AnyEvent, TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent
from ..core.agent import Agent
from ..core.task import Task
from ..core.workflow import Workflow
from ..llms.response import LLMResponse


logger = logging.getLogger(__name__)


class EventStreamType(Enum):
    """事件流类型"""
    ALL = "all"
    TASKS = "tasks"
    TOOLS = "tools"
    LLMS = "llms"
    ERRORS = "errors"
    MONITORING = "monitoring"


@dataclass
class WebSocketClient:
    """WebSocket客户端"""
    client_id: str
    websocket: Any
    subscriptions: Set[EventStreamType] = field(default_factory=set)
    filters: Dict[str, Any] = field(default_factory=dict)
    connected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_ping: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "client_id": self.client_id,
            "subscriptions": [sub.value for sub in self.subscriptions],
            "filters": self.filters,
            "connected_at": self.connected_at.isoformat(),
            "last_ping": self.last_ping.isoformat()
        }


@dataclass
class EventMessage:
    """事件消息"""
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str = ""
    event_data: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    source: str = "agenticx"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "message_id": self.message_id,
            "event_type": self.event_type,
            "event_data": self.event_data,
            "timestamp": self.timestamp.isoformat(),
            "source": self.source
        }
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


class EventStream:
    """
    事件流管理器
    
    管理WebSocket连接和事件分发。
    """
    
    def __init__(self, max_clients: int = 100, max_message_queue: int = 1000):
        self.max_clients = max_clients
        self.max_message_queue = max_message_queue
        
        # 客户端管理
        self.clients: Dict[str, WebSocketClient] = {}
        self.client_lock = threading.Lock()
        
        # 消息队列
        self.message_queue: deque = deque(maxlen=max_message_queue)
        self.message_lock = threading.Lock()
        
        # 统计信息
        self.stats = {
            "total_clients_connected": 0,
            "messages_sent": 0,
            "messages_failed": 0,
            "start_time": datetime.now(UTC)
        }
        
        # 心跳检查
        self.heartbeat_interval = 30.0  # 30秒
        self.heartbeat_task: Optional[asyncio.Task] = None
        
    def add_client(self, client_id: str, websocket: Any, subscriptions: Optional[List[EventStreamType]] = None) -> WebSocketClient:
        """添加客户端"""
        with self.client_lock:
            if len(self.clients) >= self.max_clients:
                raise ValueError("客户端数量已达到上限")
            
            client = WebSocketClient(
                client_id=client_id,
                websocket=websocket,
                subscriptions=set(subscriptions or [EventStreamType.ALL])
            )
            
            self.clients[client_id] = client
            self.stats["total_clients_connected"] += 1
            
            logger.info(f"客户端 {client_id} 已连接")
            return client
    
    def remove_client(self, client_id: str):
        """移除客户端"""
        with self.client_lock:
            if client_id in self.clients:
                del self.clients[client_id]
                logger.info(f"客户端 {client_id} 已断开连接")
    
    def update_client_subscriptions(self, client_id: str, subscriptions: List[EventStreamType]):
        """更新客户端订阅"""
        with self.client_lock:
            if client_id in self.clients:
                self.clients[client_id].subscriptions = set(subscriptions)
                logger.info(f"客户端 {client_id} 订阅已更新: {subscriptions}")
    
    def update_client_filters(self, client_id: str, filters: Dict[str, Any]):
        """更新客户端过滤器"""
        with self.client_lock:
            if client_id in self.clients:
                self.clients[client_id].filters = filters
                logger.info(f"客户端 {client_id} 过滤器已更新: {filters}")
    
    async def broadcast_event(self, event_message: EventMessage):
        """广播事件"""
        with self.message_lock:
            self.message_queue.append(event_message)
        
        # 发送给所有符合条件的客户端
        clients_to_notify = []
        
        with self.client_lock:
            for client in self.clients.values():
                if self._should_send_to_client(client, event_message):
                    clients_to_notify.append(client)
        
        # 异步发送
        if clients_to_notify:
            await asyncio.gather(
                *[self._send_to_client(client, event_message) for client in clients_to_notify],
                return_exceptions=True
            )
    
    def _should_send_to_client(self, client: WebSocketClient, event_message: EventMessage) -> bool:
        """判断是否应该发送给客户端"""
        # 检查订阅
        if EventStreamType.ALL not in client.subscriptions:
            event_type = event_message.event_type
            
            # 根据事件类型判断
            if event_type.startswith("task_") and EventStreamType.TASKS not in client.subscriptions:
                return False
            elif event_type.startswith("tool_") and EventStreamType.TOOLS not in client.subscriptions:
                return False
            elif event_type.startswith("llm_") and EventStreamType.LLMS not in client.subscriptions:
                return False
            elif event_type == "error" and EventStreamType.ERRORS not in client.subscriptions:
                return False
            elif event_type.startswith("monitoring_") and EventStreamType.MONITORING not in client.subscriptions:
                return False
        
        # 检查过滤器
        if client.filters:
            for filter_key, filter_value in client.filters.items():
                if filter_key in event_message.event_data:
                    if event_message.event_data[filter_key] != filter_value:
                        return False
        
        return True
    
    async def _send_to_client(self, client: WebSocketClient, event_message: EventMessage):
        """发送消息给客户端"""
        try:
            await client.websocket.send(event_message.to_json())
            self.stats["messages_sent"] += 1
        except Exception as e:
            logger.error(f"发送消息给客户端 {client.client_id} 失败: {e}")
            self.stats["messages_failed"] += 1
            
            # 移除断开的客户端
            self.remove_client(client.client_id)
    
    async def send_to_client(self, client_id: str, event_message: EventMessage):
        """发送消息给特定客户端"""
        with self.client_lock:
            if client_id in self.clients:
                client = self.clients[client_id]
                await self._send_to_client(client, event_message)
    
    def get_client_count(self) -> int:
        """获取客户端数量"""
        return len(self.clients)
    
    def get_clients_info(self) -> List[Dict[str, Any]]:
        """获取客户端信息"""
        with self.client_lock:
            return [client.to_dict() for client in self.clients.values()]
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            **self.stats,
            "current_clients": len(self.clients),
            "message_queue_size": len(self.message_queue),
            "uptime": (datetime.now(UTC) - self.stats["start_time"]).total_seconds()
        }
    
    async def start_heartbeat(self):
        """启动心跳检查"""
        while True:
            await asyncio.sleep(self.heartbeat_interval)
            await self._check_clients_health()
    
    async def _check_clients_health(self):
        """检查客户端健康状态"""
        current_time = datetime.now(UTC)
        disconnected_clients = []
        
        with self.client_lock:
            for client_id, client in self.clients.items():
                # 检查最后心跳时间
                if (current_time - client.last_ping).total_seconds() > self.heartbeat_interval * 2:
                    disconnected_clients.append(client_id)
        
        # 移除断开的客户端
        for client_id in disconnected_clients:
            self.remove_client(client_id)
    
    def clear_old_messages(self, max_age_seconds: int = 3600):
        """清理过期消息"""
        current_time = datetime.now(UTC)
        
        with self.message_lock:
            # 从队列中移除过期消息
            while self.message_queue and (current_time - self.message_queue[0].timestamp).total_seconds() > max_age_seconds:
                self.message_queue.popleft()


class WebSocketCallbackHandler(BaseCallbackHandler):
    """
    WebSocket回调处理器
    
    将执行事件转换为WebSocket消息并推送给客户端。
    """
    
    def __init__(self, 
                 event_stream: Optional[EventStream] = None,
                 include_detailed_data: bool = True,
                 config: Optional[CallbackHandlerConfig] = None):
        super().__init__(config)
        
        self.event_stream = event_stream or EventStream()
        self.include_detailed_data = include_detailed_data
        
        # 事件计数器
        self.event_counts = {
            "task_events": 0,
            "tool_events": 0,
            "llm_events": 0,
            "error_events": 0,
            "total_events": 0
        }
    
    def on_task_start(self, agent: Agent, task: Task):
        """任务开始时的WebSocket推送"""
        self.event_counts["task_events"] += 1
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="task_start",
            event_data={
                "agent_id": agent.id,
                "agent_name": agent.name,
                "agent_role": agent.role,
                "task_id": task.id,
                "task_description": task.description,
                "task_details": task.model_dump() if self.include_detailed_data else None  # 修复：使用Pydantic的model_dump方法
            }
        )
        
        # 异步发送
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def on_task_end(self, agent: Agent, task: Task, result: Dict[str, Any]):
        """任务结束时的WebSocket推送"""
        self.event_counts["task_events"] += 1
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="task_end",
            event_data={
                "agent_id": agent.id,
                "agent_name": agent.name,
                "task_id": task.id,
                "success": result.get("success", False),
                "execution_time": result.get("execution_time", 0),
                "result": result if self.include_detailed_data else {"success": result.get("success", False)}
            }
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def on_tool_start(self, tool_name: str, tool_args: Dict[str, Any]):
        """工具开始时的WebSocket推送"""
        self.event_counts["tool_events"] += 1
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="tool_start",
            event_data={
                "tool_name": tool_name,
                "tool_args": tool_args if self.include_detailed_data else {"tool_name": tool_name}
            }
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def on_tool_end(self, tool_name: str, result: Any, success: bool):
        """工具结束时的WebSocket推送"""
        self.event_counts["tool_events"] += 1
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="tool_end",
            event_data={
                "tool_name": tool_name,
                "success": success,
                "result": str(result)[:200] if self.include_detailed_data else None
            }
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def on_llm_call(self, prompt: str, model: str, metadata: Dict[str, Any]):
        """LLM调用时的WebSocket推送"""
        self.event_counts["llm_events"] += 1
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="llm_call",
            event_data={
                "model": model,
                "prompt_length": len(prompt),
                "prompt": prompt[:200] + "..." if len(prompt) > 200 and self.include_detailed_data else None,
                "metadata": metadata if self.include_detailed_data else None
            }
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def on_llm_response(self, response: LLMResponse, metadata: Dict[str, Any]):
        """LLM响应时的WebSocket推送"""
        self.event_counts["llm_events"] += 1
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="llm_response",
            event_data={
                "model": response.model_name,
                "response_length": len(response.content),
                "response": response.content[:200] + "..." if len(response.content) > 200 and self.include_detailed_data else None,
                "token_usage": response.token_usage,
                "cost": response.cost
            }
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def on_error(self, error: Exception, context: Dict[str, Any]):
        """错误时的WebSocket推送"""
        self.event_counts["error_events"] += 1
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="error",
            event_data={
                "error_type": type(error).__name__,
                "error_message": str(error),
                "recoverable": context.get("recoverable", True),
                "context": context if self.include_detailed_data else None
            }
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def on_workflow_start(self, workflow: Workflow, inputs: Dict[str, Any]):
        """工作流开始时的WebSocket推送"""
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="workflow_start",
            event_data={
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "inputs": inputs if self.include_detailed_data else None
            }
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def on_workflow_end(self, workflow: Workflow, result: Dict[str, Any]):
        """工作流结束时的WebSocket推送"""
        self.event_counts["total_events"] += 1
        
        event_message = EventMessage(
            event_type="workflow_end",
            event_data={
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "success": result.get("success", False),
                "result": result if self.include_detailed_data else {"success": result.get("success", False)}
            }
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def send_monitoring_update(self, metrics: Dict[str, Any]):
        """发送监控更新"""
        event_message = EventMessage(
            event_type="monitoring_update",
            event_data=metrics
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def send_custom_event(self, event_type: str, event_data: Dict[str, Any]):
        """发送自定义事件"""
        event_message = EventMessage(
            event_type=event_type,
            event_data=event_data
        )
        
        asyncio.create_task(self.event_stream.broadcast_event(event_message))
    
    def get_event_stats(self) -> Dict[str, Any]:
        """获取事件统计"""
        return self.event_counts.copy()
    
    def get_stats(self) -> Dict[str, Any]:
        """获取处理器统计信息"""
        stats = super().get_stats()
        stats.update({
            "event_stream_stats": self.event_stream.get_stats(),
            "event_counts": self.get_event_stats(),
            "include_detailed_data": self.include_detailed_data
        })
        return stats
    
    def reset_stats(self):
        """重置统计信息"""
        for key in self.event_counts:
            self.event_counts[key] = 0


class RealtimeMonitor:
    """
    实时监控器
    
    提供实时监控功能的高级封装。
    """
    
    def __init__(self, 
                 websocket_handler: Optional[WebSocketCallbackHandler] = None,
                 monitoring_interval: float = 5.0):
        self.websocket_handler = websocket_handler or WebSocketCallbackHandler()
        self.monitoring_interval = monitoring_interval
        
        # 监控任务
        self.monitoring_task: Optional[asyncio.Task] = None
        self.is_monitoring = False
        
        # 监控数据
        self.monitoring_data = {
            "system_metrics": {},
            "performance_metrics": {},
            "last_update": None
        }
    
    async def start_monitoring(self):
        """启动实时监控"""
        if self.is_monitoring:
            return
        
        self.is_monitoring = True
        self.monitoring_task = asyncio.create_task(self._monitoring_loop())
        logger.info("实时监控已启动")
    
    async def stop_monitoring(self):
        """停止实时监控"""
        if not self.is_monitoring:
            return
        
        self.is_monitoring = False
        if self.monitoring_task:
            self.monitoring_task.cancel()
            try:
                await self.monitoring_task
            except asyncio.CancelledError:
                pass
        
        logger.info("实时监控已停止")
    
    async def _monitoring_loop(self):
        """监控循环"""
        while self.is_monitoring:
            try:
                # 收集监控数据
                await self._collect_monitoring_data()
                
                # 发送监控更新
                self.websocket_handler.send_monitoring_update(self.monitoring_data)
                
                # 等待下一次监控
                await asyncio.sleep(self.monitoring_interval)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"监控循环中发生错误: {e}")
                await asyncio.sleep(self.monitoring_interval)
    
    async def _collect_monitoring_data(self):
        """收集监控数据"""
        try:
            import psutil
            
            # 系统指标
            self.monitoring_data["system_metrics"] = {
                "cpu_percent": psutil.cpu_percent(interval=None),
                "memory_percent": psutil.virtual_memory().percent,
                "disk_percent": psutil.disk_usage('/').percent,
                "network_io": psutil.net_io_counters()._asdict()
            }
            
            # 性能指标
            self.monitoring_data["performance_metrics"] = {
                "event_counts": self.websocket_handler.get_event_stats(),
                "client_count": self.websocket_handler.event_stream.get_client_count(),
                "stream_stats": self.websocket_handler.event_stream.get_stats()
            }
            
            self.monitoring_data["last_update"] = datetime.now(UTC).isoformat()
            
        except Exception as e:
            logger.error(f"收集监控数据时发生错误: {e}")
    
    def get_monitoring_data(self) -> Dict[str, Any]:
        """获取监控数据"""
        return self.monitoring_data.copy()
    
    def add_client(self, client_id: str, websocket: Any, subscriptions: Optional[List[EventStreamType]] = None) -> WebSocketClient:
        """添加客户端"""
        return self.websocket_handler.event_stream.add_client(client_id, websocket, subscriptions)
    
    def remove_client(self, client_id: str):
        """移除客户端"""
        self.websocket_handler.event_stream.remove_client(client_id)
    
    def get_clients_info(self) -> List[Dict[str, Any]]:
        """获取客户端信息"""
        return self.websocket_handler.event_stream.get_clients_info()
    
    def send_custom_event(self, event_type: str, event_data: Dict[str, Any]):
        """发送自定义事件"""
        self.websocket_handler.send_custom_event(event_type, event_data) 