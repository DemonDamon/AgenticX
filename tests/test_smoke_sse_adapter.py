"""
SSE 流式响应适配器冒烟测试

测试 SSE 适配器的核心功能：
- 从事件总线订阅事件并转换为 SSE 流
- SSE 格式正确
- 连接断开时正确清理资源
- 支持流式文本推送
"""

import pytest  # type: ignore
import asyncio
from agenticx.server.sse_adapter import (
    create_sse_stream,
    create_sse_stream_from_events,
    _convert_action_data_to_sse,
)
from agenticx.collaboration.task_lock import TaskLock, Action, ActionData
from agenticx.collaboration.workforce.events import (
    WorkforceEventBus,
    WorkforceEvent,
    WorkforceAction,
)
from agenticx.server.sse_formatter import SSEFormatter


@pytest.mark.asyncio
async def test_create_sse_stream_from_events():
    """测试从事件总线创建 SSE 流"""
    event_bus = WorkforceEventBus()
    
    # 创建流
    stream = create_sse_stream_from_events(event_bus, timeout=0.5)
    
    # 发布事件
    event = WorkforceEvent(
        action=WorkforceAction.AGENT_ACTIVATED,
        agent_id="agent_1",
        task_id="task_1",
        data={"agent_name": "test_agent", "tokens": 100},
    )
    event_bus.publish(event)
    
    # 读取第一个事件
    result = await asyncio.wait_for(anext(stream), timeout=1.0)
    
    assert result.startswith("data: ")
    assert result.endswith("\n\n")
    
    # 清理
    await stream.aclose()


@pytest.mark.asyncio
async def test_create_sse_stream_with_task_lock():
    """测试从 TaskLock 创建 SSE 流"""
    task_lock = TaskLock(project_id="test_project")
    event_bus = WorkforceEventBus()
    
    # 创建流
    stream = create_sse_stream("test_project", task_lock, event_bus, timeout=1.0)
    
    # 发布事件到事件总线（在后台任务启动后）
    await asyncio.sleep(0.1)  # 等待流初始化
    
    event = WorkforceEvent(
        action=WorkforceAction.TASK_COMPLETED,
        task_id="task_1",
        data={"result": "Task completed"},
    )
    event_bus.publish(event)
    
    # 读取事件（可能需要跳过 SYNC 心跳）
    result = None
    for _ in range(5):  # 最多尝试 5 次
        try:
            result = await asyncio.wait_for(anext(stream), timeout=1.5)
            if "task_state" in result:
                break
            # 如果是 SYNC 事件，继续读取下一个
            if "sync" in result.lower():
                continue
        except StopAsyncIteration:
            break
    
    assert result is not None
    assert result.startswith("data: ")
    assert "task_state" in result
    
    # 清理
    await stream.aclose()
    await task_lock.cleanup()


@pytest.mark.asyncio
async def test_sse_stream_cleanup():
    """测试 SSE 流清理"""
    task_lock = TaskLock(project_id="test_project_cleanup")
    event_bus = WorkforceEventBus()
    
    stream = create_sse_stream("test_project_cleanup", task_lock, event_bus, timeout=0.1)
    
    # 立即关闭
    await stream.aclose()
    
    # 验证清理
    assert len(task_lock.background_tasks) == 0
    
    await task_lock.cleanup()


@pytest.mark.asyncio
async def test_sse_stream_timeout():
    """测试 SSE 流超时（发送心跳）"""
    event_bus = WorkforceEventBus()
    
    stream = create_sse_stream_from_events(event_bus, timeout=0.1)
    
    # 等待超时（应该收到 SYNC 事件）
    result = await asyncio.wait_for(anext(stream), timeout=0.5)
    
    assert "sync" in result.lower() or "data:" in result
    
    await stream.aclose()


