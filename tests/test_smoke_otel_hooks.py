"""
冒烟测试: OpenTelemetry Hooks 桥接

测试内容:
- register_otel_hooks() 注册
- unregister_otel_hooks() 注销
- LLM/Tool hooks 集成

内化来源: alibaba/loongsuite-python-agent
"""

import pytest
from unittest.mock import MagicMock, patch
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional


@dataclass
class MockLLMCallHookContext:
    """Mock LLMCallHookContext"""
    messages: List[Dict[str, Any]] = field(default_factory=list)
    agent_id: Optional[str] = "agent-001"
    agent_name: Optional[str] = "TestAgent"
    task_id: Optional[str] = "task-001"
    iterations: int = 1
    response: Optional[str] = None
    model_name: Optional[str] = "gpt-4"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MockToolCallHookContext:
    """Mock ToolCallHookContext"""
    tool_name: str = "calculator"
    tool_args: Dict[str, Any] = field(default_factory=dict)
    agent_id: Optional[str] = "agent-001"
    result: Optional[Any] = None
    success: bool = True
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class TestOTelHooksRegistration:
    """测试 OTel Hooks 注册/注销"""
    
    def test_register_otel_hooks_import(self):
        """测试函数可导入"""
        from agenticx.observability.otel import (
            register_otel_hooks,
            unregister_otel_hooks,
            is_otel_hooks_registered,
        )
        assert register_otel_hooks is not None
        assert unregister_otel_hooks is not None
        assert is_otel_hooks_registered is not None
    
    def test_is_otel_hooks_registered_returns_bool(self):
        """测试注册状态返回布尔值"""
        from agenticx.observability.otel import is_otel_hooks_registered
        result = is_otel_hooks_registered()
        assert isinstance(result, bool)
    
    @pytest.mark.skipif(
        not pytest.importorskip("opentelemetry.sdk", reason="OTel SDK not installed"),
        reason="OpenTelemetry SDK not installed"
    )
    def test_register_and_unregister_hooks(self):
        """测试注册和注销 hooks"""
        from agenticx.observability.otel import (
            register_otel_hooks,
            unregister_otel_hooks,
            is_otel_hooks_registered,
        )
        from agenticx.observability.otel.hooks import _hooks_registered
        
        # 确保清理状态
        if is_otel_hooks_registered():
            unregister_otel_hooks()
        
        try:
            # 注册
            result = register_otel_hooks(service_name="test-hooks")
            assert result is True
            assert is_otel_hooks_registered() is True
            
            # 重复注册应该跳过
            result = register_otel_hooks()
            assert result is True
            
            # 注销
            result = unregister_otel_hooks()
            assert result is True
            assert is_otel_hooks_registered() is False
            
            # 重复注销应该返回 False
            result = unregister_otel_hooks()
            assert result is False
            
        finally:
            # 清理
            if is_otel_hooks_registered():
                unregister_otel_hooks()


