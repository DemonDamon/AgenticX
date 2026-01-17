"""
Workforce 事件系统

扩展 EventLog，支持前端订阅和事件推送，提供统一的事件队列系统。

参考 Eigent TaskLock 和 Action Queue 设计。
License: MIT (AgenticX)
"""

from enum import Enum
from typing import Any, Dict, List, Optional, Callable, Union
from pydantic import BaseModel, Field  # type: ignore
from datetime import datetime
import asyncio
import logging

from ...core.event import EventLog, Event, AnyEvent

logger = logging.getLogger(__name__)


class WorkforceAction(str, Enum):
    """Workforce 动作类型（扩展事件类型）"""
    # 任务分解相关
    DECOMPOSE_START = "decompose_start"
    DECOMPOSE_PROGRESS = "decompose_progress"
    DECOMPOSE_COMPLETE = "decompose_complete"
    DECOMPOSE_FAILED = "decompose_failed"
    
    # 任务分配和执行
    TASK_ASSIGNED = "task_assigned"
    TASK_STARTED = "task_started"
    TASK_COMPLETED = "task_completed"
    TASK_FAILED = "task_failed"
    TASK_SKIPPED = "task_skipped"
    
    # Agent 生命周期
    AGENT_ACTIVATED = "agent_activated"
    AGENT_DEACTIVATED = "agent_deactivated"
    
    # 工具调用
    TOOLKIT_ACTIVATED = "toolkit_activated"
    TOOLKIT_DEACTIVATED = "toolkit_deactivated"
    
    # 对话和交互
    USER_MESSAGE = "user_message"
    ASSISTANT_MESSAGE = "assistant_message"
    
    # 系统状态
    WORKFORCE_STARTED = "workforce_started"
    WORKFORCE_STOPPED = "workforce_stopped"
    WORKFORCE_PAUSED = "workforce_paused"
    WORKFORCE_RESUMED = "workforce_resumed"


class WorkforceEvent(BaseModel):
    """Workforce 事件（兼容 EventLog）"""
    action: WorkforceAction
    data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.now)
    task_id: Optional[str] = None
    agent_id: Optional[str] = None
    
    def to_event_log_entry(self) -> Event:
        """转换为 EventLog 事件（复用现有事件系统）"""
        # 创建一个通用 Event 对象
        return Event(
            type=self.action.value,
            data=self.data,
            timestamp=self.timestamp,
            task_id=self.task_id,
            agent_id=self.agent_id,
        )


