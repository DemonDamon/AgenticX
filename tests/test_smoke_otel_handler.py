"""
冒烟测试: OTelCallbackHandler

测试内容:
- Handler 初始化
- Task/LLM/Tool Span 生命周期
- SpanTree 导出
- 错误处理

内化来源: alibaba/loongsuite-python-agent
"""

import pytest
from unittest.mock import MagicMock, patch
from dataclasses import dataclass
from typing import Dict, Any, List, Optional


# Mock Agent 和 Task 类（用于测试）
@dataclass
class MockAgent:
    id: str = "agent-001"
    name: str = "TestAgent"
    role: str = "assistant"
    organization_id: str = "org-001"


@dataclass
class MockTask:
    id: str = "task-001"
    description: str = "Test task description"
    expected_output: str = "Expected output"


@dataclass
class MockTokenUsage:
    prompt_tokens: int = 100
    completion_tokens: int = 50
    total_tokens: int = 150


@dataclass
class MockLLMChoice:
    index: int = 0
    content: str = "Test response"
    finish_reason: str = "stop"


@dataclass
class MockLLMResponse:
    id: str = "resp-001"
    model_name: str = "gpt-4"
    content: str = "Test response content"
    token_usage: MockTokenUsage = None
    choices: List[MockLLMChoice] = None
    
    def __post_init__(self):
        if self.token_usage is None:
            self.token_usage = MockTokenUsage()
        if self.choices is None:
            self.choices = [MockLLMChoice()]


class TestOTelCallbackHandlerWithoutOTel:
    """测试无 OTel 依赖时的行为"""
    
    def test_handler_import(self):
        """测试 Handler 可以导入"""
        from agenticx.observability.otel import OTelCallbackHandler
        assert OTelCallbackHandler is not None
    
    def test_handler_init_without_otel(self):
        """测试无 OTel 时初始化不报错"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(enabled=False)
        handler = OTelCallbackHandler(config=config)
        
        assert handler is not None
        assert handler._config.enabled is False
    
    def test_handler_methods_noop_without_tracer(self):
        """测试无 Tracer 时方法为空操作"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(enabled=False)
        handler = OTelCallbackHandler(config=config)
        handler._tracer = None  # 确保无 tracer
        
        agent = MockAgent()
        task = MockTask()
        
        # 这些调用应该不抛出异常
        handler.on_task_start(agent, task)
        handler.on_llm_call("test prompt", "gpt-4", {})
        handler.on_tool_start("test_tool", {"arg1": "value1"})
        handler.on_tool_end("test_tool", "result", True)
        handler.on_llm_response(MockLLMResponse(), {})
        handler.on_task_end(agent, task, {"success": True})
        handler.on_error(Exception("test"), {})


