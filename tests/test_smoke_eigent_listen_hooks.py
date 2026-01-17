"""
Eigent ListenAgent Hooks 冒烟测试

测试通过 Hooks 系统实现的自动事件通知。
"""

import pytest
from datetime import datetime

from agenticx.collaboration.workforce.hooks import (
    create_workforce_event_hooks,
    remove_workforce_event_hooks,
)
from agenticx.collaboration.workforce.events import (
    WorkforceEventBus,
    WorkforceAction,
)
from agenticx.core.hooks import (
    LLMCallHookContext,
    ToolCallHookContext,
    execute_before_llm_call_hooks,
    execute_after_llm_call_hooks,
    execute_before_tool_call_hooks,
    execute_after_tool_call_hooks,
    clear_all_llm_hooks,
    clear_all_tool_hooks,
)


@pytest.fixture(autouse=True)
def cleanup_hooks():
    """每个测试后清理 hooks"""
    yield
    clear_all_llm_hooks()
    clear_all_tool_hooks()


def test_create_workforce_event_hooks():
    """测试创建 Workforce 事件 Hooks"""
    event_bus = WorkforceEventBus()
    hooks = create_workforce_event_hooks(event_bus)
    
    assert "before_llm_call" in hooks
    assert "after_llm_call" in hooks
    assert "before_tool_call" in hooks
    assert "after_tool_call" in hooks


def test_llm_activation_event():
    """测试 LLM 调用激活事件"""
    event_bus = WorkforceEventBus()
    received_events = []
    event_bus.subscribe(lambda e: received_events.append(e))
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # 模拟 LLM 调用前
    ctx = LLMCallHookContext(
        agent_id="agent_123",
        task_id="task_456",
        model="gpt-4",
        messages=["message1", "message2"],
        iteration=1,
    )
    execute_before_llm_call_hooks(ctx)
    
    # 验证事件发送
    assert len(received_events) >= 1
    activate_events = [e for e in received_events if e.action == WorkforceAction.AGENT_ACTIVATED]
    assert len(activate_events) == 1
    assert activate_events[0].agent_id == "agent_123"
    assert activate_events[0].task_id == "task_456"
    assert activate_events[0].data["model"] == "gpt-4"


def test_llm_deactivation_event():
    """测试 LLM 调用停用事件"""
    event_bus = WorkforceEventBus()
    received_events = []
    event_bus.subscribe(lambda e: received_events.append(e))
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # 模拟 LLM 调用后
    ctx = LLMCallHookContext(
        agent_id="agent_123",
        task_id="task_456",
        model="gpt-4",
        response="Test response",
        tokens_used=150,
        duration_ms=234.5,
    )
    execute_after_llm_call_hooks(ctx)
    
    # 验证事件发送
    deactivate_events = [e for e in received_events if e.action == WorkforceAction.AGENT_DEACTIVATED]
    assert len(deactivate_events) == 1
    assert deactivate_events[0].agent_id == "agent_123"
    assert deactivate_events[0].data["tokens_used"] == 150
    assert deactivate_events[0].data["duration_ms"] == 234.5
    assert deactivate_events[0].data["success"] is True


def test_tool_activation_event():
    """测试工具调用激活事件"""
    event_bus = WorkforceEventBus()
    received_events = []
    event_bus.subscribe(lambda e: received_events.append(e))
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # 模拟工具调用前
    ctx = ToolCallHookContext(
        agent_id="agent_123",
        task_id="task_456",
        tool_name="calculator",
        tool_args={"a": 1, "b": 2},
        iteration=1,
    )
    execute_before_tool_call_hooks(ctx)
    
    # 验证事件发送
    activate_events = [e for e in received_events if e.action == WorkforceAction.TOOLKIT_ACTIVATED]
    assert len(activate_events) == 1
    assert activate_events[0].agent_id == "agent_123"
    assert activate_events[0].data["tool_name"] == "calculator"
    assert activate_events[0].data["tool_args"] == {"a": 1, "b": 2}


def test_tool_deactivation_event():
    """测试工具调用停用事件"""
    event_bus = WorkforceEventBus()
    received_events = []
    event_bus.subscribe(lambda e: received_events.append(e))
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # 模拟工具调用后
    ctx = ToolCallHookContext(
        agent_id="agent_123",
        task_id="task_456",
        tool_name="calculator",
        result=3,
        success=True,
        duration_ms=12.5,
    )
    execute_after_tool_call_hooks(ctx)
    
    # 验证事件发送
    deactivate_events = [e for e in received_events if e.action == WorkforceAction.TOOLKIT_DEACTIVATED]
    assert len(deactivate_events) == 1
    assert deactivate_events[0].data["tool_name"] == "calculator"
    assert deactivate_events[0].data["success"] is True
    assert deactivate_events[0].data["duration_ms"] == 12.5


