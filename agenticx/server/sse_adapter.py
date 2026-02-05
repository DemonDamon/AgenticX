"""
SSE 流式响应适配器

将 WorkforceEventBus 事件流转换为 SSE 流式响应。

参考：
- backend/app/controller/chat_controller.py:75-128 (SSE 流式响应)
- backend/app/service/chat_service.py:238-1073 (step_solve 异步生成器)
- Eigent 前端架构设计
"""

import asyncio
import logging
from typing import AsyncIterator, Optional
from datetime import datetime

from ..collaboration.task_lock import TaskLock, Action, ActionData
from ..collaboration.workforce.events import WorkforceEventBus, WorkforceEvent, WorkforceAction
from .sse_formatter import SSEFormatter, SSEEvent

logger = logging.getLogger(__name__)


async def create_sse_stream(
    project_id: str,
    task_lock: TaskLock,
    event_bus: WorkforceEventBus,
    timeout: float = 30.0,
) -> AsyncIterator[str]:
    """创建 SSE 事件流
    
    从 TaskLock 的 Action Queue 和 WorkforceEventBus 订阅事件，
    转换为 SSE 格式并流式推送。
    
    Args:
        project_id: 项目 ID
        task_lock: TaskLock 实例
        event_bus: WorkforceEventBus 实例
        timeout: 事件获取超时时间（秒）
        
    Yields:
        SSE 格式字符串
    """
    formatter = SSEFormatter()
    stop_event = asyncio.Event()
    action_queue = asyncio.Queue()
    
    try:
        # 从 TaskLock Queue 读取 ActionData
        async def read_action_queue():
            """从 TaskLock Queue 读取 ActionData"""
            while not stop_event.is_set():
                try:
                    action_data = await task_lock.get_queue(timeout=1.0)
                    if action_data:
                        await action_queue.put(action_data)
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    logger.error(f"[SSEAdapter] Error reading action queue: {e}")
                    break
        
        # 启动后台任务读取 Action Queue
        queue_task = asyncio.create_task(read_action_queue())
        task_lock.add_background_task(queue_task)
        
        # 主循环：从事件总线和 Action Queue 读取并格式化
        while not stop_event.is_set():
            try:
                # 同时等待事件总线和 Action Queue
                done, pending = await asyncio.wait(
                    [
                        asyncio.create_task(event_bus.get_next_event(timeout=timeout)),
                        asyncio.create_task(action_queue.get()),
                    ],
                    timeout=timeout,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                
                # 取消未完成的任务
                for task in pending:
                    task.cancel()
                
                # 处理完成的任务
                if done:
                    task = done.pop()
                    try:
                        item = await task
                        
                        # 处理不同类型的项目
                        if isinstance(item, WorkforceEvent):
                            # WorkforceEvent -> SSE
                            sse_event = formatter.format_event(item)
                            if sse_event:
                                yield sse_event
                        
                        elif isinstance(item, ActionData):
                            # ActionData -> SSE
                            sse_event = _convert_action_data_to_sse(item, formatter)
                            if sse_event:
                                yield sse_event
                        
                        else:
                            logger.warning(f"[SSEAdapter] Unknown item type: {type(item)}")
                    except Exception as e:
                        logger.error(f"[SSEAdapter] Error processing item: {e}")
                else:
                    # 超时，发送心跳
                    yield formatter.format_custom_event(SSEEvent.SYNC, {})
            
            except asyncio.CancelledError:
                logger.info(f"[SSEAdapter] Stream cancelled for project_id={project_id}")
                break
            
            except Exception as e:
                logger.error(f"[SSEAdapter] Error in stream: {e}")
                yield formatter.format_error(str(e))
                break
        
    finally:
        # 清理
        stop_event.set()
        
        # 等待队列任务完成
        if not queue_task.done():
            queue_task.cancel()
            try:
                await queue_task
            except asyncio.CancelledError:
                pass
        
        task_lock.remove_background_task(queue_task)
        logger.info(f"[SSEAdapter] Stream closed for project_id={project_id}")


def _convert_action_data_to_sse(
    action_data: ActionData,
    formatter: SSEFormatter
) -> Optional[str]:
    """将 ActionData 转换为 SSE 格式
    
    Args:
        action_data: Action 数据
        formatter: SSE 格式化器
        
    Returns:
        SSE 格式字符串，如果不支持则返回 None
    """
    action = action_data.action
    data = action_data.data
    
    # Action -> SSEEvent 映射
    if action == Action.DECOMPOSE_TEXT:
        return formatter.format_custom_event(
            SSEEvent.DECOMPOSE_TEXT,
            {"content": data.get("content", "")}
        )
    
    elif action == Action.CREATE_AGENT:
        return formatter.format_create_agent(
            agent_name=data.get("agent_name", ""),
            agent_id=data.get("agent_id", ""),
            tools=data.get("tools", [])
        )
    
    elif action == Action.ACTIVATE_AGENT:
        return formatter.format_custom_event(
            SSEEvent.ACTIVATE_AGENT,
            {
                "state": "running",
                "agent_id": data.get("agent_id", ""),
                "process_task_id": data.get("process_task_id", ""),
                "tokens": data.get("tokens", 0),
                "agent_name": data.get("agent_name", ""),
                "message": data.get("message", ""),
            }
        )
    
    elif action == Action.DEACTIVATE_AGENT:
        return formatter.format_custom_event(
            SSEEvent.DEACTIVATE_AGENT,
            {
                "state": "completed",
                "agent_id": data.get("agent_id", ""),
                "process_task_id": data.get("process_task_id", ""),
                "tokens": data.get("tokens", 0),
                "agent_name": data.get("agent_name", ""),
                "message": data.get("message", ""),
            }
        )
    
    elif action == Action.ASSIGN_TASK:
        return formatter.format_custom_event(
            SSEEvent.ASSIGN_TASK,
            {
                "assignee_id": data.get("assignee_id", ""),
                "task_id": data.get("task_id", ""),
                "content": data.get("content", ""),
                "state": data.get("state", "waiting"),
                "failure_count": data.get("failure_count", 0),
            }
        )
    
    elif action == Action.ACTIVATE_TOOLKIT:
        return formatter.format_custom_event(
            SSEEvent.ACTIVATE_TOOLKIT,
            {
                "agent_name": data.get("agent_name", ""),
                "toolkit_name": data.get("toolkit_name", ""),
                "method_name": data.get("method_name", ""),
                "message": data.get("message", ""),
                "process_task_id": data.get("process_task_id", ""),
            }
        )
    
    elif action == Action.DEACTIVATE_TOOLKIT:
        return formatter.format_custom_event(
            SSEEvent.DEACTIVATE_TOOLKIT,
            {
                "agent_name": data.get("agent_name", ""),
                "toolkit_name": data.get("toolkit_name", ""),
                "method_name": data.get("method_name", ""),
                "message": data.get("message", ""),
                "process_task_id": data.get("process_task_id", ""),
            }
        )
    
    elif action == Action.TASK_STATE:
        return formatter.format_custom_event(
            SSEEvent.TASK_STATE,
            {
                "state": data.get("state", "DONE"),
                "task_id": data.get("task_id", ""),
                "result": data.get("result", ""),
                "failure_count": data.get("failure_count", 0),
            }
        )
    
    elif action == Action.WRITE_FILE:
        return formatter.format_write_file(data.get("file_path", ""))
    
    elif action == Action.TERMINAL:
        return formatter.format_terminal(
            process_task_id=data.get("process_task_id", ""),
            output=data.get("output", "")
        )
    
    elif action == Action.NOTICE:
        return formatter.format_notice(
            notice=data.get("notice", ""),
            process_task_id=data.get("process_task_id", "")
        )
    
    elif action == Action.ASK:
        return formatter.format_ask(
            agent=data.get("agent", ""),
            content=data.get("content", ""),
            question=data.get("question", ""),
            answer=data.get("answer", "")
        )
    
    elif action == Action.END:
        return formatter.format_custom_event(
            SSEEvent.END,
            {"summary": data.get("summary", "")}
        )
    
    elif action == Action.BUDGET_NOT_ENOUGH:
        return formatter.format_budget_not_enough()
    
    elif action == Action.ADD_TASK:
        return formatter.format_add_task(
            project_id=data.get("project_id", ""),
            task_id=data.get("task_id", ""),
            content=data.get("content", "")
        )
    
    elif action == Action.REMOVE_TASK:
        return formatter.format_remove_task(
            project_id=data.get("project_id", ""),
            task_id=data.get("task_id", "")
        )
    
    else:
        logger.debug(f"[SSEAdapter] Unsupported action: {action.value}")
        return None


async def create_sse_stream_from_events(
    event_bus: WorkforceEventBus,
    timeout: float = 30.0,
) -> AsyncIterator[str]:
    """从 WorkforceEventBus 创建 SSE 事件流（简化版本）
    
    直接从事件总线订阅事件并转换为 SSE 格式。
    
    Args:
        event_bus: WorkforceEventBus 实例
        timeout: 事件获取超时时间（秒）
        
    Yields:
        SSE 格式字符串
    """
    formatter = SSEFormatter()
    stop_event = asyncio.Event()
    
    # 订阅事件总线
    async def event_handler(event: WorkforceEvent) -> None:
        """事件处理器"""
        pass  # 事件通过 get_next_event 获取
    
    event_bus.subscribe_async(event_handler)
    
    try:
        while not stop_event.is_set():
            try:
                # 从事件总线获取事件
                event = await event_bus.get_next_event(timeout=timeout)
                if event:
                    sse_event = formatter.format_event(event)
                    if sse_event:
                        yield sse_event
                else:
                    # 超时，发送心跳
                    yield formatter.format_custom_event(SSEEvent.SYNC, {})
            
            except asyncio.CancelledError:
                logger.info("[SSEAdapter] Stream cancelled")
                break
            
            except Exception as e:
                logger.error(f"[SSEAdapter] Error in stream: {e}")
                yield formatter.format_error(str(e))
                break
    
    finally:
        stop_event.set()
        event_bus.unsubscribe_async(event_handler)
        logger.info("[SSEAdapter] Stream closed")
