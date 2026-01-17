"""
Eigent EventBus 冒烟测试

测试 WorkforceEventBus 的基本功能：订阅、发布、历史查询。
"""

import pytest
import asyncio
from datetime import datetime

from agenticx.collaboration.workforce.events import (
    WorkforceAction,
    WorkforceEvent,
    WorkforceEventBus,
)
from agenticx.core.event import EventLog


def test_create_event_bus():
    """测试创建 EventBus"""
    bus = WorkforceEventBus()
    assert bus is not None
    assert bus.event_log is not None


def test_publish_and_subscribe():
    """测试发布和订阅事件"""
    bus = WorkforceEventBus()
    received_events = []
    
    def callback(event: WorkforceEvent):
        received_events.append(event)
    
    bus.subscribe(callback)
    
    # 发布事件
    event = WorkforceEvent(
        action=WorkforceAction.TASK_STARTED,
        data={"task_name": "test_task"},
        task_id="task_123",
    )
    bus.publish(event)
    
    # 检查订阅者接收到事件
    assert len(received_events) == 1
    assert received_events[0].action == WorkforceAction.TASK_STARTED
    assert received_events[0].data["task_name"] == "test_task"


@pytest.mark.asyncio
async def test_async_publish_and_subscribe():
    """测试异步发布和订阅"""
    bus = WorkforceEventBus()
    received_events = []
    
    async def async_callback(event: WorkforceEvent):
        await asyncio.sleep(0.01)  # 模拟异步操作
        received_events.append(event)
    
    bus.subscribe_async(async_callback)
    
    # 异步发布事件
    event = WorkforceEvent(
        action=WorkforceAction.AGENT_ACTIVATED,
        data={"agent_name": "test_agent"},
        agent_id="agent_123",
    )
    await bus.publish_async(event)
    
    # 检查订阅者接收到事件
    assert len(received_events) == 1
    assert received_events[0].action == WorkforceAction.AGENT_ACTIVATED


def test_multiple_subscribers():
    """测试多个订阅者"""
    bus = WorkforceEventBus()
    received1 = []
    received2 = []
    
    def callback1(event: WorkforceEvent):
        received1.append(event.action)
    
    def callback2(event: WorkforceEvent):
        received2.append(event.action)
    
    bus.subscribe(callback1)
    bus.subscribe(callback2)
    
    event = WorkforceEvent(action=WorkforceAction.TASK_COMPLETED)
    bus.publish(event)
    
    # 两个订阅者都应该接收到事件
    assert len(received1) == 1
    assert len(received2) == 1
    assert received1[0] == WorkforceAction.TASK_COMPLETED
    assert received2[0] == WorkforceAction.TASK_COMPLETED


def test_unsubscribe():
    """测试取消订阅"""
    bus = WorkforceEventBus()
    received = []
    
    def callback(event: WorkforceEvent):
        received.append(event)
    
    bus.subscribe(callback)
    bus.unsubscribe(callback)
    
    event = WorkforceEvent(action=WorkforceAction.TASK_FAILED)
    bus.publish(event)
    
    # 取消订阅后不应该接收到事件
    assert len(received) == 0


def test_event_logging():
    """测试事件持久化到 EventLog"""
    event_log = EventLog()
    bus = WorkforceEventBus(event_log=event_log)
    
    event = WorkforceEvent(
        action=WorkforceAction.DECOMPOSE_COMPLETE,
        data={"subtasks_count": 5},
        task_id="task_123",
    )
    bus.publish(event)
    
    # 检查事件被记录到 EventLog
    events = event_log.events
    assert len(events) > 0
    # 最后一个事件应该是我们发布的
    last_event = events[-1]
    assert last_event.type == WorkforceAction.DECOMPOSE_COMPLETE.value
    assert last_event.data["subtasks_count"] == 5


def test_get_event_history():
    """测试获取事件历史"""
    event_log = EventLog()
    bus = WorkforceEventBus(event_log=event_log)
    
    # 发布多个事件
    bus.publish(WorkforceEvent(
        action=WorkforceAction.TASK_STARTED,
        task_id="task_1",
        agent_id="agent_1",
    ))
    bus.publish(WorkforceEvent(
        action=WorkforceAction.TASK_COMPLETED,
        task_id="task_1",
        agent_id="agent_1",
    ))
    bus.publish(WorkforceEvent(
        action=WorkforceAction.TASK_STARTED,
        task_id="task_2",
        agent_id="agent_2",
    ))
    
    # 按 task_id 过滤
    history = bus.get_event_history(task_id="task_1")
    assert len(history) == 2
    assert all(e.task_id == "task_1" for e in history)
    
    # 按 agent_id 过滤
    history = bus.get_event_history(agent_id="agent_2")
    assert len(history) == 1
    assert history[0].agent_id == "agent_2"
    
    # 按 action 过滤
    history = bus.get_event_history(action=WorkforceAction.TASK_STARTED)
    assert len(history) == 2
    assert all(e.action == WorkforceAction.TASK_STARTED for e in history)


