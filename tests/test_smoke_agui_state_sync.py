import json
import asyncio
import pytest
from agenticx.protocols.agui import (
    AgUiCallbackHandler, 
    EventType
)
from agenticx.core.event import Event

@pytest.mark.asyncio
async def test_smoke_agui_state_snapshot():
    """测试状态快照同步"""
    handler = AgUiCallbackHandler()
    
    event = Event(
        type="state_update",
        data={
            "snapshot": {"plan_id": "p1", "progress": 0.5}
        }
    )
    handler.on_event(event)
    
    async for event in handler.get_event_stream():
        assert event.type == EventType.STATE_SNAPSHOT
        assert event.snapshot["plan_id"] == "p1"
        break

@pytest.mark.asyncio
async def test_smoke_agui_state_delta():
    """测试状态增量同步 (JSON Patch)"""
    handler = AgUiCallbackHandler()
    
    # 模拟 JSON Patch
    patch = [{"op": "replace", "path": "/progress", "value": 0.6}]
    event = Event(
        type="state_update",
        data={
            "delta": patch
        }
    )
    handler.on_event(event)
    
    async for event in handler.get_event_stream():
        assert event.type == EventType.STATE_DELTA
        assert event.delta[0]["op"] == "replace"
        assert event.delta[0]["value"] == 0.6
        break

if __name__ == "__main__":
    pytest.main([__file__])