class WorkforceEventBus:
    """Workforce 事件总线（扩展 EventLog，支持前端订阅）
    
    提供：
    1. 事件发布订阅机制
    2. 事件持久化（通过 EventLog）
    3. 事件历史查询
    """
    
    def __init__(self, event_log: Optional[EventLog] = None):
        """
        Args:
            event_log: 可选的 EventLog 实例（用于持久化事件）
        """
        self._subscribers: List[Callable[[WorkforceEvent], None]] = []
        self._async_subscribers: List[Callable[[WorkforceEvent], asyncio.Future]] = []
        self.event_log = event_log or EventLog()
        self._event_queue: asyncio.Queue = asyncio.Queue()
    
    def subscribe(self, callback: Callable[[WorkforceEvent], None]) -> None:
        """订阅事件（同步回调）
        
        Args:
            callback: 事件处理函数
        """
        if callback not in self._subscribers:
            self._subscribers.append(callback)
            logger.debug(f"Added subscriber: {callback.__name__}")
    
    def subscribe_async(self, callback: Callable[[WorkforceEvent], asyncio.Future]) -> None:
        """订阅事件（异步回调）
        
        Args:
            callback: 异步事件处理函数
        """
        if callback not in self._async_subscribers:
            self._async_subscribers.append(callback)
            logger.debug(f"Added async subscriber: {callback.__name__}")
    
    def unsubscribe(self, callback: Callable[[WorkforceEvent], None]) -> None:
        """取消订阅（同步）"""
        if callback in self._subscribers:
            self._subscribers.remove(callback)
            logger.debug(f"Removed subscriber: {callback.__name__}")
    
    def unsubscribe_async(self, callback: Callable[[WorkforceEvent], asyncio.Future]) -> None:
        """取消订阅（异步）"""
        if callback in self._async_subscribers:
            self._async_subscribers.remove(callback)
            logger.debug(f"Removed async subscriber: {callback.__name__}")
    
    def publish(self, event: WorkforceEvent) -> None:
        """发布事件（同步）
        
        Args:
            event: Workforce 事件
        """
        # 1. 记录到 EventLog（如果提供）
        if self.event_log:
            try:
                log_entry = event.to_event_log_entry()
                self.event_log.add_event(log_entry)
            except Exception as e:
                logger.error(f"Failed to log event to EventLog: {e}")
        
        # 2. 通知订阅者（同步）
        for callback in self._subscribers:
            try:
                callback(event)
            except Exception as e:
                logger.error(f"Event callback {callback.__name__} failed: {e}")
        
        # 3. 放入异步队列
        try:
            self._event_queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("Event queue is full, dropping event")
    
    async def publish_async(self, event: WorkforceEvent) -> None:
        """发布事件（异步）
        
        Args:
            event: Workforce 事件
        """
        # 1. 记录到 EventLog
        if self.event_log:
            try:
                log_entry = event.to_event_log_entry()
                self.event_log.add_event(log_entry)
            except Exception as e:
                logger.error(f"Failed to log event to EventLog: {e}")
        
        # 2. 通知订阅者（同步）
        for callback in self._subscribers:
            try:
                callback(event)
            except Exception as e:
                logger.error(f"Event callback {callback.__name__} failed: {e}")
        
        # 3. 通知异步订阅者
        for callback in self._async_subscribers:
            try:
                await callback(event)
            except Exception as e:
                logger.error(f"Async event callback {callback.__name__} failed: {e}")
        
        # 4. 放入异步队列
        await self._event_queue.put(event)
    
    async def get_next_event(self, timeout: Optional[float] = None) -> Optional[WorkforceEvent]:
        """从队列获取下一个事件（用于 SSE 推送）
        
        Args:
            timeout: 超时时间（秒）
        
        Returns:
            WorkforceEvent 或 None（超时）
        """
        try:
            if timeout:
                return await asyncio.wait_for(
                    self._event_queue.get(),
                    timeout=timeout
                )
            else:
                return await self._event_queue.get()
        except asyncio.TimeoutError:
            return None
    
    def get_event_history(
        self,
        task_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        action: Optional[WorkforceAction] = None,
        limit: Optional[int] = None,
    ) -> List[WorkforceEvent]:
        """从 EventLog 获取事件历史
        
        Args:
            task_id: 任务 ID 过滤
            agent_id: Agent ID 过滤
            action: 动作类型过滤
            limit: 限制返回数量
        
        Returns:
            WorkforceEvent 列表
        """
        if not self.event_log:
            return []
        
        # 从 EventLog 查询事件（使用 events 属性）
        events = self.event_log.events
        
        # 转换为 WorkforceEvent 并过滤
        workforce_events = []
        for event in events:
            # 尝试将 Event 转换为 WorkforceEvent
            try:
                # 检查 event.type 是否是 WorkforceAction
                action_type = WorkforceAction(event.type)
                workforce_event = WorkforceEvent(
                    action=action_type,
                    data=event.data,
                    timestamp=event.timestamp,
                    task_id=event.task_id,
                    agent_id=event.agent_id,
                )
                
                # 应用过滤条件
                if task_id and workforce_event.task_id != task_id:
                    continue
                if agent_id and workforce_event.agent_id != agent_id:
                    continue
                if action and workforce_event.action != action:
                    continue
                
                workforce_events.append(workforce_event)
            except (ValueError, KeyError):
                # 不是 WorkforceEvent，跳过
                continue
        
        # 应用限制
        if limit:
            workforce_events = workforce_events[-limit:]
        
        return workforce_events
    
    def clear_queue(self) -> int:
        """清空事件队列
        
        Returns:
            清空的事件数量
        """
        count = 0
        while not self._event_queue.empty():
            try:
                self._event_queue.get_nowait()
                count += 1
            except asyncio.QueueEmpty:
                break
        
        logger.debug(f"Cleared {count} events from queue")
        return count
    
    def get_subscriber_count(self) -> Dict[str, int]:
        """获取订阅者数量"""
        return {
            "sync": len(self._subscribers),
            "async": len(self._async_subscribers),
        }
