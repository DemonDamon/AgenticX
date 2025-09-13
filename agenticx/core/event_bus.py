"""事件总线实现

提供发布-订阅模式的事件总线，用于组件间的解耦通信。
"""

from typing import Dict, List, Callable, Any, Optional
from .event import Event, AnyEvent
import asyncio
from collections import defaultdict
import inspect

class EventBus:
    """事件总线
    
    实现发布-订阅模式，允许组件注册事件监听器并发布事件。
    支持同步和异步事件处理，以及通配符订阅。
    """
    WILDCARD = "*"

    def __init__(self):
        self._sync_handlers: Dict[str, List[Callable]] = defaultdict(list)
        self._async_handlers: Dict[str, List[Callable]] = defaultdict(list)
        self._sync_wildcard_handlers: List[Callable] = []
        self._async_wildcard_handlers: List[Callable] = []
        self._event_history: List[AnyEvent] = []
        self._max_history = 1000

    def subscribe(self, event_type: str, handler: Callable) -> None:
        """订阅事件
        
        Args:
            event_type: 事件类型, 或使用 `EventBus.WILDCARD` 订阅所有事件。
            handler: 事件处理函数 (同步或异步)。
        """
        is_async = inspect.iscoroutinefunction(handler) or inspect.isasyncgenfunction(handler)

        if event_type == self.WILDCARD:
            if is_async:
                if handler not in self._async_wildcard_handlers:
                    self._async_wildcard_handlers.append(handler)
            else:
                if handler not in self._sync_wildcard_handlers:
                    self._sync_wildcard_handlers.append(handler)
        else:
            if is_async:
                if handler not in self._async_handlers[event_type]:
                    self._async_handlers[event_type].append(handler)
            else:
                if handler not in self._sync_handlers[event_type]:
                    self._sync_handlers[event_type].append(handler)

    def unsubscribe(self, event_type: str, handler: Callable) -> None:
        """取消订阅事件"""
        is_async = inspect.iscoroutinefunction(handler) or inspect.isasyncgenfunction(handler)

        if event_type == self.WILDCARD:
            if is_async and handler in self._async_wildcard_handlers:
                self._async_wildcard_handlers.remove(handler)
            elif not is_async and handler in self._sync_wildcard_handlers:
                self._sync_wildcard_handlers.remove(handler)
        else:
            if is_async and handler in self._async_handlers.get(event_type, []):
                self._async_handlers[event_type].remove(handler)
            elif not is_async and handler in self._sync_handlers.get(event_type, []):
                self._sync_handlers[event_type].remove(handler)

    def publish(self, event: AnyEvent) -> None:
        """发布事件（同步），只调用同步处理器。"""
        self._add_to_history(event)
        
        handlers = self._sync_handlers.get(event.type, []) + self._sync_wildcard_handlers
        for handler in handlers:
            try:
                handler(event)
            except Exception as e:
                print(f"Error in sync event handler for event {event.type}: {e}")

    def publish_sync(self, event: AnyEvent) -> None:
        """同步发布事件的别名，确保与旧代码兼容。"""
        self.publish(event)

    async def publish_async(self, event: AnyEvent) -> None:
        """发布事件（异步），调用同步和异步处理器。"""
        self._add_to_history(event)
        
        # 调用同步处理器
        sync_handlers = self._sync_handlers.get(event.type, []) + self._sync_wildcard_handlers
        for handler in sync_handlers:
            try:
                handler(event)
            except Exception as e:
                print(f"Error in sync event handler for event {event.type}: {e}")

        # 收集并执行异步处理器
        async_handlers = self._async_handlers.get(event.type, []) + self._async_wildcard_handlers
        async_tasks = []
        for handler in async_handlers:
            try:
                task = asyncio.create_task(handler(event))
                async_tasks.append(task)
            except Exception as e:
                print(f"Error creating async task for event {event.type}: {e}")
        
        if async_tasks:
            await asyncio.gather(*async_tasks, return_exceptions=True)

    def _add_to_history(self, event: AnyEvent) -> None:
        self._event_history.append(event)
        if len(self._event_history) > self._max_history:
            self._event_history = self._event_history[-self._max_history:]

    def get_subscriber_count(self) -> int:
        """获取所有事件的订阅者总数。"""
        sync_count = sum(len(handlers) for handlers in self._sync_handlers.values()) + len(self._sync_wildcard_handlers)
        async_count = sum(len(handlers) for handlers in self._async_handlers.values()) + len(self._async_wildcard_handlers)
        return sync_count + async_count
