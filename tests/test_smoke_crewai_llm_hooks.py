"""
LLM Hooks 冒烟测试

验证 LLM Hooks 系统的核心功能：
- before_llm_call 钩子注册与触发
- after_llm_call 钩子注册与触发
- 钩子阻止执行功能
- 钩子修改响应功能
"""

import pytest
from agenticx.hooks.llm_hooks import (
    LLMCallHookContext,
    register_before_llm_call_hook,
    register_after_llm_call_hook,
    get_before_llm_call_hooks,
    get_after_llm_call_hooks,
    unregister_before_llm_call_hook,
    unregister_after_llm_call_hook,
    clear_before_llm_call_hooks,
    clear_after_llm_call_hooks,
    clear_all_llm_call_hooks,
    execute_before_llm_call_hooks,
    execute_after_llm_call_hooks,
)


@pytest.fixture(autouse=True)
def cleanup_hooks():
    """每个测试后清理所有钩子"""
    yield
    clear_all_llm_call_hooks()


class TestLLMCallHookContext:
    """测试 LLMCallHookContext 数据类"""
    
    def test_context_creation_basic(self):
        """测试基本上下文创建"""
        messages = [{"role": "user", "content": "Hello"}]
        context = LLMCallHookContext(messages=messages)
        
        assert context.messages == messages
        assert context.agent_id is None
        assert context.agent_name is None
        assert context.iterations == 0
        assert context.response is None
    
    def test_context_creation_full(self):
        """测试完整上下文创建"""
        messages = [{"role": "user", "content": "Hello"}]
        context = LLMCallHookContext(
            messages=messages,
            agent_id="agent-001",
            agent_name="TestAgent",
            task_id="task-001",
            iterations=3,
            response="Hello back!",
            model_name="gpt-4",
            metadata={"key": "value"}
        )
        
        assert context.messages == messages
        assert context.agent_id == "agent-001"
        assert context.agent_name == "TestAgent"
        assert context.task_id == "task-001"
        assert context.iterations == 3
        assert context.response == "Hello back!"
        assert context.model_name == "gpt-4"
        assert context.metadata == {"key": "value"}
    
    def test_context_default_messages_none(self):
        """测试 messages 为 None 时的默认值"""
        context = LLMCallHookContext(messages=None)  # type: ignore
        assert context.messages == []


