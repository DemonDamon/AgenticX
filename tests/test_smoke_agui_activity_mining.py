import json
import asyncio
import pytest
from agenticx.protocols.agui import (
    AgUiCallbackHandler, 
    EventType
)
from agenticx.core.event import Event

@pytest.mark.asyncio
async def test_smoke_agui_mining_activity():
    """测试将 MiningStep 变更映射为 AG-UI Activity 事件"""
    handler = AgUiCallbackHandler()
    
    # 模拟业务层发出的 mining_step_update 事件
    mining_event = Event(
        type="mining_step_update",
        data={
            "step": {
                "id": "step-1",
                "title": "Search quantum computing",
                "status": "in_progress",
                "step_type": "search"
            }
        },
        task_id="task-001"
    )
    handler.on_event(mining_event)
    
    # 验证生成的 AG-UI 事件
    async for event in handler.get_event_stream():
        assert event.type == EventType.ACTIVITY_SNAPSHOT
        assert event.activity_type == "mining_step"
        assert event.content["id"] == "step-1"
        assert event.content["status"] == "in_progress"
        break

if __name__ == "__main__":
    pytest.main([__file__])

