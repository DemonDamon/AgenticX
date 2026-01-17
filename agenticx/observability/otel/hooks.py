"""
OpenTelemetry Hooks 桥接模块

将 OTel 追踪集成到 AgenticX Hooks 系统，提供轻量级的 LLM/Tool 追踪能力。

与 OTelCallbackHandler 的区别:
- Hooks 桥接：只追踪 LLM 和 Tool 调用，更轻量
- Callback 桥接：追踪完整生命周期（Task/LLM/Tool），更全面

内化来源:
- alibaba/loongsuite-python-agent: instrumentation 机制
- AgenticX hooks: LLM/Tool hooks 系统

Usage:
    from agenticx.observability.otel import register_otel_hooks, unregister_otel_hooks
    
    # 注册 OTel hooks
    register_otel_hooks()
    
    # 执行 Agent 任务...
    
    # 清理
    unregister_otel_hooks()
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional, TYPE_CHECKING
from contextlib import contextmanager
import uuid

from ..ai_attributes import AiObservationAttributes, AiOperationType

if TYPE_CHECKING:
    from ...hooks import LLMCallHookContext, ToolCallHookContext

logger = logging.getLogger(__name__)

# 全局状态
_hooks_registered: bool = False
_tracer: Optional[Any] = None
_active_spans: Dict[str, Any] = {}

# 尝试导入 OpenTelemetry
_OTEL_AVAILABLE = False
try:
    from opentelemetry import trace  # type: ignore
    from opentelemetry.trace import SpanKind, Status, StatusCode  # type: ignore
    _OTEL_AVAILABLE = True
except ImportError:
    trace = None
    SpanKind = None
    Status = None
    StatusCode = None


def register_otel_hooks(
    service_name: str = "agenticx",
    tracer_provider: Optional[Any] = None,
) -> bool:
    """
    注册 OpenTelemetry hooks 到全局 Hooks 系统
    
    这是轻量级的 OTel 集成方式，只追踪 LLM 和 Tool 调用。
    
    Args:
        service_name: 服务名称
        tracer_provider: 可选的 TracerProvider，如果为 None 则使用全局 Provider
        
    Returns:
        True 如果注册成功，False 如果 OTel 不可用
        
    Example:
        >>> from agenticx.observability.otel import register_otel_hooks
        >>> register_otel_hooks()
        True
    """
    global _hooks_registered, _tracer
    
    if not _OTEL_AVAILABLE:
        logger.warning(
            "OpenTelemetry 未安装，无法注册 OTel hooks。"
            "请运行: pip install agenticx[otel]"
        )
        return False
    
    if _hooks_registered:
        logger.debug("OTel hooks 已注册，跳过")
        return True
    
    # 获取 Tracer
    if tracer_provider:
        _tracer = trace.get_tracer(
            "agenticx.hooks.otel",
            tracer_provider=tracer_provider,
        )
    else:
        _tracer = trace.get_tracer("agenticx.hooks.otel")
    
    # 注册 hooks
    from ...hooks import (
        register_before_llm_call_hook,
        register_after_llm_call_hook,
        register_before_tool_call_hook,
        register_after_tool_call_hook,
    )
    
    register_before_llm_call_hook(_otel_before_llm_call)
    register_after_llm_call_hook(_otel_after_llm_call)
    register_before_tool_call_hook(_otel_before_tool_call)
    register_after_tool_call_hook(_otel_after_tool_call)
    
    _hooks_registered = True
    logger.info(f"OTel hooks 已注册: service={service_name}")
    
    return True


def unregister_otel_hooks() -> bool:
    """
    注销 OpenTelemetry hooks
    
    Returns:
        True 如果注销成功，False 如果未注册
    """
    global _hooks_registered, _tracer, _active_spans
    
    if not _hooks_registered:
        return False
    
    from ...hooks import (
        unregister_before_llm_call_hook,
        unregister_after_llm_call_hook,
        unregister_before_tool_call_hook,
        unregister_after_tool_call_hook,
    )
    
    unregister_before_llm_call_hook(_otel_before_llm_call)
    unregister_after_llm_call_hook(_otel_after_llm_call)
    unregister_before_tool_call_hook(_otel_before_tool_call)
    unregister_after_tool_call_hook(_otel_after_tool_call)
    
    # 清理活跃 spans
    for span in _active_spans.values():
        try:
            span.end()
        except Exception:
            pass
    
    _active_spans.clear()
    _tracer = None
    _hooks_registered = False
    
    logger.info("OTel hooks 已注销")
    return True


def is_otel_hooks_registered() -> bool:
    """检查 OTel hooks 是否已注册"""
    return _hooks_registered


# ============ LLM Hooks ============

def _otel_before_llm_call(ctx: "LLMCallHookContext") -> None:
    """
    LLM 调用前 hook - 创建 Span
    
    将 Span 引用存储到 ctx.metadata 中，以便 after hook 使用。
    """
    global _tracer, _active_spans
    
    if not _tracer:
        return
    
    try:
        model_name = ctx.model_name or "unknown"
        
        # 创建 Span
        span = _tracer.start_span(
            name=f"chat {model_name}",
            kind=SpanKind.CLIENT,
        )
        
        # 设置 GenAI 标准属性
        span.set_attribute(AiObservationAttributes.AI_OPERATION_TYPE, AiOperationType.CHAT.value)
        span.set_attribute(AiObservationAttributes.REQUEST_MODEL, model_name)
        
        # AgenticX 扩展属性
        if ctx.agent_id:
            span.set_attribute(AiObservationAttributes.AGENTICX_AGENT_ID, ctx.agent_id)
        if ctx.agent_name:
            span.set_attribute("agent.name", ctx.agent_name)
        if ctx.task_id:
            span.set_attribute(AiObservationAttributes.AGENTICX_TASK_ID, ctx.task_id)
        
        # 消息数量和迭代次数
        span.set_attribute("gen_ai.messages.count", len(ctx.messages))
        span.set_attribute("gen_ai.iterations", ctx.iterations)
        
        # 存储 Span 引用
        span_key = f"llm:{id(ctx)}"
        _active_spans[span_key] = span
        ctx.metadata["_otel_span_key"] = span_key
        
        logger.debug(f"LLM Span 已创建: {span_key}")
        
    except Exception as e:
        logger.warning(f"创建 LLM Span 失败: {e}")


def _otel_after_llm_call(ctx: "LLMCallHookContext") -> Optional[str]:
    """
    LLM 调用后 hook - 关闭 Span
    
    Returns:
        None (不修改响应)
    """
    global _active_spans
    
    span_key = ctx.metadata.get("_otel_span_key")
    if not span_key:
        return None
    
    span = _active_spans.pop(span_key, None)
    if not span:
        return None
    
    try:
        # 设置响应属性
        if ctx.response:
            span.set_attribute("gen_ai.response.length", len(ctx.response))
        
        # 设置成功状态
        if _OTEL_AVAILABLE:
            span.set_status(Status(StatusCode.OK))
        
        span.end()
        logger.debug(f"LLM Span 已关闭: {span_key}")
        
    except Exception as e:
        logger.warning(f"关闭 LLM Span 失败: {e}")
    
    return None  # 不修改响应


# ============ Tool Hooks ============

def _otel_before_tool_call(ctx: "ToolCallHookContext") -> None:
    """
    Tool 调用前 hook - 创建 Span
    """
    global _tracer, _active_spans
    
    if not _tracer:
        return
    
    try:
        tool_name = ctx.tool_name if hasattr(ctx, 'tool_name') else "unknown"
        
        # 创建 Span
        span = _tracer.start_span(
            name=f"tool.{tool_name}",
            kind=SpanKind.INTERNAL,
        )
        
        # 设置属性
        span.set_attribute(AiObservationAttributes.AI_OPERATION_TYPE, AiOperationType.TOOL_CALL.value)
        span.set_attribute(AiObservationAttributes.AGENTICX_TOOL_NAME, tool_name)
        
        # 参数数量
        if hasattr(ctx, 'tool_args') and ctx.tool_args:
            span.set_attribute("tool.args_count", len(ctx.tool_args))
        
        # AgenticX 扩展属性
        if hasattr(ctx, 'agent_id') and ctx.agent_id:
            span.set_attribute(AiObservationAttributes.AGENTICX_AGENT_ID, ctx.agent_id)
        
        # 存储 Span 引用
        span_key = f"tool:{id(ctx)}"
        _active_spans[span_key] = span
        
        # 存储到 metadata（如果有的话）
        if hasattr(ctx, 'metadata'):
            ctx.metadata["_otel_span_key"] = span_key
        
        logger.debug(f"Tool Span 已创建: {span_key}")
        
    except Exception as e:
        logger.warning(f"创建 Tool Span 失败: {e}")


def _otel_after_tool_call(ctx: "ToolCallHookContext") -> None:
    """
    Tool 调用后 hook - 关闭 Span
    """
    global _active_spans
    
    span_key = None
    if hasattr(ctx, 'metadata'):
        span_key = ctx.metadata.get("_otel_span_key")
    
    # 如果没有找到 key，尝试通过 id 查找
    if not span_key:
        span_key = f"tool:{id(ctx)}"
    
    span = _active_spans.pop(span_key, None)
    if not span:
        return
    
    try:
        # 设置结果属性
        success = True
        if hasattr(ctx, 'result'):
            span.set_attribute("tool.result_type", type(ctx.result).__name__)
        if hasattr(ctx, 'success'):
            success = ctx.success
            span.set_attribute("tool.success", success)
        if hasattr(ctx, 'error') and ctx.error:
            span.set_attribute("tool.error", str(ctx.error))
            success = False
        
        # 设置状态
        if _OTEL_AVAILABLE:
            if success:
                span.set_status(Status(StatusCode.OK))
            else:
                span.set_status(Status(StatusCode.ERROR, "Tool execution failed"))
        
        span.end()
        logger.debug(f"Tool Span 已关闭: {span_key}")
        
    except Exception as e:
        logger.warning(f"关闭 Tool Span 失败: {e}")


__all__ = [
    "register_otel_hooks",
    "unregister_otel_hooks",
    "is_otel_hooks_registered",
]