@pytest.mark.asyncio
async def test_convert_action_data_to_sse():
    """测试 ActionData 转换为 SSE"""
    formatter = SSEFormatter()
    
    # Test DECOMPOSE_TEXT
    action_data = ActionData(
        action=Action.DECOMPOSE_TEXT,
        data={"content": "Decomposing..."},
    )
    result = _convert_action_data_to_sse(action_data, formatter)
    assert result is not None
    assert "decompose_text" in result
    
    # Test CREATE_AGENT
    action_data = ActionData(
        action=Action.CREATE_AGENT,
        data={
            "agent_name": "dev_agent",
            "agent_id": "agent_1",
            "tools": ["tool1"],
        },
    )
    result = _convert_action_data_to_sse(action_data, formatter)
    assert result is not None
    assert "create_agent" in result
    
    # Test ACTIVATE_AGENT
    action_data = ActionData(
        action=Action.ACTIVATE_AGENT,
        data={
            "agent_id": "agent_1",
            "process_task_id": "task_1",
            "agent_name": "dev_agent",
            "tokens": 100,
        },
    )
    result = _convert_action_data_to_sse(action_data, formatter)
    assert result is not None
    assert "activate_agent" in result
    
    # Test WRITE_FILE
    action_data = ActionData(
        action=Action.WRITE_FILE,
        data={"file_path": "/path/to/file.txt"},
    )
    result = _convert_action_data_to_sse(action_data, formatter)
    assert result is not None
    assert "write_file" in result
    
    # Test TERMINAL
    action_data = ActionData(
        action=Action.TERMINAL,
        data={"process_task_id": "task_1", "output": "Output text"},
    )
    result = _convert_action_data_to_sse(action_data, formatter)
    assert result is not None
    assert "terminal" in result
    
    # Test END
    action_data = ActionData(
        action=Action.END,
        data={"summary": "Final summary"},
    )
    result = _convert_action_data_to_sse(action_data, formatter)
    assert result is not None
    assert "end" in result
    
    # Test unsupported action
    action_data = ActionData(
        action=Action.START,
        data={},
    )
    result = _convert_action_data_to_sse(action_data, formatter)
    # Should return None for unsupported actions
    assert result is None


@pytest.mark.asyncio
async def test_sse_stream_multiple_events():
    """测试 SSE 流处理多个事件"""
    event_bus = WorkforceEventBus()
    
    stream = create_sse_stream_from_events(event_bus, timeout=0.5)
    
    # 发布多个事件
    events = [
        WorkforceEvent(
            action=WorkforceAction.AGENT_ACTIVATED,
            agent_id="agent_1",
            data={"agent_name": "agent1"},
        ),
        WorkforceEvent(
            action=WorkforceAction.TASK_COMPLETED,
            task_id="task_1",
            data={"result": "Done"},
        ),
        WorkforceEvent(
            action=WorkforceAction.WORKFORCE_STOPPED,
            data={"summary": "All done"},
        ),
    ]
    
    for event in events:
        event_bus.publish(event)
    
    # 读取事件
    results = []
    try:
        for _ in range(3):
            result = await asyncio.wait_for(anext(stream), timeout=1.0)
            results.append(result)
    except StopAsyncIteration:
        pass
    
    assert len(results) >= 3
    
    # 验证格式
    for result in results:
        assert result.startswith("data: ")
        assert result.endswith("\n\n")
    
    await stream.aclose()


@pytest.mark.asyncio
async def test_sse_stream_error_handling():
    """测试 SSE 流错误处理"""
    event_bus = WorkforceEventBus()
    
    stream = create_sse_stream_from_events(event_bus, timeout=0.5)
    
    # 发布一个会导致错误的事件（如果格式化器不支持）
    # 这里我们发布一个正常事件，然后测试错误情况
    event = WorkforceEvent(
        action=WorkforceAction.USER_MESSAGE,  # 这个可能不被映射
        data={"content": "test"},
    )
    event_bus.publish(event)
    
    # 读取事件（可能返回 None 或跳过）
    try:
        result = await asyncio.wait_for(anext(stream), timeout=1.0)
        # 如果返回，应该是有效格式
        if result:
            assert result.startswith("data: ")
    except StopAsyncIteration:
        pass
    
    await stream.aclose()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
