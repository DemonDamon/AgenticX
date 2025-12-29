import json
import pytest
from agenticx.protocols.agui import (
    AgUiEncoder, 
    TextMessageChunkEvent, 
    EventType, 
    RunStartedEvent,
    ActivitySnapshotEvent
)

def test_smoke_agui_encoder_basic():
    """测试基础事件编码为 SSE 格式"""
    event = RunStartedEvent(run_id="run-123")
    encoded = AgUiEncoder.encode(event)
    
    assert encoded.startswith("data: ")
    assert encoded.endswith("\n\n")
    
    data = json.loads(encoded[6:-2])
    assert data["type"] == EventType.RUN_STARTED
    assert data["runId"] == "run-123"
    assert "timestamp" in data

def test_smoke_agui_text_chunk():
    """测试文本块事件"""
    event = TextMessageChunkEvent(message_id="msg-1", delta="hello")
    encoded = AgUiEncoder.encode(event)
    
    data = json.loads(encoded[6:-2])
    assert data["type"] == EventType.TEXT_MESSAGE_CHUNK
    assert data["delta"] == "hello"
    assert data["messageId"] == "msg-1"

def test_smoke_agui_activity():
    """测试 Activity 事件（P1 功能点基础）"""
    event = ActivitySnapshotEvent(
        message_id="activity-1",
        activity_type="mining",
        content={"status": "searching", "step": 1}
    )
    encoded = AgUiEncoder.encode(event)
    data = json.loads(encoded[6:-2])
    
    assert data["type"] == EventType.ACTIVITY_SNAPSHOT
    assert data["activityType"] == "mining"
    assert data["content"]["status"] == "searching"

if __name__ == "__main__":
    pytest.main([__file__])

