"""
Tool Hooks 冒烟测试

验证 Tool Hooks 系统的核心功能：
- before_tool_call 钩子注册与触发
- after_tool_call 钩子注册与触发
- 钩子阻止执行功能
- 钩子修改结果功能
"""

import pytest
from agenticx.hooks.tool_hooks import (
    ToolCallHookContext,
    register_before_tool_call_hook,
    register_after_tool_call_hook,
    get_before_tool_call_hooks,
    get_after_tool_call_hooks,
    unregister_before_tool_call_hook,
    unregister_after_tool_call_hook,
    clear_before_tool_call_hooks,
    clear_after_tool_call_hooks,
    clear_all_tool_call_hooks,
    execute_before_tool_call_hooks,
    execute_after_tool_call_hooks,
)


@pytest.fixture(autouse=True)
def cleanup_hooks():
    """每个测试后清理所有钩子"""
    yield
    clear_all_tool_call_hooks()


class TestToolCallHookContext:
    """测试 ToolCallHookContext 数据类"""
    
    def test_context_creation_basic(self):
        """测试基本上下文创建"""
        context = ToolCallHookContext(
            tool_name="search",
            tool_input={"query": "test"}
        )
        
        assert context.tool_name == "search"
        assert context.tool_input == {"query": "test"}
        assert context.tool is None
        assert context.agent_id is None
        assert context.tool_result is None
    
    def test_context_creation_full(self):
        """测试完整上下文创建"""
        context = ToolCallHookContext(
            tool_name="search",
            tool_input={"query": "test"},
            tool=None,  # 避免需要实际工具实例
            agent_id="agent-001",
            agent_name="TestAgent",
            task_id="task-001",
            tool_result="Search results here",
            metadata={"key": "value"}
        )
        
        assert context.tool_name == "search"
        assert context.tool_input == {"query": "test"}
        assert context.agent_id == "agent-001"
        assert context.agent_name == "TestAgent"
        assert context.task_id == "task-001"
        assert context.tool_result == "Search results here"
        assert context.metadata == {"key": "value"}
    
    def test_context_default_tool_input_none(self):
        """测试 tool_input 为 None 时的默认值"""
        context = ToolCallHookContext(tool_name="test", tool_input=None)  # type: ignore
        assert context.tool_input == {}