class TestOTelCallbackHandlerWithMockOTel:
    """使用 Mock 测试 Handler 逻辑"""
    
    def test_on_task_start_creates_span(self):
        """测试 task_start 创建 Span"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(enabled=True)
        handler = OTelCallbackHandler(config=config)
        
        # Mock tracer
        mock_span = MagicMock()
        mock_span.get_span_context.return_value = MagicMock(
            span_id=12345,
            trace_id=67890
        )
        mock_tracer = MagicMock()
        mock_tracer.start_span.return_value = mock_span
        handler._tracer = mock_tracer
        
        agent = MockAgent()
        task = MockTask()
        
        handler.on_task_start(agent, task)
        
        # 验证 Span 创建
        mock_tracer.start_span.assert_called_once()
        call_args = mock_tracer.start_span.call_args
        assert "agent_task" in call_args[1].get("name", "") or "agent_task" in str(call_args)
        
        # 验证属性设置
        assert mock_span.set_attribute.called
        
        # 验证活跃 Span 被追踪
        assert len(handler._active_task_spans) == 1
    
    def test_on_task_end_closes_span(self):
        """测试 task_end 关闭 Span"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(enabled=True)
        handler = OTelCallbackHandler(config=config)
        
        # 设置 mock
        mock_span = MagicMock()
        mock_tracer = MagicMock()
        handler._tracer = mock_tracer
        
        agent = MockAgent()
        task = MockTask()
        
        # 手动添加活跃 Span
        span_key = handler._get_span_key(agent.id, task.id)
        handler._active_task_spans[span_key] = mock_span
        
        handler.on_task_end(agent, task, {"success": True})
        
        # 验证 Span 关闭
        mock_span.end.assert_called_once()
        
        # 验证活跃 Span 被移除
        assert len(handler._active_task_spans) == 0
    
    def test_on_llm_call_creates_span(self):
        """测试 llm_call 创建 Span"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(enabled=True)
        handler = OTelCallbackHandler(config=config)
        
        mock_span = MagicMock()
        mock_span.get_span_context.return_value = MagicMock(
            span_id=11111,
            trace_id=22222
        )
        mock_tracer = MagicMock()
        mock_tracer.start_span.return_value = mock_span
        handler._tracer = mock_tracer
        
        metadata = {"agent_id": "agent-001", "task_id": "task-001"}
        handler.on_llm_call("test prompt", "gpt-4", metadata)
        
        # 验证 Span 创建
        mock_tracer.start_span.assert_called_once()
        
        # 验证活跃 Span 被追踪
        assert len(handler._active_llm_spans) == 1
        
        # 验证 metadata 中存储了 key
        assert "_otel_llm_key" in metadata
    
    def test_on_tool_lifecycle(self):
        """测试 Tool Span 生命周期"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(enabled=True)
        handler = OTelCallbackHandler(config=config)
        
        mock_span = MagicMock()
        mock_tracer = MagicMock()
        mock_tracer.start_span.return_value = mock_span
        handler._tracer = mock_tracer
        
        tool_args = {"arg1": "value1"}
        
        # Start
        handler.on_tool_start("calculator", tool_args)
        assert len(handler._active_tool_spans) == 1
        
        # End
        handler.on_tool_end("calculator", "42", True)
        mock_span.end.assert_called_once()
        assert len(handler._active_tool_spans) == 0
    
    def test_provider_extraction(self):
        """测试提供商提取"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        handler = OTelCallbackHandler(config=OTelConfig())
        
        assert handler._extract_provider("gpt-4") == "openai"
        assert handler._extract_provider("gpt-3.5-turbo") == "openai"
        assert handler._extract_provider("claude-3-sonnet") == "anthropic"
        assert handler._extract_provider("gemini-pro") == "google"
        assert handler._extract_provider("qwen-turbo") == "alibaba"
        assert handler._extract_provider("deepseek-chat") == "deepseek"
        assert handler._extract_provider("llama-3-70b") == "meta"
        assert handler._extract_provider("custom-model") == "unknown"


class TestSpanTreeExport:
    """测试 SpanTree 导出功能"""
    
    def test_span_tree_disabled_by_default(self):
        """测试 SpanTree 默认禁用"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(export_to_span_tree=False)
        handler = OTelCallbackHandler(config=config)
        
        with pytest.raises(RuntimeError) as excinfo:
            handler.get_span_tree()
        
        assert "export_to_span_tree" in str(excinfo.value)
    
    def test_span_tree_export_enabled(self):
        """测试 SpanTree 导出启用"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(export_to_span_tree=True, enabled=True)
        handler = OTelCallbackHandler(config=config)
        
        # Mock tracer
        mock_span = MagicMock()
        mock_span.get_span_context.return_value = MagicMock(
            span_id=12345,
            trace_id=67890
        )
        mock_tracer = MagicMock()
        mock_tracer.start_span.return_value = mock_span
        handler._tracer = mock_tracer
        
        # 触发事件
        agent = MockAgent()
        task = MockTask()
        handler.on_task_start(agent, task)
        
        # 获取 SpanTree
        span_tree = handler.get_span_tree()
        
        assert span_tree is not None
        # 至少有一个收集的 span
        assert len(handler._collected_spans) >= 1


class TestHandlerStats:
    """测试处理器统计"""
    
    def test_get_stats(self):
        """测试获取统计信息"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(service_name="test-service")
        handler = OTelCallbackHandler(config=config)
        
        stats = handler.get_stats()
        
        assert isinstance(stats, dict)
        assert "otel_enabled" in stats
        assert "otel_available" in stats
        assert "active_task_spans" in stats
        assert "active_llm_spans" in stats
        assert "active_tool_spans" in stats
        assert "config" in stats
    
    def test_clear_spans(self):
        """测试清除 Span 数据"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(export_to_span_tree=True)
        handler = OTelCallbackHandler(config=config)
        
        # 添加一些数据
        handler._collected_spans.append({"name": "test"})
        handler._active_task_spans["key1"] = MagicMock()
        
        handler.clear_spans()
        
        assert len(handler._collected_spans) == 0
        assert len(handler._active_task_spans) == 0


class TestErrorHandling:
    """测试错误处理"""
    
    def test_on_error_records_exception(self):
        """测试错误记录"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        config = OTelConfig(enabled=True)
        handler = OTelCallbackHandler(config=config)
        
        mock_span = MagicMock()
        handler._tracer = MagicMock()
        handler._active_task_spans["key"] = mock_span
        
        test_error = ValueError("Test error")
        handler.on_error(test_error, {"recoverable": True})
        
        # 验证异常被记录
        if hasattr(mock_span, 'record_exception'):
            mock_span.record_exception.assert_called_with(test_error)
    
    def test_on_error_no_active_span(self):
        """测试无活跃 Span 时的错误处理"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        handler = OTelCallbackHandler(config=OTelConfig(enabled=True))
        handler._tracer = MagicMock()
        
        # 清空所有活跃 Span
        handler._active_task_spans.clear()
        handler._active_llm_spans.clear()
        handler._active_tool_spans.clear()
        
        # 不应抛出异常
        handler.on_error(Exception("test"), {})


class TestEdgeCases:
    """边界条件测试"""
    
    def test_llm_response_without_matching_call(self):
        """测试 LLM 响应没有匹配的调用"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        handler = OTelCallbackHandler(config=OTelConfig(enabled=True))
        handler._tracer = MagicMock()
        
        # 直接调用 response 而没有 call
        response = MockLLMResponse()
        handler.on_llm_response(response, {})  # 不应抛出异常
    
    def test_tool_end_without_matching_start(self):
        """测试 Tool 结束没有匹配的开始"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        handler = OTelCallbackHandler(config=OTelConfig(enabled=True))
        handler._tracer = MagicMock()
        
        # 直接调用 end 而没有 start
        handler.on_tool_end("unknown_tool", "result", True)  # 不应抛出异常
    
    def test_task_end_without_matching_start(self):
        """测试 Task 结束没有匹配的开始"""
        from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
        
        handler = OTelCallbackHandler(config=OTelConfig(enabled=True))
        handler._tracer = MagicMock()
        
        agent = MockAgent()
        task = MockTask()
        
        # 直接调用 end 而没有 start
        handler.on_task_end(agent, task, {"success": True})  # 不应抛出异常
    
    def test_span_key_generation(self):
        """测试 Span key 生成"""
        from agenticx.observability.otel import OTelCallbackHandler
        
        handler = OTelCallbackHandler()
        
        assert handler._get_span_key("agent-1", "task-1") == "agent-1:task-1"
        assert handler._get_span_key(None, "task-1") == "unknown:task-1"
        assert handler._get_span_key("agent-1", None) == "agent-1:unknown"
        assert handler._get_span_key(None, None) == "unknown:unknown"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
