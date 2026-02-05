"""
事件通知 Hooks 集成

注册 Hooks 自动发送 activate_agent、deactivate_agent、activate_toolkit、
deactivate_toolkit 等事件到 WorkforceEventBus。

参考：backend/app/utils/agent.py:143-252 (ListenChatAgent)
参考：Eigent 前端架构设计
"""

import logging
from typing import Optional, Dict, Any

from ..core.hooks import (
    register_before_llm_call_hook,
    register_after_llm_call_hook,
    register_before_tool_call_hook,
    register_after_tool_call_hook,
    LLMCallHookContext,
    ToolCallHookContext,
)
from ..collaboration.workforce.events import WorkforceEventBus, WorkforceEvent, WorkforceAction

logger = logging.getLogger(__name__)

# 全局事件总线（可以通过 setup_event_hooks 设置）
_event_bus: Optional[WorkforceEventBus] = None

# Agent 激活状态跟踪（agent_id -> task_id）
_active_agents: Dict[str, str] = {}


def setup_event_hooks(event_bus: WorkforceEventBus) -> None:
    """设置事件通知 Hooks（注册所有事件通知钩子）
    
    参考：Eigent 前端架构设计
    
    Args:
        event_bus: WorkforceEventBus 实例
    """
    global _event_bus
    _event_bus = event_bus
    
    # 注册 LLM Hooks
    register_before_llm_call_hook(_before_llm_call_hook)
    register_after_llm_call_hook(_after_llm_call_hook)
    
    # 注册 Tool Hooks
    register_before_tool_call_hook(_before_tool_call_hook)
    register_after_tool_call_hook(_after_tool_call_hook)
    
    logger.info("[EventHooks] Registered event notification hooks")


def _before_llm_call_hook(ctx: LLMCallHookContext) -> bool:
    """LLM 调用前钩子：发送 activate_agent 事件"""
    if not _event_bus:
        return True
    
    # 检查是否是新激活的 Agent
    if ctx.agent_id not in _active_agents:
        _active_agents[ctx.agent_id] = ctx.task_id or ""
        
        # 发送 activate_agent 事件
        _event_bus.publish(WorkforceEvent(
            action=WorkforceAction.AGENT_ACTIVATED,
            agent_id=ctx.agent_id,
            task_id=ctx.task_id,
            data={
                "agent_name": ctx.agent_id,  # 可以使用 agent.name 如果有访问权限
                "tokens": 0,  # 初始为 0，调用后更新
                "message": f"Agent {ctx.agent_id} activated",
            },
        ))
        logger.debug(f"[EventHooks] Published activate_agent event for {ctx.agent_id}")
    
    return True


def _after_llm_call_hook(ctx: LLMCallHookContext) -> bool:
    """LLM 调用后钩子：发送 deactivate_agent 事件（如果完成）"""
    if not _event_bus:
        return True
    
    # 这里可以根据实际情况判断 Agent 是否完成
    # 暂时假设每次 LLM 调用后 Agent 可能完成
    # 实际实现中可能需要更复杂的逻辑来判断 Agent 是否真的完成
    
    # 发送 deactivate_agent 事件（带 token 信息）
    if ctx.agent_id in _active_agents:
        _event_bus.publish(WorkforceEvent(
            action=WorkforceAction.AGENT_DEACTIVATED,
            agent_id=ctx.agent_id,
            task_id=ctx.task_id,
            data={
                "agent_name": ctx.agent_id,
                "tokens": ctx.tokens_used or 0,
                "message": f"Agent {ctx.agent_id} completed LLM call",
            },
        ))
        logger.debug(f"[EventHooks] Published deactivate_agent event for {ctx.agent_id}")
        # 注意：这里不删除 _active_agents，因为 Agent 可能还会继续调用
    
    return True


def _before_tool_call_hook(ctx: ToolCallHookContext) -> bool:
    """工具调用前钩子：发送 activate_toolkit 事件"""
    if not _event_bus:
        return True
    
    # 解析工具名称（可能格式为 "toolkit_name.method_name"）
    tool_name = ctx.tool_name
    toolkit_name = tool_name
    method_name = tool_name
    
    # 尝试解析 toolkit_name 和 method_name
    if "." in tool_name:
        parts = tool_name.split(".", 1)
        toolkit_name = parts[0]
        method_name = parts[1] if len(parts) > 1 else tool_name
    else:
        # 如果没有 toolkit 前缀，使用工具名作为 toolkit_name
        toolkit_name = tool_name
        method_name = "call"
    
    # 发送 activate_toolkit 事件
    _event_bus.publish(WorkforceEvent(
        action=WorkforceAction.TOOLKIT_ACTIVATED,
        agent_id=ctx.agent_id,
        task_id=ctx.task_id,
        data={
            "agent_name": ctx.agent_id,
            "toolkit_name": toolkit_name,
            "method_name": method_name,
            "message": f"Calling {tool_name}",
        },
    ))
    logger.debug(f"[EventHooks] Published activate_toolkit event for {ctx.agent_id}: {tool_name}")
    
    return True


def _after_tool_call_hook(ctx: ToolCallHookContext) -> bool:
    """工具调用后钩子：发送 deactivate_toolkit 事件"""
    if not _event_bus:
        return True
    
    # 解析工具名称
    tool_name = ctx.tool_name
    toolkit_name = tool_name
    method_name = tool_name
    
    if "." in tool_name:
        parts = tool_name.split(".", 1)
        toolkit_name = parts[0]
        method_name = parts[1] if len(parts) > 1 else tool_name
    else:
        toolkit_name = tool_name
        method_name = "call"
    
    # 构建结果消息
    if ctx.success:
        message = f"{tool_name} completed successfully"
    else:
        error_msg = str(ctx.error) if ctx.error else "Unknown error"
        message = f"{tool_name} failed: {error_msg}"
    
    # 发送 deactivate_toolkit 事件
    _event_bus.publish(WorkforceEvent(
        action=WorkforceAction.TOOLKIT_DEACTIVATED,
        agent_id=ctx.agent_id,
        task_id=ctx.task_id,
        data={
            "agent_name": ctx.agent_id,
            "toolkit_name": toolkit_name,
            "method_name": method_name,
            "message": message,
        },
    ))
    logger.debug(f"[EventHooks] Published deactivate_toolkit event for {ctx.agent_id}: {tool_name}")
    
    return True


def clear_event_hooks() -> None:
    """清除事件通知 Hooks（主要用于测试）"""
    global _event_bus, _active_agents
    _event_bus = None
    _active_agents.clear()
    logger.info("[EventHooks] Cleared event hooks")
