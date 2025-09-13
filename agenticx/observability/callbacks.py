"""
AgenticX M9: 核心回调系统 (Core Callback System)

本模块实现了可观测性的核心回调系统，提供统一的事件拦截和处理接口。
回调系统是整个可观测性架构的基础，所有监控、分析和评估功能都通过回调来实现。
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Callable, Union, TypeVar, Generic
from dataclasses import dataclass
from enum import Enum
from datetime import datetime, UTC
import traceback
import uuid

from ..core.event import (
    AnyEvent, TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent,
    ErrorEvent, LLMCallEvent, LLMResponseEvent, HumanRequestEvent,
    HumanResponseEvent, FinishTaskEvent, EventLog
)
from ..core.agent import Agent
from ..core.task import Task
from ..core.workflow import Workflow
from ..llms.response import LLMResponse


logger = logging.getLogger(__name__)


class CallbackError(Exception):
    """回调系统专用异常"""
    pass


class CallbackStage(Enum):
    """回调执行阶段"""
    PRE_EXECUTION = "pre_execution"    # 执行前
    POST_EXECUTION = "post_execution"  # 执行后
    ON_ERROR = "on_error"             # 错误时
    ON_SUCCESS = "on_success"         # 成功时


@dataclass
class CallbackHandlerConfig:
    """回调处理器配置"""
    enabled: bool = True
    async_execution: bool = False
    error_handling: bool = True
    timeout: Optional[float] = None
    priority: int = 0  # 优先级，数字越大优先级越高
    filters: Optional[Dict[str, Any]] = None


class BaseCallbackHandler(ABC):
    """
    回调处理器抽象基类
    
    所有回调处理器都必须继承这个基类，并实现相应的事件处理方法。
    回调处理器负责拦截和处理各种执行事件，实现监控、分析和评估等功能。
    """
    
    def __init__(self, config: Optional[CallbackHandlerConfig] = None):
        self.config = config or CallbackHandlerConfig()
        self.handler_id = str(uuid.uuid4())
        self.handler_name = self.__class__.__name__
        self.is_enabled = self.config.enabled
        self.call_count = 0
        self.error_count = 0
        self.last_error: Optional[Exception] = None
        self.created_at = datetime.now(UTC)
        
    def set_enabled(self, enabled: bool):
        """启用或禁用回调处理器"""
        self.is_enabled = enabled
        
    def get_stats(self) -> Dict[str, Any]:
        """获取处理器统计信息"""
        return {
            "handler_id": self.handler_id,
            "handler_name": self.handler_name,
            "is_enabled": self.is_enabled,
            "call_count": self.call_count,
            "error_count": self.error_count,
            "last_error": str(self.last_error) if self.last_error else None,
            "created_at": self.created_at.isoformat(),
            "config": self.config.__dict__
        }
    
    # 执行生命周期事件
    def on_workflow_start(self, workflow: Workflow, inputs: Dict[str, Any]):
        """工作流开始时调用"""
        pass
    
    def on_workflow_end(self, workflow: Workflow, result: Dict[str, Any]):
        """工作流结束时调用"""
        pass
    
    def on_task_start(self, agent: Agent, task: Task):
        """任务开始时调用"""
        pass
    
    def on_task_end(self, agent: Agent, task: Task, result: Dict[str, Any]):
        """任务结束时调用"""
        pass
    
    def on_agent_action(self, agent: Agent, action: Dict[str, Any]):
        """Agent执行动作时调用"""
        pass
    
    def on_tool_start(self, tool_name: str, tool_args: Dict[str, Any]):
        """工具开始执行时调用"""
        pass
    
    def on_tool_end(self, tool_name: str, result: Any, success: bool):
        """工具执行结束时调用"""
        pass
    
    def on_llm_call(self, prompt: str, model: str, metadata: Dict[str, Any]):
        """LLM调用时调用"""
        pass
    
    def on_llm_response(self, response: LLMResponse, metadata: Dict[str, Any]):
        """LLM响应时调用"""
        pass
    
    def on_error(self, error: Exception, context: Dict[str, Any]):
        """错误发生时调用"""
        pass
    
    def on_human_request(self, request: Dict[str, Any]):
        """人工请求时调用"""
        pass
    
    def on_human_response(self, response: Dict[str, Any]):
        """人工响应时调用"""
        pass
    
    # 通用事件处理
    def on_event(self, event: AnyEvent):
        """
        通用事件处理器
        
        这是一个通用的事件处理入口，会根据事件类型调用对应的特定处理方法。
        子类可以重写这个方法来实现自定义的事件处理逻辑。
        """
        if not self.is_enabled:
            return
            
        try:
            self.call_count += 1
            
            # 根据事件类型调用对应的处理方法
            if isinstance(event, TaskStartEvent):
                self._handle_task_start_event(event)
            elif isinstance(event, TaskEndEvent):
                self._handle_task_end_event(event)
            elif isinstance(event, ToolCallEvent):
                self._handle_tool_call_event(event)
            elif isinstance(event, ToolResultEvent):
                self._handle_tool_result_event(event)
            elif isinstance(event, ErrorEvent):
                self._handle_error_event(event)
            elif isinstance(event, LLMCallEvent):
                self._handle_llm_call_event(event)
            elif isinstance(event, LLMResponseEvent):
                self._handle_llm_response_event(event)
            elif isinstance(event, HumanRequestEvent):
                self._handle_human_request_event(event)
            elif isinstance(event, HumanResponseEvent):
                self._handle_human_response_event(event)
            elif isinstance(event, FinishTaskEvent):
                self._handle_finish_task_event(event)
            else:
                # 未知事件类型，调用通用处理器
                self._handle_unknown_event(event)
                
        except Exception as e:
            self.error_count += 1
            self.last_error = e
            if self.config.error_handling:
                logger.error(f"回调处理器 {self.handler_name} 处理事件时发生错误: {e}")
                logger.error(traceback.format_exc())
            else:
                raise CallbackError(f"回调处理器 {self.handler_name} 处理事件失败: {e}") from e
    
    def _handle_task_start_event(self, event: TaskStartEvent):
        """处理任务开始事件"""
        # 创建临时的 Agent 和 Task 对象
        from ..core.agent import Agent
        from ..core.task import Task
        
        # 创建临时 Agent 对象
        agent = Agent(
            id=event.agent_id or "unknown",
            name=f"Agent-{event.agent_id}",
            role="Unknown",
            goal="Unknown",
            organization_id="unknown"
        )
        
        # 创建临时 Task 对象
        task = Task(
            id=event.task_id or "unknown",
            description=event.task_description,
            expected_output="Unknown"
        )
        
        self.on_task_start(agent, task)
    
    def _handle_task_end_event(self, event: TaskEndEvent):
        """处理任务结束事件"""
        # 创建临时的 Agent 和 Task 对象
        from ..core.agent import Agent
        from ..core.task import Task
        
        # 创建临时 Agent 对象
        agent = Agent(
            id=event.agent_id or "unknown",
            name=f"Agent-{event.agent_id}",
            role="Unknown",
            goal="Unknown",
            organization_id="unknown"
        )
        
        # 创建临时 Task 对象（任务描述从 data 中获取，如果没有则使用默认值）
        task_description = event.data.get("task_description", "Unknown Task")
        task = Task(
            id=event.task_id or "unknown",
            description=task_description,
            expected_output="Unknown"
        )
        
        # 构建结果字典
        result = {
            "success": event.success,
            "result": event.result
        }
        result.update(event.data)  # 添加事件中的其他数据
        
        self.on_task_end(agent, task, result)
    
    def _handle_tool_call_event(self, event: ToolCallEvent):
        """处理工具调用事件"""
        self.on_tool_start(event.tool_name, event.tool_args)
    
    def _handle_tool_result_event(self, event: ToolResultEvent):
        """处理工具结果事件"""
        self.on_tool_end(event.tool_name, event.result, event.success)
    
    def _handle_error_event(self, event: ErrorEvent):
        """处理错误事件"""
        error = Exception(event.error_message)
        context = {
            "error_type": event.error_type,
            "recoverable": event.recoverable,
            "event_data": event.data
        }
        self.on_error(error, context)
    
    def _handle_llm_call_event(self, event: LLMCallEvent):
        """处理LLM调用事件"""
        self.on_llm_call(event.prompt, event.model, event.data)
    
    def _handle_llm_response_event(self, event: LLMResponseEvent):
        """处理LLM响应事件"""
        # 创建一个临时的LLMResponse对象
        from ..llms.response import LLMResponse, LLMChoice, TokenUsage
        import time
        
        # 创建TokenUsage对象
        token_usage_data = event.token_usage or {}
        if isinstance(token_usage_data, dict):
            token_usage = TokenUsage(
                prompt_tokens=token_usage_data.get("prompt_tokens", 0),
                completion_tokens=token_usage_data.get("completion_tokens", 0),
                total_tokens=token_usage_data.get("total_tokens", 0)
            )
        else:
            token_usage = TokenUsage()
        
        # 创建LLMChoice对象
        choice = LLMChoice(
            index=0,
            content=event.response,
            finish_reason="stop"
        )
        
        response = LLMResponse(
            id=event.id,
            model_name=event.data.get("model", "unknown"),
            created=int(event.timestamp.timestamp()),
            content=event.response,
            choices=[choice],
            token_usage=token_usage,
            cost=event.cost or 0.0
        )
        self.on_llm_response(response, event.data)
    
    def _handle_human_request_event(self, event: HumanRequestEvent):
        """处理人工请求事件"""
        self.on_human_request(event.data)
    
    def _handle_human_response_event(self, event: HumanResponseEvent):
        """处理人工响应事件"""
        self.on_human_response(event.data)
    
    def _handle_finish_task_event(self, event: FinishTaskEvent):
        """处理任务完成事件"""
        # 子类可以重写这个方法
        pass
    
    def _handle_unknown_event(self, event: AnyEvent):
        """处理未知事件类型"""
        logger.warning(f"未知事件类型: {type(event)}")
    
    # 异步版本的处理方法
    async def aon_event(self, event: AnyEvent):
        """异步事件处理器"""
        if self.config.async_execution:
            await asyncio.get_event_loop().run_in_executor(None, self.on_event, event)
        else:
            self.on_event(event)


class CallbackRegistry:
    """
    回调注册表
    
    管理所有注册的回调处理器，提供注册、注销、查找等功能。
    """
    
    def __init__(self):
        self.handlers: Dict[str, BaseCallbackHandler] = {}
        self.handlers_by_type: Dict[type, List[BaseCallbackHandler]] = {}
        self.global_handlers: List[BaseCallbackHandler] = []
        
    def register(self, handler: BaseCallbackHandler, handler_types: Optional[List[type]] = None):
        """
        注册回调处理器
        
        Args:
            handler: 回调处理器实例
            handler_types: 处理器关注的事件类型列表，如果为None则处理所有事件
        """
        self.handlers[handler.handler_id] = handler
        
        if handler_types:
            for handler_type in handler_types:
                if handler_type not in self.handlers_by_type:
                    self.handlers_by_type[handler_type] = []
                self.handlers_by_type[handler_type].append(handler)
        else:
            # 全局处理器，处理所有事件
            self.global_handlers.append(handler)
            
        logger.info(f"注册回调处理器: {handler.handler_name} ({handler.handler_id})")
    
    def unregister(self, handler_id: str):
        """注销回调处理器"""
        if handler_id in self.handlers:
            handler = self.handlers[handler_id]
            del self.handlers[handler_id]
            
            # 从类型特定的处理器列表中移除
            for handler_list in self.handlers_by_type.values():
                if handler in handler_list:
                    handler_list.remove(handler)
            
            # 从全局处理器列表中移除
            if handler in self.global_handlers:
                self.global_handlers.remove(handler)
                
            logger.info(f"注销回调处理器: {handler.handler_name} ({handler_id})")
    
    def get_handlers_for_event(self, event: AnyEvent) -> List[BaseCallbackHandler]:
        """获取处理特定事件的处理器列表"""
        handlers = []
        
        # 添加全局处理器
        handlers.extend(self.global_handlers)
        
        # 添加类型特定的处理器
        event_type = type(event)
        if event_type in self.handlers_by_type:
            handlers.extend(self.handlers_by_type[event_type])
        
        # 按优先级排序
        handlers.sort(key=lambda h: h.config.priority, reverse=True)
        
        return handlers
    
    def get_all_handlers(self) -> List[BaseCallbackHandler]:
        """获取所有注册的处理器"""
        return list(self.handlers.values())
    
    def get_handler_by_id(self, handler_id: str) -> Optional[BaseCallbackHandler]:
        """根据ID获取处理器"""
        return self.handlers.get(handler_id)
    
    def clear(self):
        """清除所有注册的处理器"""
        self.handlers.clear()
        self.handlers_by_type.clear()
        self.global_handlers.clear()
    
    def get_stats(self) -> Dict[str, Any]:
        """获取注册表统计信息"""
        return {
            "total_handlers": len(self.handlers),
            "global_handlers": len(self.global_handlers),
            "type_specific_handlers": len(self.handlers_by_type),
            "handlers": [h.get_stats() for h in self.handlers.values()]
        }


class CallbackManager:
    """
    回调管理器
    
    负责管理所有回调处理器，分发事件，处理异步执行等。
    这是整个回调系统的核心组件。
    """
    
    def __init__(self):
        self.registry = CallbackRegistry()
        self.is_enabled = True
        self.event_queue: asyncio.Queue = asyncio.Queue()
        self.processing_task: Optional[asyncio.Task] = None
        self.stats = {
            "events_processed": 0,
            "events_failed": 0,
            "total_execution_time": 0.0,
            "last_event_time": None
        }
        
    def register_handler(self, handler: BaseCallbackHandler, event_types: Optional[List[type]] = None):
        """注册回调处理器"""
        self.registry.register(handler, event_types)
    
    def unregister_handler(self, handler_id: str):
        """注销回调处理器"""
        self.registry.unregister(handler_id)
    
    def enable(self):
        """启用回调管理器"""
        self.is_enabled = True
        
    def disable(self):
        """禁用回调管理器"""
        self.is_enabled = False
    
    def process_event(self, event: AnyEvent):
        """
        处理事件
        
        将事件分发给所有相关的回调处理器进行处理。
        """
        if not self.is_enabled:
            return
            
        start_time = datetime.now(UTC)
        
        try:
            # 获取处理这个事件的所有处理器
            handlers = self.registry.get_handlers_for_event(event)
            
            # 分发事件给所有处理器
            for handler in handlers:
                if handler.is_enabled:
                    try:
                        handler.on_event(event)
                    except Exception as e:
                        logger.error(f"回调处理器 {handler.handler_name} 处理事件失败: {e}")
                        self.stats["events_failed"] += 1
            
            # 更新统计信息
            self.stats["events_processed"] += 1
            self.stats["last_event_time"] = start_time.isoformat()
            
            execution_time = (datetime.now(UTC) - start_time).total_seconds()
            self.stats["total_execution_time"] += execution_time
            
        except Exception as e:
            logger.error(f"回调管理器处理事件失败: {e}")
            self.stats["events_failed"] += 1
    
    async def aprocess_event(self, event: AnyEvent):
        """异步处理事件"""
        if not self.is_enabled:
            return
            
        start_time = datetime.now(UTC)
        
        try:
            # 获取处理这个事件的所有处理器
            handlers = self.registry.get_handlers_for_event(event)
            
            # 异步分发事件给所有处理器
            tasks = []
            for handler in handlers:
                if handler.is_enabled:
                    if handler.config.async_execution:
                        tasks.append(handler.aon_event(event))
                    else:
                        # 同步处理器在线程池中执行
                        task = asyncio.get_event_loop().run_in_executor(None, handler.on_event, event)
                        tasks.append(task)
            
            # 等待所有任务完成
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            
            # 更新统计信息
            self.stats["events_processed"] += 1
            self.stats["last_event_time"] = start_time.isoformat()
            
            execution_time = (datetime.now(UTC) - start_time).total_seconds()
            self.stats["total_execution_time"] += execution_time
            
        except Exception as e:
            logger.error(f"异步回调管理器处理事件失败: {e}")
            self.stats["events_failed"] += 1
    
    def process_event_log(self, event_log: EventLog):
        """处理事件日志中的所有事件"""
        for event in event_log.events:
            self.process_event(event)
    
    async def aprocess_event_log(self, event_log: EventLog):
        """异步处理事件日志中的所有事件"""
        for event in event_log.events:
            await self.aprocess_event(event)
    
    def get_stats(self) -> Dict[str, Any]:
        """获取管理器统计信息"""
        return {
            "is_enabled": self.is_enabled,
            "registry_stats": self.registry.get_stats(),
            "processing_stats": self.stats.copy()
        }
    
    def reset_stats(self):
        """重置统计信息"""
        self.stats = {
            "events_processed": 0,
            "events_failed": 0,
            "total_execution_time": 0.0,
            "last_event_time": None
        }
    
    def get_all_handlers(self) -> List[BaseCallbackHandler]:
        """获取所有注册的处理器"""
        return self.registry.get_all_handlers()
    
    def clear_handlers(self):
        """清除所有处理器"""
        self.registry.clear() 