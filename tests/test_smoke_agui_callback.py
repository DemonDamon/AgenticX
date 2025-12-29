import json
import asyncio
import pytest
from agenticx.protocols.agui import (
    AgUiCallbackHandler, 
    AgUiEncoder,
    EventType
)
from agenticx.core.event import (
    TaskStartEvent, 
    TaskEndEvent, 
    LLMResponseEvent,
    ErrorEvent
)

@pytest.mark.asyncio
async def test_smoke_agui_callback_flow():
    """测试 AgUiCallbackHandler 拦截 AgenticX 事件并生成 AG-UI 流"""
    handler = AgUiCallbackHandler()
    
    # 1. 模拟任务开始
    task_start = TaskStartEvent(
        task_id="task-001",
        task_description="Explain quantum computing"
    )
    handler.on_event(task_start)
    
    # 2. 模拟 LLM 响应
    llm_response = LLMResponseEvent(
        task_id="task-001",
        response="Quantum computing uses qubits..."
    )
    handler.on_event(llm_response)
    
    # 3. 模拟任务结束
    task_end = TaskEndEvent(
        task_id="task-001",
        success=True,
        result="Success"
    )
    handler.on_event(task_end)
    
    # 获取流并验证
    events = []
    async for event in handler.get_event_stream():
        events.append(event)
        if len(events) >= 3:
            break
            
    assert len(events) == 3
    assert events[0].type == EventType.RUN_STARTED
    assert events[1].type == EventType.TEXT_MESSAGE_CHUNK
    assert events[2].type == EventType.RUN_FINISHED
    
    # 验证编码
    encoded_text = AgUiEncoder.encode(events[1])
    assert "TEXT_MESSAGE_CHUNK" in encoded_text
    assert "Quantum computing uses qubits..." in encoded_text

@pytest.mark.asyncio
async def test_smoke_agui_callback_error():
    """测试错误事件转换"""
    handler = AgUiCallbackHandler()
    
    error_event = ErrorEvent(
        task_id="task-002",
        error_type="LLMError",
        error_message="Connection timeout"
    )
    handler.on_event(error_event)
    
    async for event in handler.get_event_stream():
        assert event.type == EventType.RUN_ERROR
        assert event.message == "Connection timeout"
        break

if __name__ == "__main__":
    pytest.main([__file__])