class TestOTelHooksWithMock:
    """使用 Mock 测试 Hooks 逻辑"""
    
    def test_before_llm_call_hook(self):
        """测试 LLM 调用前 hook"""
        from agenticx.observability.otel.hooks import (
            _otel_before_llm_call,
            _active_spans,
            _tracer,
        )
        import agenticx.observability.otel.hooks as hooks_module
        
        # 保存原始状态
        original_tracer = hooks_module._tracer
        original_spans = hooks_module._active_spans.copy()
        
        try:
            # Mock tracer
            mock_span = MagicMock()
            mock_tracer = MagicMock()
            mock_tracer.start_span.return_value = mock_span
            hooks_module._tracer = mock_tracer
            hooks_module._active_spans = {}
            
            # 创建 context
            ctx = MockLLMCallHookContext()
            
            # 调用 hook
            _otel_before_llm_call(ctx)
            
            # 验证 Span 创建
            mock_tracer.start_span.assert_called_once()
            
            # 验证属性设置
            assert mock_span.set_attribute.called
            
            # 验证 Span 被追踪
            assert len(hooks_module._active_spans) == 1
            
            # 验证 metadata 中存储了 key
            assert "_otel_span_key" in ctx.metadata
            
        finally:
            # 恢复
            hooks_module._tracer = original_tracer
            hooks_module._active_spans = original_spans
    
    def test_after_llm_call_hook(self):
        """测试 LLM 调用后 hook"""
        from agenticx.observability.otel.hooks import (
            _otel_after_llm_call,
        )
        import agenticx.observability.otel.hooks as hooks_module
        
        original_spans = hooks_module._active_spans.copy()
        
        try:
            # 设置 mock span
            mock_span = MagicMock()
            span_key = "llm:test123"
            hooks_module._active_spans = {span_key: mock_span}
            
            # 创建 context
            ctx = MockLLMCallHookContext(response="Test response")
            ctx.metadata["_otel_span_key"] = span_key
            
            # 调用 hook
            result = _otel_after_llm_call(ctx)
            
            # 验证返回 None（不修改响应）
            assert result is None
            
            # 验证 Span 关闭
            mock_span.end.assert_called_once()
            
            # 验证 Span 被移除
            assert span_key not in hooks_module._active_spans
            
        finally:
            hooks_module._active_spans = original_spans
    
    def test_tool_hooks_lifecycle(self):
        """测试 Tool hooks 生命周期"""
        from agenticx.observability.otel.hooks import (
            _otel_before_tool_call,
            _otel_after_tool_call,
        )
        import agenticx.observability.otel.hooks as hooks_module
        
        original_tracer = hooks_module._tracer
        original_spans = hooks_module._active_spans.copy()
        
        try:
            # Mock tracer
            mock_span = MagicMock()
            mock_tracer = MagicMock()
            mock_tracer.start_span.return_value = mock_span
            hooks_module._tracer = mock_tracer
            hooks_module._active_spans = {}
            
            # 创建 context
            ctx = MockToolCallHookContext(tool_name="calculator", tool_args={"a": 1, "b": 2})
            
            # Before hook
            _otel_before_tool_call(ctx)
            assert len(hooks_module._active_spans) == 1
            
            # After hook
            ctx.result = 3
            ctx.success = True
            _otel_after_tool_call(ctx)
            
            # 验证 Span 关闭
            mock_span.end.assert_called_once()
            
        finally:
            hooks_module._tracer = original_tracer
            hooks_module._active_spans = original_spans


class TestHooksWithoutOTel:
    """测试无 OTel 时的行为"""
    
    def test_hooks_noop_without_tracer(self):
        """测试无 tracer 时 hooks 为空操作"""
        from agenticx.observability.otel.hooks import (
            _otel_before_llm_call,
            _otel_after_llm_call,
            _otel_before_tool_call,
            _otel_after_tool_call,
        )
        import agenticx.observability.otel.hooks as hooks_module
        
        original_tracer = hooks_module._tracer
        
        try:
            hooks_module._tracer = None
            
            ctx = MockLLMCallHookContext()
            
            # 这些调用应该不抛出异常
            _otel_before_llm_call(ctx)
            _otel_after_llm_call(ctx)
            
            tool_ctx = MockToolCallHookContext()
            _otel_before_tool_call(tool_ctx)
            _otel_after_tool_call(tool_ctx)
            
        finally:
            hooks_module._tracer = original_tracer


class TestEdgeCases:
    """边界条件测试"""
    
    def test_after_hook_without_matching_before(self):
        """测试 after hook 没有匹配的 before"""
        from agenticx.observability.otel.hooks import _otel_after_llm_call
        import agenticx.observability.otel.hooks as hooks_module
        
        original_spans = hooks_module._active_spans.copy()
        
        try:
            hooks_module._active_spans = {}
            
            ctx = MockLLMCallHookContext()
            # 没有 _otel_span_key
            
            # 不应抛出异常
            result = _otel_after_llm_call(ctx)
            assert result is None
            
        finally:
            hooks_module._active_spans = original_spans
    
    def test_hooks_with_none_values(self):
        """测试 hooks 处理 None 值"""
        from agenticx.observability.otel.hooks import _otel_before_llm_call
        import agenticx.observability.otel.hooks as hooks_module
        
        original_tracer = hooks_module._tracer
        original_spans = hooks_module._active_spans.copy()
        
        try:
            mock_span = MagicMock()
            mock_tracer = MagicMock()
            mock_tracer.start_span.return_value = mock_span
            hooks_module._tracer = mock_tracer
            hooks_module._active_spans = {}
            
            # Context 中有 None 值
            ctx = MockLLMCallHookContext(
                agent_id=None,
                agent_name=None,
                task_id=None,
                model_name=None,
            )
            
            # 不应抛出异常
            _otel_before_llm_call(ctx)
            
        finally:
            hooks_module._tracer = original_tracer
            hooks_module._active_spans = original_spans


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
