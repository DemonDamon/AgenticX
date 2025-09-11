"""事件总线实现

提供发布-订阅模式的事件总线，用于组件间的解耦通信。
"""

from typing import Dict, List, Callable, Any, Optional
from .event import Event, AnyEvent
import asyncio
from collections import defaultdict


class EventBus:
    """事件总线
    
    实现发布-订阅模式，允许组件注册事件监听器并发布事件。
    支持同步和异步事件处理。
    """
    
    def __init__(self):
        self._sync_handlers: Dict[str, List[Callable]] = defaultdict(list)
        self._async_handlers: Dict[str, List[Callable]] = defaultdict(list)
        self._event_history: List[AnyEvent] = []
        self._max_history = 1000  # 限制历史记录数量
    
    def subscribe(self, event_type: str, handler: Callable, async_handler: bool = False) -> None:
        """订阅事件
        
        Args:
            event_type: 事件类型
            handler: 事件处理函数
            async_handler: 是否为异步处理函数
        """
        if async_handler:
            self._async_handlers[event_type].append(handler)
        else:
            self._sync_handlers[event_type].append(handler)
    
    def unsubscribe(self, event_type: str, handler: Callable, async_handler: bool = False) -> None:
        """取消订阅事件
        
        Args:
            event_type: 事件类型
            handler: 事件处理函数
            async_handler: 是否为异步处理函数
        """
        if async_handler:
            if handler in self._async_handlers[event_type]:
                self._async_handlers[event_type].remove(handler)
        else:
            if handler in self._sync_handlers[event_type]:
                self._sync_handlers[event_type].remove(handler)
    
    def publish(self, event: AnyEvent) -> None:
        """发布事件（同步）
        
        Args:
            event: 要发布的事件
        """
        # 添加到历史记录
        self._add_to_history(event)
        
        # 调用同步处理器
        for handler in self._sync_handlers[event.type]:
            try:
                handler(event)
            except Exception as e:
                print(f"Error in sync event handler: {e}")
    
    async def publish_async(self, event: AnyEvent) -> None:
        """发布事件（异步）
        
        Args:
            event: 要发布的事件
        """
        # 添加到历史记录
        self._add_to_history(event)
        
        # 调用同步处理器
        for handler in self._sync_handlers[event.type]:
            try:
                handler(event)
            except Exception as e:
                print(f"Error in sync event handler: {e}")
        
        # 调用异步处理器
        async_tasks = []
        for handler in self._async_handlers[event.type]:
            try:
                task = asyncio.create_task(handler(event))
                async_tasks.append(task)
            except Exception as e:
                print(f"Error creating async task: {e}")
        
        # 等待所有异步处理器完成
        if async_tasks:
            await asyncio.gather(*async_tasks, return_exceptions=True)
    
    async def add_error(self, message: str, source: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        """Helper to publish a standardized error event."""
        error_event = Event(
            type='error',
            data={
                'message': message,
                'source': source,
                'details': details
            }
        )
        await self.publish_async(error_event)

    async def update_task(self, task_description: str, source_agent: str, status: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        """Helper to publish a standardized task update event."""
        task_event = Event(
            type='task_update',
            data={
                'task_description': task_description,
                'source_agent': source_agent,
                'status': status,
                'details': details
            }
        )
        await self.publish_async(task_event)

    def _add_to_history(self, event: AnyEvent) -> None:
        """添加事件到历史记录"""
        self._event_history.append(event)
        
        # 限制历史记录数量
        if len(self._event_history) > self._max_history:
            self._event_history = self._event_history[-self._max_history:]
    
    def get_event_history(self, event_type: Optional[str] = None, limit: Optional[int] = None) -> List[AnyEvent]:
        """获取事件历史记录
        
        Args:
            event_type: 过滤特定类型的事件
            limit: 限制返回的事件数量
            
        Returns:
            事件列表
        """
        events = self._event_history
        
        if event_type:
            events = [e for e in events if e.type == event_type]
        
        if limit:
            events = events[-limit:]
        
        return events
    
    def clear_history(self) -> None:
        """清空事件历史记录"""
        self._event_history.clear()
    
    def get_handler_count(self, event_type: str) -> Dict[str, int]:
        """获取指定事件类型的处理器数量
        
        Args:
            event_type: 事件类型
            
        Returns:
            包含同步和异步处理器数量的字典
        """
        return {
            "sync": len(self._sync_handlers[event_type]),
            "async": len(self._async_handlers[event_type])
        }