def test_error_handling_in_hooks():
    """测试 Hooks 中的错误处理"""
    event_bus = WorkforceEventBus()
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # 模拟 LLM 调用失败
    error = ValueError("LLM call failed")
    ctx = LLMCallHookContext(
        agent_id="agent_123",
        error=error,
    )
    result = execute_after_llm_call_hooks(ctx)
    
    # Hooks 不应该阻止执行
    assert result is True
    
    # 获取事件历史验证错误被记录
    events = event_bus.get_event_history(action=WorkforceAction.AGENT_DEACTIVATED)
    assert len(events) >= 1
    assert events[-1].data["success"] is False
    assert "LLM call failed" in events[-1].data["error"]


def test_remove_workforce_event_hooks():
    """测试移除 Workforce 事件 Hooks"""
    event_bus = WorkforceEventBus()
    received_events = []
    event_bus.subscribe(lambda e: received_events.append(e))
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # 调用一次，应该有事件
    ctx = LLMCallHookContext(agent_id="agent_123")
    execute_before_llm_call_hooks(ctx)
    assert len(received_events) >= 1
    
    # 移除 hooks
    remove_workforce_event_hooks(hooks)
    
    # 清空事件
    received_events.clear()
    
    # 再次调用，不应该有新事件
    execute_before_llm_call_hooks(ctx)
    assert len(received_events) == 0


def test_complete_workflow_event_sequence():
    """测试完整的工作流事件序列"""
    event_bus = WorkforceEventBus()
    received_events = []
    event_bus.subscribe(lambda e: received_events.append(e))
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # 模拟完整的执行序列
    # 1. Agent 激活
    ctx_llm_before = LLMCallHookContext(agent_id="agent_1", task_id="task_1")
    execute_before_llm_call_hooks(ctx_llm_before)
    
    # 2. 工具激活
    ctx_tool_before = ToolCallHookContext(
        agent_id="agent_1",
        task_id="task_1",
        tool_name="search",
    )
    execute_before_tool_call_hooks(ctx_tool_before)
    
    # 3. 工具停用
    ctx_tool_after = ToolCallHookContext(
        agent_id="agent_1",
        task_id="task_1",
        tool_name="search",
        result="Search results",
        success=True,
    )
    execute_after_tool_call_hooks(ctx_tool_after)
    
    # 4. Agent 停用
    ctx_llm_after = LLMCallHookContext(
        agent_id="agent_1",
        task_id="task_1",
        tokens_used=100,
    )
    execute_after_llm_call_hooks(ctx_llm_after)
    
    # 验证事件顺序
    assert len(received_events) == 4
    assert received_events[0].action == WorkforceAction.AGENT_ACTIVATED
    assert received_events[1].action == WorkforceAction.TOOLKIT_ACTIVATED
    assert received_events[2].action == WorkforceAction.TOOLKIT_DEACTIVATED
    assert received_events[3].action == WorkforceAction.AGENT_DEACTIVATED


def test_multiple_agents_event_tracking():
    """测试多个 Agent 的事件追踪"""
    event_bus = WorkforceEventBus()
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # 模拟多个 Agent 调用
    agents = ["agent_1", "agent_2", "agent_3"]
    for agent_id in agents:
        ctx = LLMCallHookContext(agent_id=agent_id, task_id="shared_task")
        execute_before_llm_call_hooks(ctx)
    
    # 验证每个 Agent 的事件
    for agent_id in agents:
        events = event_bus.get_event_history(agent_id=agent_id)
        assert len(events) >= 1
        assert events[0].agent_id == agent_id


def test_event_data_completeness():
    """测试事件数据完整性"""
    event_bus = WorkforceEventBus()
    
    hooks = create_workforce_event_hooks(event_bus)
    
    # LLM 调用事件
    ctx = LLMCallHookContext(
        agent_id="agent_123",
        task_id="task_456",
        model="gpt-4",
        temperature=0.7,
        max_tokens=1000,
        messages=["msg1", "msg2"],
        iteration=5,
    )
    execute_before_llm_call_hooks(ctx)
    
    events = event_bus.get_event_history(action=WorkforceAction.AGENT_ACTIVATED)
    assert len(events) >= 1
    
    event_data = events[-1].data
    assert event_data["agent_id"] == "agent_123"
    assert event_data["task_id"] == "task_456"
    assert event_data["model"] == "gpt-4"
    assert event_data["iteration"] == 5
    assert event_data["message_count"] == 2
