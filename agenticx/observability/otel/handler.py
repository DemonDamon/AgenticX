"""
OTelCallbackHandler - Callback → OpenTelemetry Span 桥接

本模块实现了 AgenticX Callback 系统到 OpenTelemetry Span 的桥接，
将执行事件（Task、LLM、Tool）转换为标准的 OTel Traces。

内化来源:
- alibaba/loongsuite-python-agent: TelemetryHandler 的 Span 生命周期管理
- AgenticX TrajectoryCollector: Callback 桥接模式

设计原则:
1. 非阻塞：观测不应阻塞用户应用
2. 低侵入：通过 Callback 桥接，无需修改业务代码
3. 标准化：遵循 OpenTelemetry GenAI Semantic Conventions
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from datetime import datetime, timezone
from contextlib import contextmanager
import uuid

from ..callbacks import BaseCallbackHandler, CallbackHandlerConfig
from ..ai_attributes import AiObservationAttributes, AiOperationType
from ..span_tree import SpanTree, SpanNode

if TYPE_CHECKING:
    from .config import OTelConfig

logger = logging.getLogger(__name__)

# 尝试导入 OpenTelemetry（可选依赖）
_OTEL_AVAILABLE = False
try:
    from opentelemetry import trace  # type: ignore
    from opentelemetry.trace import Span, SpanKind, Status, StatusCode  # type: ignore
    from opentelemetry.trace.propagation import set_span_in_context  # type: ignore
    from opentelemetry.context import Context  # type: ignore
    _OTEL_AVAILABLE = True
except ImportError:
    # 创建占位符类型
    Span = Any
    SpanKind = Any
    Status = Any
    StatusCode = Any
    trace = None


class OTelCallbackHandler(BaseCallbackHandler):
    """
    OpenTelemetry Callback 处理器
    
    将 AgenticX 的执行事件转换为 OpenTelemetry Spans，支持：
    - Task Span: Agent 任务执行
    - LLM Span: LLM 调用
    - Tool Span: 工具调用
    
    Span 层次结构:
    ```
    agent_task (root)
    ├── llm.chat
    │   └── (LLM 调用详情)
    ├── tool.call
    │   └── (工具执行详情)
    └── llm.chat
        └── (LLM 调用详情)
    ```
    
    Usage:
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(service_name="my-agent")
        handler = OTelCallbackHandler(config=config)
        
        # 注册到 CallbackManager
        callback_manager.register_handler(handler)
        
        # 执行后获取 SpanTree（如果配置了 export_to_span_tree）
        span_tree = handler.get_span_tree()
    """
    
    def __init__(
        self,
        config: Optional["OTelConfig"] = None,
        callback_config: Optional[CallbackHandlerConfig] = None,
    ):
        """
        初始化 OTelCallbackHandler
        
        Args:
            config: OTel 配置，如果为 None 则使用默认配置
            callback_config: Callback 处理器配置
        """
        super().__init__(callback_config)
        
        # 延迟导入避免循环依赖
        from .config import OTelConfig
        
        self._config = config or OTelConfig()
        self._tracer: Optional[Any] = None
        
        # 活跃 Span 追踪（类似 TrajectoryCollector 的 active_trajectories）
        self._active_task_spans: Dict[str, Span] = {}
        self._active_llm_spans: Dict[str, Span] = {}
        self._active_tool_spans: Dict[str, Span] = {}
        
        # SpanTree 导出支持
        self._collected_spans: List[Dict[str, Any]] = []
        
        # 初始化 Tracer
        if _OTEL_AVAILABLE and self._config.enabled:
            self._tracer = trace.get_tracer(
                "agenticx.observability.otel",
                schema_url="https://opentelemetry.io/schemas/1.28.0",
            )
            logger.debug(f"OTelCallbackHandler 初始化: service={self._config.service_name}")
        elif not _OTEL_AVAILABLE:
            logger.warning(
                "OpenTelemetry 未安装，OTelCallbackHandler 将以无操作模式运行。"
                "请运行: pip install agenticx[otel]"
            )
    
    def _get_span_key(self, agent_id: Optional[str], task_id: Optional[str]) -> str:
        """生成 Span 键（用于追踪活跃 Span）"""
        return f"{agent_id or 'unknown'}:{task_id or 'unknown'}"
    
    def _collect_span_data(
        self,
        span: Span,
        name: str,
        parent_id: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None,
        status: str = "ok",
    ) -> None:
        """
        收集 Span 数据用于 SpanTree 导出
        """
        if not self._config.export_to_span_tree:
            return
        
        span_context = span.get_span_context() if hasattr(span, 'get_span_context') else None
        span_id = format(span_context.span_id, '016x') if span_context else str(uuid.uuid4())
        trace_id = format(span_context.trace_id, '032x') if span_context else str(uuid.uuid4())
        
        self._collected_spans.append({
            "name": name,
            "span_id": span_id,
            "trace_id": trace_id,
            "parent_id": parent_id,
            "start_time": datetime.now(timezone.utc),
            "attributes": attributes or {},
            "status": status,
        })
    
    def _update_span_data(
        self,
        span_id: str,
        end_time: Optional[datetime] = None,
        status: Optional[str] = None,
        attributes: Optional[Dict[str, Any]] = None,
    ) -> None:
        """更新已收集的 Span 数据"""
        if not self._config.export_to_span_tree:
            return
        
        for span_data in self._collected_spans:
            if span_data["span_id"] == span_id:
                if end_time:
                    span_data["end_time"] = end_time
                    if span_data.get("start_time"):
                        duration = (end_time - span_data["start_time"]).total_seconds() * 1000
                        span_data["duration_ms"] = duration
                if status:
                    span_data["status"] = status
                if attributes:
                    span_data["attributes"].update(attributes)
                break
    
    # ============ Task 生命周期 ============
    
    def on_task_start(self, agent: Any, task: Any) -> None:
        """
        任务开始 - 创建 Task Span
        
        对应 loongsuite TelemetryHandler.start_invoke_agent
        """
        if not self._tracer:
            return
        
        agent_id = getattr(agent, 'id', None) or str(uuid.uuid4())
        task_id = getattr(task, 'id', None) or str(uuid.uuid4())
        agent_name = getattr(agent, 'name', 'unknown')
        agent_role = getattr(agent, 'role', 'unknown')
        task_desc = getattr(task, 'description', '')[:100]  # 截断
        
        span_key = self._get_span_key(agent_id, task_id)
        
        # 创建 Task Span
        span = self._tracer.start_span(
            name=f"agent_task {agent_name}",
            kind=SpanKind.INTERNAL if hasattr(SpanKind, 'INTERNAL') else None,
        )
        
        # 设置属性
        span.set_attribute(AiObservationAttributes.AI_OPERATION_TYPE, "agent_task")
        span.set_attribute(AiObservationAttributes.AGENTICX_AGENT_ID, agent_id)
        span.set_attribute(AiObservationAttributes.AGENTICX_AGENT_ROLE, agent_role)
        span.set_attribute(AiObservationAttributes.AGENTICX_TASK_ID, task_id)
        span.set_attribute(AiObservationAttributes.AGENTICX_TASK_DESCRIPTION, task_desc)
        span.set_attribute("agent.name", agent_name)
        
        self._active_task_spans[span_key] = span
        
        # 收集 SpanTree 数据
        self._collect_span_data(
            span,
            name=f"agent_task {agent_name}",
            attributes={
                "agent_id": agent_id,
                "agent_name": agent_name,
                "task_id": task_id,
            }
        )
        
        logger.debug(f"Task Span 已创建: {span_key}")
    
    def on_task_end(self, agent: Any, task: Any, result: Dict[str, Any]) -> None:
        """
        任务结束 - 关闭 Task Span
        
        对应 loongsuite TelemetryHandler.stop_invoke_agent
        """
        if not self._tracer:
            return
        
        agent_id = getattr(agent, 'id', None)
        task_id = getattr(task, 'id', None)
        span_key = self._get_span_key(agent_id, task_id)
        
        span = self._active_task_spans.pop(span_key, None)
        if span:
            success = result.get("success", True)
            
            # 设置状态
            if _OTEL_AVAILABLE:
                if success:
                    span.set_status(Status(StatusCode.OK))
                else:
                    error_msg = result.get("error", "Task failed")
                    span.set_status(Status(StatusCode.ERROR, str(error_msg)))
            
            span.end()
            logger.debug(f"Task Span 已关闭: {span_key}, success={success}")
    
    # ============ LLM 生命周期 ============
    
    def on_llm_call(self, prompt: str, model: str, metadata: Dict[str, Any]) -> None:
        """
        LLM 调用开始 - 创建 LLM Span
        
        对应 loongsuite TelemetryHandler.start_llm
        """
        if not self._tracer:
            return
        
        # 生成唯一键
        llm_key = f"llm:{uuid.uuid4()}"
        
        # 获取当前 Task 的 Context（如果有）
        agent_id = metadata.get("agent_id")
        task_id = metadata.get("task_id")
        task_span_key = self._get_span_key(agent_id, task_id)
        parent_span = self._active_task_spans.get(task_span_key)
        
        # 创建 LLM Span（作为 Task Span 的子 Span）
        context = None
        if parent_span and hasattr(trace, 'set_span_in_context'):
            context = set_span_in_context(parent_span)
        
        span = self._tracer.start_span(
            name=f"chat {model}",
            kind=SpanKind.CLIENT if hasattr(SpanKind, 'CLIENT') else None,
            context=context,
        )
        
        # 设置 GenAI 标准属性
        span.set_attribute(AiObservationAttributes.AI_OPERATION_TYPE, AiOperationType.CHAT.value)
        span.set_attribute(AiObservationAttributes.REQUEST_MODEL, model)
        span.set_attribute(AiObservationAttributes.AI_PROVIDER, self._extract_provider(model))
        
        # AgenticX 扩展属性
        if agent_id:
            span.set_attribute(AiObservationAttributes.AGENTICX_AGENT_ID, agent_id)
        if task_id:
            span.set_attribute(AiObservationAttributes.AGENTICX_TASK_ID, task_id)
        
        # 可选：记录 prompt 长度（不记录内容，保护隐私）
        span.set_attribute("gen_ai.prompt.length", len(prompt))
        
        self._active_llm_spans[llm_key] = span
        
        # 在 metadata 中存储 key，以便 on_llm_response 能找到
        metadata["_otel_llm_key"] = llm_key
        
        # 收集 SpanTree 数据
        parent_id = None
        if parent_span:
            ctx = parent_span.get_span_context()
            parent_id = format(ctx.span_id, '016x') if ctx else None
        
        self._collect_span_data(
            span,
            name=f"chat {model}",
            parent_id=parent_id,
            attributes={
                "model": model,
                "prompt_length": len(prompt),
            }
        )
        
        logger.debug(f"LLM Span 已创建: {llm_key}")
    
    def on_llm_response(self, response: Any, metadata: Dict[str, Any]) -> None:
        """
        LLM 响应 - 关闭 LLM Span
        
        对应 loongsuite TelemetryHandler.stop_llm
        """
        if not self._tracer:
            return
        
        llm_key = metadata.get("_otel_llm_key")
        if not llm_key:
            # 尝试找最近的 LLM span
            if self._active_llm_spans:
                llm_key = list(self._active_llm_spans.keys())[-1]
            else:
                return
        
        span = self._active_llm_spans.pop(llm_key, None)
        if span:
            # 设置响应属性
            model_name = getattr(response, 'model_name', None) or metadata.get("model", "unknown")
            span.set_attribute(AiObservationAttributes.RESPONSE_MODEL, model_name)
            
            # Token 用量
            token_usage = getattr(response, 'token_usage', None)
            if token_usage:
                if hasattr(token_usage, 'prompt_tokens'):
                    span.set_attribute(
                        AiObservationAttributes.USAGE_INPUT_TOKENS,
                        token_usage.prompt_tokens
                    )
                if hasattr(token_usage, 'completion_tokens'):
                    span.set_attribute(
                        AiObservationAttributes.USAGE_OUTPUT_TOKENS,
                        token_usage.completion_tokens
                    )
                if hasattr(token_usage, 'total_tokens'):
                    span.set_attribute(
                        AiObservationAttributes.USAGE_TOTAL_TOKENS,
                        token_usage.total_tokens
                    )
            
            # 响应长度
            content = getattr(response, 'content', '')
            span.set_attribute("gen_ai.response.length", len(content) if content else 0)
            
            # 完成原因
            finish_reason = None
            if hasattr(response, 'choices') and response.choices:
                finish_reason = getattr(response.choices[0], 'finish_reason', None)
            if finish_reason:
                span.set_attribute(AiObservationAttributes.RESPONSE_FINISH_REASONS, finish_reason)
            
            span.set_status(Status(StatusCode.OK) if _OTEL_AVAILABLE else None)
            span.end()
            
            logger.debug(f"LLM Span 已关闭: {llm_key}")
    
    # ============ Tool 生命周期 ============
    
    def on_tool_start(self, tool_name: str, tool_args: Dict[str, Any]) -> None:
        """
        工具调用开始 - 创建 Tool Span
        
        对应 loongsuite ExtendedTelemetryHandler.start_execute_tool
        """
        if not self._tracer:
            return
        
        tool_key = f"tool:{tool_name}:{uuid.uuid4()}"
        
        # 尝试获取父 Span（最近的 Task Span）
        parent_span = None
        if self._active_task_spans:
            parent_span = list(self._active_task_spans.values())[-1]
        
        context = None
        if parent_span and hasattr(trace, 'set_span_in_context'):
            context = set_span_in_context(parent_span)
        
        span = self._tracer.start_span(
            name=f"tool.{tool_name}",
            kind=SpanKind.INTERNAL if hasattr(SpanKind, 'INTERNAL') else None,
            context=context,
        )
        
        # 设置属性
        span.set_attribute(AiObservationAttributes.AI_OPERATION_TYPE, AiOperationType.TOOL_CALL.value)
        span.set_attribute(AiObservationAttributes.AGENTICX_TOOL_NAME, tool_name)
        span.set_attribute("tool.args_count", len(tool_args))
        
        self._active_tool_spans[tool_key] = span
        
        # 存储 key 用于后续匹配
        tool_args["_otel_tool_key"] = tool_key
        
        # 收集 SpanTree 数据
        parent_id = None
        if parent_span:
            ctx = parent_span.get_span_context()
            parent_id = format(ctx.span_id, '016x') if ctx else None
        
        self._collect_span_data(
            span,
            name=f"tool.{tool_name}",
            parent_id=parent_id,
            attributes={"tool_name": tool_name}
        )
        
        logger.debug(f"Tool Span 已创建: {tool_key}")
    
    def on_tool_end(self, tool_name: str, result: Any, success: bool) -> None:
        """
        工具调用结束 - 关闭 Tool Span
        
        对应 loongsuite ExtendedTelemetryHandler.stop_execute_tool
        """
        if not self._tracer:
            return
        
        # 查找匹配的 Tool Span
        tool_key = None
        for key in list(self._active_tool_spans.keys()):
            if key.startswith(f"tool:{tool_name}:"):
                tool_key = key
                break
        
        if not tool_key:
            return
        
        span = self._active_tool_spans.pop(tool_key, None)
        if span:
            span.set_attribute("tool.success", success)
            
            if _OTEL_AVAILABLE:
                if success:
                    span.set_status(Status(StatusCode.OK))
                else:
                    span.set_status(Status(StatusCode.ERROR, f"Tool {tool_name} failed"))
            
            span.end()
            logger.debug(f"Tool Span 已关闭: {tool_key}, success={success}")
    
    # ============ 错误处理 ============
    
    def on_error(self, error: Exception, context: Dict[str, Any]) -> None:
        """
        错误发生 - 记录到当前 Span
        """
        if not self._tracer:
            return
        
        # 尝试找到当前活跃的 Span
        current_span = None
        if self._active_llm_spans:
            current_span = list(self._active_llm_spans.values())[-1]
        elif self._active_tool_spans:
            current_span = list(self._active_tool_spans.values())[-1]
        elif self._active_task_spans:
            current_span = list(self._active_task_spans.values())[-1]
        
        if current_span:
            # 记录异常
            if hasattr(current_span, 'record_exception'):
                current_span.record_exception(error)
            
            # 设置错误状态
            if _OTEL_AVAILABLE:
                current_span.set_status(Status(StatusCode.ERROR, str(error)))
            
            # 设置错误属性
            current_span.set_attribute(
                AiObservationAttributes.AGENTICX_ERROR_TYPE,
                type(error).__name__
            )
            current_span.set_attribute(
                AiObservationAttributes.AGENTICX_ERROR_RECOVERABLE,
                context.get("recoverable", True)
            )
    
    # ============ 工具方法 ============
    
    def _extract_provider(self, model: str) -> str:
        """从模型名称提取提供商"""
        model_lower = model.lower()
        if "gpt" in model_lower or "openai" in model_lower:
            return "openai"
        elif "claude" in model_lower or "anthropic" in model_lower:
            return "anthropic"
        elif "gemini" in model_lower or "google" in model_lower:
            return "google"
        elif "qwen" in model_lower or "tongyi" in model_lower:
            return "alibaba"
        elif "deepseek" in model_lower:
            return "deepseek"
        elif "llama" in model_lower or "meta" in model_lower:
            return "meta"
        else:
            return "unknown"
    
    def get_span_tree(self) -> SpanTree:
        """
        获取收集的 Span 数据作为 SpanTree
        
        Returns:
            SpanTree 实例，可用于分析和 Mermaid 导出
            
        Raises:
            RuntimeError: 如果 export_to_span_tree 未启用
        """
        if not self._config.export_to_span_tree:
            raise RuntimeError(
                "SpanTree 导出未启用。请在 OTelConfig 中设置 export_to_span_tree=True"
            )
        
        return SpanTree.from_spans(self._collected_spans)
    
    def clear_spans(self) -> None:
        """清除收集的 Span 数据"""
        self._collected_spans.clear()
        self._active_task_spans.clear()
        self._active_llm_spans.clear()
        self._active_tool_spans.clear()
    
    def get_stats(self) -> Dict[str, Any]:
        """获取处理器统计信息"""
        stats = super().get_stats()
        stats.update({
            "otel_enabled": self._config.enabled if self._config else False,
            "otel_available": _OTEL_AVAILABLE,
            "active_task_spans": len(self._active_task_spans),
            "active_llm_spans": len(self._active_llm_spans),
            "active_tool_spans": len(self._active_tool_spans),
            "collected_spans": len(self._collected_spans),
            "config": self._config.to_dict() if self._config else None,
        })
        return stats


__all__ = ["OTelCallbackHandler"]