class TestBeforeLLMCallHooks:
    """测试 before_llm_call 钩子"""
    
    def test_register_hook(self):
        """测试注册钩子"""
        def my_hook(ctx: LLMCallHookContext) -> None:
            pass
        
        register_before_llm_call_hook(my_hook)
        hooks = get_before_llm_call_hooks()
        
        assert len(hooks) == 1
        assert hooks[0] is my_hook
    
    def test_register_hook_no_duplicates(self):
        """测试重复注册不会添加多个"""
        def my_hook(ctx: LLMCallHookContext) -> None:
            pass
        
        register_before_llm_call_hook(my_hook)
        register_before_llm_call_hook(my_hook)  # 重复注册
        hooks = get_before_llm_call_hooks()
        
        assert len(hooks) == 1
    
    def test_unregister_hook(self):
        """测试注销钩子"""
        def my_hook(ctx: LLMCallHookContext) -> None:
            pass
        
        register_before_llm_call_hook(my_hook)
        result = unregister_before_llm_call_hook(my_hook)
        
        assert result is True
        assert len(get_before_llm_call_hooks()) == 0
    
    def test_unregister_nonexistent_hook(self):
        """测试注销不存在的钩子"""
        def my_hook(ctx: LLMCallHookContext) -> None:
            pass
        
        result = unregister_before_llm_call_hook(my_hook)
        assert result is False
    
    def test_hook_allows_execution(self):
        """测试钩子允许执行"""
        called = False
        
        def allowing_hook(ctx: LLMCallHookContext) -> None:
            nonlocal called
            called = True
            return None  # 允许执行
        
        register_before_llm_call_hook(allowing_hook)
        context = LLMCallHookContext(messages=[])
        result = execute_before_llm_call_hooks(context)
        
        assert called is True
        assert result is True  # 允许执行
    
    def test_hook_blocks_execution(self):
        """测试钩子阻止执行"""
        def blocking_hook(ctx: LLMCallHookContext) -> bool:
            return False  # 阻止执行
        
        register_before_llm_call_hook(blocking_hook)
        context = LLMCallHookContext(messages=[])
        result = execute_before_llm_call_hooks(context)
        
        assert result is False  # 被阻止
    
    def test_hook_can_modify_messages(self):
        """测试钩子可以修改消息"""
        def modifying_hook(ctx: LLMCallHookContext) -> None:
            ctx.messages.append({"role": "system", "content": "Added by hook"})
            return None
        
        register_before_llm_call_hook(modifying_hook)
        messages = [{"role": "user", "content": "Hello"}]
        context = LLMCallHookContext(messages=messages)
        execute_before_llm_call_hooks(context)
        
        assert len(context.messages) == 2
        assert context.messages[1]["content"] == "Added by hook"
    
    def test_hook_receives_context(self):
        """测试钩子接收正确的上下文"""
        received_context = None
        
        def capturing_hook(ctx: LLMCallHookContext) -> None:
            nonlocal received_context
            received_context = ctx
            return None
        
        register_before_llm_call_hook(capturing_hook)
        context = LLMCallHookContext(
            messages=[{"role": "user", "content": "Test"}],
            agent_name="TestAgent",
            iterations=5
        )
        execute_before_llm_call_hooks(context)
        
        assert received_context is not None
        assert received_context.agent_name == "TestAgent"
        assert received_context.iterations == 5
    
    def test_multiple_hooks_execution_order(self):
        """测试多个钩子按注册顺序执行"""
        execution_order = []
        
        def hook1(ctx: LLMCallHookContext) -> None:
            execution_order.append(1)
            return None
        
        def hook2(ctx: LLMCallHookContext) -> None:
            execution_order.append(2)
            return None
        
        register_before_llm_call_hook(hook1)
        register_before_llm_call_hook(hook2)
        
        context = LLMCallHookContext(messages=[])
        execute_before_llm_call_hooks(context)
        
        assert execution_order == [1, 2]
    
    def test_hook_error_does_not_block(self):
        """测试钩子错误不阻止执行"""
        def error_hook(ctx: LLMCallHookContext) -> None:
            raise ValueError("Hook error")
        
        def good_hook(ctx: LLMCallHookContext) -> None:
            return None
        
        register_before_llm_call_hook(error_hook)
        register_before_llm_call_hook(good_hook)
        
        context = LLMCallHookContext(messages=[])
        result = execute_before_llm_call_hooks(context)
        
        assert result is True  # 错误不阻止执行