class TestBeforeToolCallHooks:
    """测试 before_tool_call 钩子"""
    
    def test_register_hook(self):
        """测试注册钩子"""
        def my_hook(ctx: ToolCallHookContext) -> None:
            pass
        
        register_before_tool_call_hook(my_hook)
        hooks = get_before_tool_call_hooks()
        
        assert len(hooks) == 1
        assert hooks[0] is my_hook
    
    def test_register_hook_no_duplicates(self):
        """测试重复注册不会添加多个"""
        def my_hook(ctx: ToolCallHookContext) -> None:
            pass
        
        register_before_tool_call_hook(my_hook)
        register_before_tool_call_hook(my_hook)
        hooks = get_before_tool_call_hooks()
        
        assert len(hooks) == 1
    
    def test_unregister_hook(self):
        """测试注销钩子"""
        def my_hook(ctx: ToolCallHookContext) -> None:
            pass
        
        register_before_tool_call_hook(my_hook)
        result = unregister_before_tool_call_hook(my_hook)
        
        assert result is True
        assert len(get_before_tool_call_hooks()) == 0
    
    def test_hook_allows_execution(self):
        """测试钩子允许执行"""
        called = False
        
        def allowing_hook(ctx: ToolCallHookContext) -> None:
            nonlocal called
            called = True
            return None
        
        register_before_tool_call_hook(allowing_hook)
        context = ToolCallHookContext(tool_name="test", tool_input={})
        result = execute_before_tool_call_hooks(context)
        
        assert called is True
        assert result is True
    
    def test_hook_blocks_execution(self):
        """测试钩子阻止执行"""
        def blocking_hook(ctx: ToolCallHookContext) -> bool:
            return False
        
        register_before_tool_call_hook(blocking_hook)
        context = ToolCallHookContext(tool_name="test", tool_input={})
        result = execute_before_tool_call_hooks(context)
        
        assert result is False
    
    def test_hook_blocks_dangerous_tool(self):
        """测试钩子阻止危险工具"""
        def security_hook(ctx: ToolCallHookContext) -> bool | None:
            if ctx.tool_name == "delete_database":
                return False
            return None
        
        register_before_tool_call_hook(security_hook)
        
        # 正常工具允许
        context1 = ToolCallHookContext(tool_name="search", tool_input={})
        assert execute_before_tool_call_hooks(context1) is True
        
        # 危险工具阻止
        context2 = ToolCallHookContext(tool_name="delete_database", tool_input={})
        assert execute_before_tool_call_hooks(context2) is False
    
    def test_hook_can_modify_input(self):
        """测试钩子可以修改输入"""
        def modifying_hook(ctx: ToolCallHookContext) -> None:
            ctx.tool_input["added_by_hook"] = True
            return None
        
        register_before_tool_call_hook(modifying_hook)
        context = ToolCallHookContext(
            tool_name="test",
            tool_input={"original": "value"}
        )
        execute_before_tool_call_hooks(context)
        
        assert context.tool_input["added_by_hook"] is True
        assert context.tool_input["original"] == "value"
    
    def test_hook_receives_context(self):
        """测试钩子接收正确的上下文"""
        received_context = None
        
        def capturing_hook(ctx: ToolCallHookContext) -> None:
            nonlocal received_context
            received_context = ctx
            return None
        
        register_before_tool_call_hook(capturing_hook)
        context = ToolCallHookContext(
            tool_name="search",
            tool_input={"query": "test"},
            agent_name="TestAgent"
        )
        execute_before_tool_call_hooks(context)
        
        assert received_context is not None
        assert received_context.tool_name == "search"
        assert received_context.agent_name == "TestAgent"
    
    def test_multiple_hooks_execution_order(self):
        """测试多个钩子按注册顺序执行"""
        execution_order = []
        
        def hook1(ctx: ToolCallHookContext) -> None:
            execution_order.append(1)
            return None
        
        def hook2(ctx: ToolCallHookContext) -> None:
            execution_order.append(2)
            return None
        
        register_before_tool_call_hook(hook1)
        register_before_tool_call_hook(hook2)
        
        context = ToolCallHookContext(tool_name="test", tool_input={})
        execute_before_tool_call_hooks(context)
        
        assert execution_order == [1, 2]
    
    def test_hook_error_does_not_block(self):
        """测试钩子错误不阻止执行"""
        def error_hook(ctx: ToolCallHookContext) -> None:
            raise ValueError("Hook error")
        
        register_before_tool_call_hook(error_hook)
        context = ToolCallHookContext(tool_name="test", tool_input={})
        result = execute_before_tool_call_hooks(context)
        
        assert result is True


class TestAfterToolCallHooks:
    """测试 after_tool_call 钩子"""
    
    def test_register_hook(self):
        """测试注册钩子"""
        def my_hook(ctx: ToolCallHookContext) -> str | None:
            return None
        
        register_after_tool_call_hook(my_hook)
        hooks = get_after_tool_call_hooks()
        
        assert len(hooks) == 1
        assert hooks[0] is my_hook
    
    def test_hook_modifies_result(self):
        """测试钩子修改结果"""
        def sanitize_hook(ctx: ToolCallHookContext) -> str | None:
            if ctx.tool_result and "SECRET_KEY" in ctx.tool_result:
                return ctx.tool_result.replace("SECRET_KEY=abc123", "[REDACTED]")
            return None
        
        register_after_tool_call_hook(sanitize_hook)
        context = ToolCallHookContext(
            tool_name="read_config",
            tool_input={},
            tool_result="config: SECRET_KEY=abc123"
        )
        result = execute_after_tool_call_hooks(context)
        
        assert result == "config: [REDACTED]"
    
    def test_hook_keeps_original_result(self):
        """测试钩子返回 None 保持原结果"""
        def passthrough_hook(ctx: ToolCallHookContext) -> str | None:
            return None
        
        register_after_tool_call_hook(passthrough_hook)
        context = ToolCallHookContext(
            tool_name="test",
            tool_input={},
            tool_result="Original result"
        )
        result = execute_after_tool_call_hooks(context)
        
        assert result is None
    
    def test_multiple_hooks_chain_modifications(self):
        """测试多个钩子链式修改"""
        def hook1(ctx: ToolCallHookContext) -> str | None:
            if ctx.tool_result:
                return ctx.tool_result.upper()
            return None
        
        def hook2(ctx: ToolCallHookContext) -> str | None:
            if ctx.tool_result:
                return f"[{ctx.tool_result}]"
            return None
        
        register_after_tool_call_hook(hook1)
        register_after_tool_call_hook(hook2)
        
        context = ToolCallHookContext(
            tool_name="test",
            tool_input={},
            tool_result="hello"
        )
        result = execute_after_tool_call_hooks(context)
        
        # hook1: "hello" -> "HELLO"
        # hook2: "HELLO" -> "[HELLO]"
        assert result == "[HELLO]"
    
    def test_hook_logs_result(self):
        """测试钩子记录结果"""
        logged_results = []
        
        def logging_hook(ctx: ToolCallHookContext) -> str | None:
            logged_results.append({
                "tool": ctx.tool_name,
                "result": ctx.tool_result
            })
            return None
        
        register_after_tool_call_hook(logging_hook)
        context = ToolCallHookContext(
            tool_name="search",
            tool_input={},
            tool_result="Found 10 results"
        )
        execute_after_tool_call_hooks(context)
        
        assert len(logged_results) == 1
        assert logged_results[0]["tool"] == "search"
        assert logged_results[0]["result"] == "Found 10 results"