def test_get_event_history_with_limit():
    """测试限制历史事件数量"""
    event_log = EventLog()
    bus = WorkforceEventBus(event_log=event_log)
    
    # 发布多个事件
    for i in range(10):
        bus.publish(WorkforceEvent(
            action=WorkforceAction.TASK_STARTED,
            task_id=f"task_{i}",
        ))
    
    # 限制返回数量
    history = bus.get_event_history(limit=5)
    assert len(history) <= 5


@pytest.mark.asyncio
async def test_event_queue():
    """测试事件队列（用于 SSE 推送）"""
    bus = WorkforceEventBus()
    
    # 发布事件
    event = WorkforceEvent(action=WorkforceAction.AGENT_DEACTIVATED)
    await bus.publish_async(event)
    
    # 从队列获取事件
    received_event = await bus.get_next_event(timeout=1.0)
    assert received_event is not None
    assert received_event.action == WorkforceAction.AGENT_DEACTIVATED


@pytest.mark.asyncio
async def test_event_queue_timeout():
    """测试事件队列超时"""
    bus = WorkforceEventBus()
    
    # 不发布事件，直接等待
    received_event = await bus.get_next_event(timeout=0.1)
    assert received_event is None


def test_clear_queue():
    """测试清空事件队列"""
    bus = WorkforceEventBus()
    
    # 发布多个事件
    for i in range(5):
        event = WorkforceEvent(action=WorkforceAction.TASK_STARTED)
        bus.publish(event)
    
    # 清空队列
    count = bus.clear_queue()
    assert count == 5


def test_subscriber_count():
    """测试获取订阅者数量"""
    bus = WorkforceEventBus()
    
    def sync_callback(event):
        pass
    
    async def async_callback(event):
        pass
    
    bus.subscribe(sync_callback)
    bus.subscribe_async(async_callback)
    
    counts = bus.get_subscriber_count()
    assert counts["sync"] == 1
    assert counts["async"] == 1


def test_subscriber_error_handling():
    """测试订阅者错误处理"""
    bus = WorkforceEventBus()
    successful_called = []
    
    def error_callback(event):
        raise ValueError("Intentional error")
    
    def successful_callback(event):
        successful_called.append("success")
    
    bus.subscribe(error_callback)
    bus.subscribe(successful_callback)
    
    event = WorkforceEvent(action=WorkforceAction.TASK_FAILED)
    bus.publish(event)
    
    # 错误不应该阻止其他订阅者
    assert "success" in successful_called


def test_event_data_fields():
    """测试事件数据字段完整性"""
    bus = WorkforceEventBus()
    received = []
    
    def callback(event):
        received.append(event)
    
    bus.subscribe(callback)
    
    event = WorkforceEvent(
        action=WorkforceAction.TOOLKIT_ACTIVATED,
        data={
            "toolkit_name": "calculator",
            "args": {"a": 1, "b": 2},
        },
        task_id="task_123",
        agent_id="agent_456",
    )
    bus.publish(event)
    
    assert len(received) == 1
    received_event = received[0]
    assert received_event.action == WorkforceAction.TOOLKIT_ACTIVATED
    assert received_event.data["toolkit_name"] == "calculator"
    assert received_event.data["args"] == {"a": 1, "b": 2}
    assert received_event.task_id == "task_123"
    assert received_event.agent_id == "agent_456"
    assert isinstance(received_event.timestamp, datetime)


def test_all_workforce_actions():
    """测试所有 WorkforceAction 类型"""
    bus = WorkforceEventBus()
    received_actions = []
    
    def callback(event):
        received_actions.append(event.action)
    
    bus.subscribe(callback)
    
    # 测试所有动作类型
    all_actions = [
        WorkforceAction.DECOMPOSE_START,
        WorkforceAction.DECOMPOSE_PROGRESS,
        WorkforceAction.DECOMPOSE_COMPLETE,
        WorkforceAction.TASK_ASSIGNED,
        WorkforceAction.TASK_STARTED,
        WorkforceAction.TASK_COMPLETED,
        WorkforceAction.AGENT_ACTIVATED,
        WorkforceAction.AGENT_DEACTIVATED,
        WorkforceAction.TOOLKIT_ACTIVATED,
        WorkforceAction.TOOLKIT_DEACTIVATED,
    ]
    
    for action in all_actions:
        bus.publish(WorkforceEvent(action=action))
    
    assert len(received_actions) == len(all_actions)
    assert set(received_actions) == set(all_actions)