class TestAfterLLMCallHooks:
    """测试 after_llm_call 钩子"""
    
    def test_register_hook(self):
        """测试注册钩子"""
        def my_hook(ctx: LLMCallHookContext) -> str | None:
            return None
        
        register_after_llm_call_hook(my_hook)
        hooks = get_after_llm_call_hooks()
        
        assert len(hooks) == 1
        assert hooks[0] is my_hook
    
    def test_hook_modifies_response(self):
        """测试钩子修改响应"""
        def sanitize_hook(ctx: LLMCallHookContext) -> str | None:
            if ctx.response and "SECRET" in ctx.response:
                return ctx.response.replace("SECRET", "[REDACTED]")
            return None
        
        register_after_llm_call_hook(sanitize_hook)
        context = LLMCallHookContext(
            messages=[],
            response="The SECRET is here"
        )
        result = execute_after_llm_call_hooks(context)
        
        assert result == "The [REDACTED] is here"
    
    def test_hook_keeps_original_response(self):
        """测试钩子返回 None 保持原响应"""
        def passthrough_hook(ctx: LLMCallHookContext) -> str | None:
            return None
        
        register_after_llm_call_hook(passthrough_hook)
        context = LLMCallHookContext(
            messages=[],
            response="Original response"
        )
        result = execute_after_llm_call_hooks(context)
        
        assert result is None  # 保持原响应
    
    def test_multiple_hooks_chain_modifications(self):
        """测试多个钩子链式修改"""
        def hook1(ctx: LLMCallHookContext) -> str | None:
            if ctx.response:
                return ctx.response.upper()
            return None
        
        def hook2(ctx: LLMCallHookContext) -> str | None:
            if ctx.response:
                return ctx.response + " [PROCESSED]"
            return None
        
        register_after_llm_call_hook(hook1)
        register_after_llm_call_hook(hook2)
        
        context = LLMCallHookContext(
            messages=[],
            response="hello"
        )
        result = execute_after_llm_call_hooks(context)
        
        # hook1 将 "hello" 变为 "HELLO"
        # hook2 将 "HELLO" 变为 "HELLO [PROCESSED]"
        assert result == "HELLO [PROCESSED]"
    
    def test_hook_can_modify_messages(self):
        """测试 after 钩子可以修改消息（用于下一次迭代）"""
        def modifying_hook(ctx: LLMCallHookContext) -> str | None:
            ctx.messages.append({"role": "assistant", "content": ctx.response or ""})
            return None
        
        register_after_llm_call_hook(modifying_hook)
        messages = [{"role": "user", "content": "Hello"}]
        context = LLMCallHookContext(
            messages=messages,
            response="Hello back!"
        )
        execute_after_llm_call_hooks(context)
        
        assert len(context.messages) == 2
        assert context.messages[1]["role"] == "assistant"


class TestClearHooks:
    """测试清除钩子功能"""
    
    def test_clear_before_hooks(self):
        """测试清除 before 钩子"""
        def hook1(ctx): return None
        def hook2(ctx): return None
        
        register_before_llm_call_hook(hook1)
        register_before_llm_call_hook(hook2)
        
        count = clear_before_llm_call_hooks()
        
        assert count == 2
        assert len(get_before_llm_call_hooks()) == 0
    
    def test_clear_after_hooks(self):
        """测试清除 after 钩子"""
        def hook1(ctx): return None
        def hook2(ctx): return None
        
        register_after_llm_call_hook(hook1)
        register_after_llm_call_hook(hook2)
        
        count = clear_after_llm_call_hooks()
        
        assert count == 2
        assert len(get_after_llm_call_hooks()) == 0
    
    def test_clear_all_hooks(self):
        """测试清除所有钩子"""
        def before_hook(ctx): return None
        def after_hook(ctx): return None
        
        register_before_llm_call_hook(before_hook)
        register_after_llm_call_hook(after_hook)
        
        before_count, after_count = clear_all_llm_call_hooks()
        
        assert before_count == 1
        assert after_count == 1
        assert len(get_before_llm_call_hooks()) == 0
        assert len(get_after_llm_call_hooks()) == 0


class TestEdgeCases:
    """测试边界情况"""
    
    def test_empty_hooks_list(self):
        """测试空钩子列表"""
        context = LLMCallHookContext(messages=[])
        
        before_result = execute_before_llm_call_hooks(context)
        after_result = execute_after_llm_call_hooks(context)
        
        assert before_result is True
        assert after_result is None
    
    def test_hook_with_empty_context(self):
        """测试空上下文"""
        called = False
        
        def hook(ctx: LLMCallHookContext) -> None:
            nonlocal called
            called = True
            assert ctx.messages == []
            return None
        
        register_before_llm_call_hook(hook)
        context = LLMCallHookContext(messages=[])
        execute_before_llm_call_hooks(context)
        
        assert called is True
    
    def test_first_blocking_hook_stops_chain(self):
        """测试第一个阻止钩子停止后续钩子"""
        second_called = False
        
        def blocking_hook(ctx: LLMCallHookContext) -> bool:
            return False
        
        def second_hook(ctx: LLMCallHookContext) -> None:
            nonlocal second_called
            second_called = True
            return None
        
        register_before_llm_call_hook(blocking_hook)
        register_before_llm_call_hook(second_hook)
        
        context = LLMCallHookContext(messages=[])
        result = execute_before_llm_call_hooks(context)
        
        assert result is False
        assert second_called is False  # 第二个钩子未被调用