class TestClearHooks:
    """测试清除钩子功能"""
    
    def test_clear_before_hooks(self):
        """测试清除 before 钩子"""
        def hook1(ctx): return None
        def hook2(ctx): return None
        
        register_before_tool_call_hook(hook1)
        register_before_tool_call_hook(hook2)
        
        count = clear_before_tool_call_hooks()
        
        assert count == 2
        assert len(get_before_tool_call_hooks()) == 0
    
    def test_clear_after_hooks(self):
        """测试清除 after 钩子"""
        def hook1(ctx): return None
        def hook2(ctx): return None
        
        register_after_tool_call_hook(hook1)
        register_after_tool_call_hook(hook2)
        
        count = clear_after_tool_call_hooks()
        
        assert count == 2
        assert len(get_after_tool_call_hooks()) == 0
    
    def test_clear_all_hooks(self):
        """测试清除所有钩子"""
        def before_hook(ctx): return None
        def after_hook(ctx): return None
        
        register_before_tool_call_hook(before_hook)
        register_after_tool_call_hook(after_hook)
        
        before_count, after_count = clear_all_tool_call_hooks()
        
        assert before_count == 1
        assert after_count == 1
        assert len(get_before_tool_call_hooks()) == 0
        assert len(get_after_tool_call_hooks()) == 0


class TestEdgeCases:
    """测试边界情况"""
    
    def test_empty_hooks_list(self):
        """测试空钩子列表"""
        context = ToolCallHookContext(tool_name="test", tool_input={})
        
        before_result = execute_before_tool_call_hooks(context)
        after_result = execute_after_tool_call_hooks(context)
        
        assert before_result is True
        assert after_result is None
    
    def test_first_blocking_hook_stops_chain(self):
        """测试第一个阻止钩子停止后续钩子"""
        second_called = False
        
        def blocking_hook(ctx: ToolCallHookContext) -> bool:
            return False
        
        def second_hook(ctx: ToolCallHookContext) -> None:
            nonlocal second_called
            second_called = True
            return None
        
        register_before_tool_call_hook(blocking_hook)
        register_before_tool_call_hook(second_hook)
        
        context = ToolCallHookContext(tool_name="test", tool_input={})
        result = execute_before_tool_call_hooks(context)
        
        assert result is False
        assert second_called is False
    
    def test_hook_with_empty_tool_input(self):
        """测试空工具输入"""
        called = False
        
        def hook(ctx: ToolCallHookContext) -> None:
            nonlocal called
            called = True
            assert ctx.tool_input == {}
            return None
        
        register_before_tool_call_hook(hook)
        context = ToolCallHookContext(tool_name="test", tool_input={})
        execute_before_tool_call_hooks(context)
        
        assert called is True

