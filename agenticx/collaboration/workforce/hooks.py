"""
Workforce 事件通知 Hooks

通过 Hooks 系统实现 Agent 和 Toolkit 执行时的自动事件通知。

参考 Eigent ListenChatAgent 实现。
"""

import time
import logging
from typing import Optional

from ...core.hooks import (
    LLMCallHookContext,
    ToolCallHookContext,
    register_before_llm_call_hook,
    register_after_llm_call_hook,
    register_before_tool_call_hook,
    register_after_tool_call_hook,
)
from .events import WorkforceEventBus, WorkforceEvent, WorkforceAction

logger = logging.getLogger(__name__)


def create_workforce_event_hooks(event_bus: WorkforceEventBus):
    """
    创建 Workforce 事件通知 Hooks
    
    返回注册的 hook 函数，以便后续可以取消注册。
    
    Args:
        event_bus: WorkforceEventBus 实例
    
    Returns:
        Dict 包含所有注册的 hook 函数
    """
    
    def before_llm_call_hook(ctx: LLMCallHookContext) -> bool:
        """LLM 调用前发送激活事件"""
        try:
            event_bus.publish(WorkforceEvent(
                action=WorkforceAction.AGENT_ACTIVATED,
                data={
                    "agent_id": ctx.agent_id,
                    "task_id": ctx.task_id,
                    "model": ctx.model,
                    "iteration": ctx.iteration,
                    "message_count": len(ctx.messages) if ctx.messages else 0,
                },
                timestamp=ctx.timestamp,
                agent_id=ctx.agent_id,
                task_id=ctx.task_id,
            ))
            logger.debug(f"[Hooks] Agent {ctx.agent_id} activated")
        except Exception as e:
            logger.error(f"[Hooks] Error in before_llm_call_hook: {e}")
        
        return True  # 继续执行
    
    def after_llm_call_hook(ctx: LLMCallHookContext) -> bool:
        """LLM 调用后发送停用事件"""
        try:
            event_bus.publish(WorkforceEvent(
                action=WorkforceAction.AGENT_DEACTIVATED,
                data={
                    "agent_id": ctx.agent_id,
                    "task_id": ctx.task_id,
                    "model": ctx.model,
                    "tokens_used": ctx.tokens_used,
                    "duration_ms": ctx.duration_ms,
                    "success": ctx.error is None,
                    "error": str(ctx.error) if ctx.error else None,
                },
                timestamp=ctx.timestamp,
                agent_id=ctx.agent_id,
                task_id=ctx.task_id,
            ))
            logger.debug(f"[Hooks] Agent {ctx.agent_id} deactivated")
        except Exception as e:
            logger.error(f"[Hooks] Error in after_llm_call_hook: {e}")
        
        return True
    
    def before_tool_call_hook(ctx: ToolCallHookContext) -> bool:
        """工具调用前发送激活事件"""
        try:
            event_bus.publish(WorkforceEvent(
                action=WorkforceAction.TOOLKIT_ACTIVATED,
                data={
                    "agent_id": ctx.agent_id,
                    "task_id": ctx.task_id,
                    "tool_name": ctx.tool_name,
                    "tool_args": ctx.tool_args,
                    "iteration": ctx.iteration,
                },
                timestamp=ctx.timestamp,
                agent_id=ctx.agent_id,
                task_id=ctx.task_id,
            ))
            logger.debug(f"[Hooks] Toolkit {ctx.tool_name} activated")
        except Exception as e:
            logger.error(f"[Hooks] Error in before_tool_call_hook: {e}")
        
        return True  # 继续执行
    
    def after_tool_call_hook(ctx: ToolCallHookContext) -> bool:
        """工具调用后发送停用事件"""
        try:
            # 限制结果长度
            result_str = str(ctx.result)[:500] if ctx.result else None
            
            event_bus.publish(WorkforceEvent(
                action=WorkforceAction.TOOLKIT_DEACTIVATED,
                data={
                    "agent_id": ctx.agent_id,
                    "task_id": ctx.task_id,
                    "tool_name": ctx.tool_name,
                    "success": ctx.success,
                    "duration_ms": ctx.duration_ms,
                    "result_preview": result_str,
                    "error": str(ctx.error) if ctx.error else None,
                },
                timestamp=ctx.timestamp,
                agent_id=ctx.agent_id,
                task_id=ctx.task_id,
            ))
            logger.debug(f"[Hooks] Toolkit {ctx.tool_name} deactivated")
        except Exception as e:
            logger.error(f"[Hooks] Error in after_tool_call_hook: {e}")
        
        return True
    
    # 注册所有 hooks
    register_before_llm_call_hook(before_llm_call_hook)
    register_after_llm_call_hook(after_llm_call_hook)
    register_before_tool_call_hook(before_tool_call_hook)
    register_after_tool_call_hook(after_tool_call_hook)
    
    logger.info("[Hooks] Registered workforce event notification hooks")
    
    return {
        "before_llm_call": before_llm_call_hook,
        "after_llm_call": after_llm_call_hook,
        "before_tool_call": before_tool_call_hook,
        "after_tool_call": after_tool_call_hook,
    }


def remove_workforce_event_hooks(hooks: dict):
    """
    移除 Workforce 事件通知 Hooks
    
    Args:
        hooks: create_workforce_event_hooks() 返回的 hooks 字典
    """
    from ...core.hooks import (
        unregister_before_llm_call_hook,
        unregister_after_llm_call_hook,
        unregister_before_tool_call_hook,
        unregister_after_tool_call_hook,
    )
    
    if "before_llm_call" in hooks:
        unregister_before_llm_call_hook(hooks["before_llm_call"])
    if "after_llm_call" in hooks:
        unregister_after_llm_call_hook(hooks["after_llm_call"])
    if "before_tool_call" in hooks:
        unregister_before_tool_call_hook(hooks["before_tool_call"])
    if "after_tool_call" in hooks:
        unregister_after_tool_call_hook(hooks["after_tool_call"])
    
    logger.info("[Hooks] Removed workforce event notification hooks")
