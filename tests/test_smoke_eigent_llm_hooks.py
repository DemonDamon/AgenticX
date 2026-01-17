"""
Eigent LLM Hooks 冒烟测试

测试 LLM Hooks 的基本功能：注册、执行、阻止执行。
"""

import pytest
from datetime import datetime

from agenticx.core.hooks import (
    LLMCallHookContext,
    register_before_llm_call_hook,
    register_after_llm_call_hook,
    unregister_before_llm_call_hook,
    unregister_after_llm_call_hook,
    execute_before_llm_call_hooks,
    execute_after_llm_call_hooks,
    clear_all_llm_hooks,
    get_registered_llm_hooks,
)


@pytest.fixture(autouse=True)
def cleanup_hooks():
    """每个测试后清理 hooks"""
    yield
    clear_all_llm_hooks()


def test_register_and_execute_before_llm_hook():
    """测试注册和执行 before LLM hook"""
    called = []
    
    def my_hook(ctx: LLMCallHookContext) -> bool:
        called.append(ctx.agent_id)
        return True
    
    register_before_llm_call_hook(my_hook)
    
    # 检查注册成功
    hooks = get_registered_llm_hooks()
    assert "my_hook" in hooks["before"]
    
    # 执行 hook
    context = LLMCallHookContext(
        agent_id="test_agent",
        task_id="test_task",
        messages=[],
    )
    result = execute_before_llm_call_hooks(context)
    
    assert result is True
    assert "test_agent" in called


def test_register_and_execute_after_llm_hook():
    """测试注册和执行 after LLM hook"""
    called = []
    
    def my_hook(ctx: LLMCallHookContext) -> bool:
        called.append(ctx.agent_id)
        if ctx.response:
            called.append("has_response")
        return True
    
    register_after_llm_call_hook(my_hook)
    
    # 执行 hook
    context = LLMCallHookContext(
        agent_id="test_agent",
        response="Test response",
        tokens_used=100,
    )
    result = execute_after_llm_call_hooks(context)
    
    assert result is True
    assert "test_agent" in called
    assert "has_response" in called


def test_hook_blocks_execution():
    """测试 hook 可以阻止执行"""
    def blocking_hook(ctx: LLMCallHookContext) -> bool:
        return False  # 阻止执行
    
    register_before_llm_call_hook(blocking_hook)
    
    context = LLMCallHookContext(agent_id="test_agent")
    result = execute_before_llm_call_hooks(context)
    
    assert result is False


def test_multiple_hooks_execution_order():
    """测试多个 hooks 按注册顺序执行"""
    execution_order = []
    
    def hook1(ctx: LLMCallHookContext) -> bool:
        execution_order.append(1)
        return True
    
    def hook2(ctx: LLMCallHookContext) -> bool:
        execution_order.append(2)
        return True
    
    def hook3(ctx: LLMCallHookContext) -> bool:
        execution_order.append(3)
        return True
    
    register_before_llm_call_hook(hook1)
    register_before_llm_call_hook(hook2)
    register_before_llm_call_hook(hook3)
    
    context = LLMCallHookContext(agent_id="test_agent")
    execute_before_llm_call_hooks(context)
    
    assert execution_order == [1, 2, 3]


def test_agent_level_hooks():
    """测试 Agent 级别的 hooks"""
    global_called = []
    agent_called = []
    
    def global_hook(ctx: LLMCallHookContext) -> bool:
        global_called.append("global")
        return True
    
    def agent_hook(ctx: LLMCallHookContext) -> bool:
        agent_called.append("agent")
        return True
    
    register_before_llm_call_hook(global_hook)
    
    context = LLMCallHookContext(agent_id="test_agent")
    execute_before_llm_call_hooks(context, agent_hooks=[agent_hook])
    
    # 全局 hook 和 agent hook 都应该被调用
    assert "global" in global_called
    assert "agent" in agent_called


def test_hook_error_handling():
    """测试 hook 错误处理"""
    successful_called = []
    
    def error_hook(ctx: LLMCallHookContext) -> bool:
        raise ValueError("Intentional error")
    
    def successful_hook(ctx: LLMCallHookContext) -> bool:
        successful_called.append("success")
        return True
    
    register_before_llm_call_hook(error_hook)
    register_before_llm_call_hook(successful_hook)
    
    context = LLMCallHookContext(agent_id="test_agent")
    result = execute_before_llm_call_hooks(context)
    
    # 错误不应该阻止其他 hooks 执行
    assert result is True
    assert "success" in successful_called


def test_unregister_hook():
    """测试取消注册 hook"""
    called = []
    
    def my_hook(ctx: LLMCallHookContext) -> bool:
        called.append("called")
        return True
    
    register_before_llm_call_hook(my_hook)
    unregister_before_llm_call_hook(my_hook)
    
    hooks = get_registered_llm_hooks()
    assert "my_hook" not in hooks["before"]
    
    context = LLMCallHookContext(agent_id="test_agent")
    execute_before_llm_call_hooks(context)
    
    # hook 不应该被调用
    assert len(called) == 0


def test_duplicate_registration():
    """测试重复注册同一个 hook"""
    def my_hook(ctx: LLMCallHookContext) -> bool:
        return True
    
    register_before_llm_call_hook(my_hook)
    register_before_llm_call_hook(my_hook)  # 重复注册
    
    hooks = get_registered_llm_hooks()
    # 应该只注册一次
    assert hooks["before"].count("my_hook") == 1


def test_context_fields():
    """测试上下文字段完整性"""
    captured_context = None
    
    def capture_hook(ctx: LLMCallHookContext) -> bool:
        nonlocal captured_context
        captured_context = ctx
        return True
    
    register_before_llm_call_hook(capture_hook)
    
    context = LLMCallHookContext(
        agent_id="test_agent",
        task_id="test_task",
        messages=["msg1", "msg2"],
        model="gpt-4",
        temperature=0.7,
        max_tokens=1000,
        iteration=3,
    )
    execute_before_llm_call_hooks(context)
    
    assert captured_context.agent_id == "test_agent"
    assert captured_context.task_id == "test_task"
    assert len(captured_context.messages) == 2
    assert captured_context.model == "gpt-4"
    assert captured_context.temperature == 0.7
    assert captured_context.max_tokens == 1000
    assert captured_context.iteration == 3
