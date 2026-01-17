"""
Eigent Tool Hooks 冒烟测试

测试 Tool Hooks 的基本功能：注册、执行、阻止执行。
"""

import pytest
from datetime import datetime

from agenticx.core.hooks import (
    ToolCallHookContext,
    register_before_tool_call_hook,
    register_after_tool_call_hook,
    unregister_before_tool_call_hook,
    unregister_after_tool_call_hook,
    execute_before_tool_call_hooks,
    execute_after_tool_call_hooks,
    clear_all_tool_hooks,
    get_registered_tool_hooks,
)


@pytest.fixture(autouse=True)
def cleanup_hooks():
    """每个测试后清理 hooks"""
    yield
    clear_all_tool_hooks()


def test_register_and_execute_before_tool_hook():
    """测试注册和执行 before tool hook"""
    called = []
    
    def my_hook(ctx: ToolCallHookContext) -> bool:
        called.append(ctx.tool_name)
        return True
    
    register_before_tool_call_hook(my_hook)
    
    # 检查注册成功
    hooks = get_registered_tool_hooks()
    assert "my_hook" in hooks["before"]
    
    # 执行 hook
    context = ToolCallHookContext(
        agent_id="test_agent",
        tool_name="test_tool",
        tool_args={"arg1": "value1"},
    )
    result = execute_before_tool_call_hooks(context)
    
    assert result is True
    assert "test_tool" in called


def test_register_and_execute_after_tool_hook():
    """测试注册和执行 after tool hook"""
    called = []
    
    def my_hook(ctx: ToolCallHookContext) -> bool:
        called.append(ctx.tool_name)
        if ctx.result:
            called.append("has_result")
        if ctx.error:
            called.append("has_error")
        return True
    
    register_after_tool_call_hook(my_hook)
    
    # 测试成功的工具调用
    context = ToolCallHookContext(
        agent_id="test_agent",
        tool_name="test_tool",
        result="Success result",
        success=True,
    )
    result = execute_after_tool_call_hooks(context)
    
    assert result is True
    assert "test_tool" in called
    assert "has_result" in called


def test_hook_blocks_tool_execution():
    """测试 hook 可以阻止工具执行"""
    def blocking_hook(ctx: ToolCallHookContext) -> bool:
        if ctx.tool_name == "dangerous_tool":
            return False  # 阻止执行
        return True
    
    register_before_tool_call_hook(blocking_hook)
    
    # 测试阻止危险工具
    context = ToolCallHookContext(
        agent_id="test_agent",
        tool_name="dangerous_tool",
    )
    result = execute_before_tool_call_hooks(context)
    assert result is False
    
    # 测试允许安全工具
    context2 = ToolCallHookContext(
        agent_id="test_agent",
        tool_name="safe_tool",
    )
    result2 = execute_before_tool_call_hooks(context2)
    assert result2 is True


def test_tool_hook_execution_order():
    """测试多个工具 hooks 按注册顺序执行"""
    execution_order = []
    
    def hook1(ctx: ToolCallHookContext) -> bool:
        execution_order.append(1)
        return True
    
    def hook2(ctx: ToolCallHookContext) -> bool:
        execution_order.append(2)
        return True
    
    register_before_tool_call_hook(hook1)
    register_before_tool_call_hook(hook2)
    
    context = ToolCallHookContext(agent_id="test_agent", tool_name="test_tool")
    execute_before_tool_call_hooks(context)
    
    assert execution_order == [1, 2]


def test_agent_level_tool_hooks():
    """测试 Agent 级别的工具 hooks"""
    global_called = []
    agent_called = []
    
    def global_hook(ctx: ToolCallHookContext) -> bool:
        global_called.append("global")
        return True
    
    def agent_hook(ctx: ToolCallHookContext) -> bool:
        agent_called.append("agent")
        return True
    
    register_before_tool_call_hook(global_hook)
    
    context = ToolCallHookContext(agent_id="test_agent", tool_name="test_tool")
    execute_before_tool_call_hooks(context, agent_hooks=[agent_hook])
    
    # 全局 hook 和 agent hook 都应该被调用
    assert "global" in global_called
    assert "agent" in agent_called


def test_tool_hook_error_handling():
    """测试工具 hook 错误处理"""
    successful_called = []
    
    def error_hook(ctx: ToolCallHookContext) -> bool:
        raise ValueError("Intentional error")
    
    def successful_hook(ctx: ToolCallHookContext) -> bool:
        successful_called.append("success")
        return True
    
    register_before_tool_call_hook(error_hook)
    register_before_tool_call_hook(successful_hook)
    
    context = ToolCallHookContext(agent_id="test_agent", tool_name="test_tool")
    result = execute_before_tool_call_hooks(context)
    
    # 错误不应该阻止其他 hooks 执行
    assert result is True
    assert "success" in successful_called


def test_unregister_tool_hook():
    """测试取消注册工具 hook"""
    called = []
    
    def my_hook(ctx: ToolCallHookContext) -> bool:
        called.append("called")
        return True
    
    register_before_tool_call_hook(my_hook)
    unregister_before_tool_call_hook(my_hook)
    
    hooks = get_registered_tool_hooks()
    assert "my_hook" not in hooks["before"]
    
    context = ToolCallHookContext(agent_id="test_agent", tool_name="test_tool")
    execute_before_tool_call_hooks(context)
    
    # hook 不应该被调用
    assert len(called) == 0


def test_tool_context_fields():
    """测试工具上下文字段完整性"""
    captured_context = None
    
    def capture_hook(ctx: ToolCallHookContext) -> bool:
        nonlocal captured_context
        captured_context = ctx
        return True
    
    register_after_tool_call_hook(capture_hook)
    
    context = ToolCallHookContext(
        agent_id="test_agent",
        task_id="test_task",
        tool_name="calculator",
        tool_args={"a": 1, "b": 2},
        result=3,
        success=True,
        duration_ms=45.5,
        iteration=2,
    )
    execute_after_tool_call_hooks(context)
    
    assert captured_context.agent_id == "test_agent"
    assert captured_context.task_id == "test_task"
    assert captured_context.tool_name == "calculator"
    assert captured_context.tool_args == {"a": 1, "b": 2}
    assert captured_context.result == 3
    assert captured_context.success is True
    assert captured_context.duration_ms == 45.5
    assert captured_context.iteration == 2


def test_tool_error_context():
    """测试工具错误上下文"""
    captured_context = None
    
    def capture_hook(ctx: ToolCallHookContext) -> bool:
        nonlocal captured_context
        captured_context = ctx
        return True
    
    register_after_tool_call_hook(capture_hook)
    
    error = ValueError("Tool execution failed")
    context = ToolCallHookContext(
        agent_id="test_agent",
        tool_name="failing_tool",
        success=False,
        error=error,
    )
    execute_after_tool_call_hooks(context)
    
    assert captured_context.success is False
    assert captured_context.error == error
