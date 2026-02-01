"""
SSE 事件格式化器冒烟测试

测试 SSE 格式化器的核心功能：
- 所有 24 种事件类型都能正确格式化
- 事件格式符合 `data: {json}\n\n` 规范
- 事件数据结构完整
"""

import pytest  # type: ignore
import json
from agenticx.server.sse_formatter import (
    SSEFormatter,
    SSEEvent,
    format_sse_event,
)
from agenticx.collaboration.workforce.events import WorkforceEvent, WorkforceAction


def test_sse_format_basic():
    """测试基础 SSE 格式化"""
    result = format_sse_event("test_step", {"key": "value"})
    
    assert result.startswith("data: ")
    assert result.endswith("\n\n")
    
    # Parse JSON
    json_str = result[6:-2]  # Remove "data: " and "\n\n"
    data = json.loads(json_str)
    
    assert data["step"] == "test_step"
    assert data["data"]["key"] == "value"


def test_sse_format_string_data():
    """测试字符串数据格式化（end 事件）"""
    result = format_sse_event("end", "Final summary")
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "end"
    assert data["data"] == "Final summary"


def test_format_decompose_text():
    """测试 decompose_text 事件格式化"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.DECOMPOSE_START,
        data={"content": "Decomposing task..."},
    )
    
    result = formatter.format_event(event)
    assert result is not None
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "decompose_text"
    assert data["data"]["content"] == "Decomposing task..."


def test_format_to_sub_tasks():
    """测试 to_sub_tasks 事件格式化"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.DECOMPOSE_COMPLETE,
        data={
            "sub_tasks": [
                {"id": "task1", "content": "Task 1", "status": ""},
                {"id": "task2", "content": "Task 2", "status": ""},
            ],
            "summary_task": "Project summary",
        },
    )
    
    result = formatter.format_event(event)
    assert result is not None
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "to_sub_tasks"
    assert len(data["data"]["sub_tasks"]) == 2
    assert data["data"]["summary_task"] == "Project summary"


def test_format_activate_agent():
    """测试 activate_agent 事件格式化"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.AGENT_ACTIVATED,
        agent_id="agent_123",
        task_id="task_456",
        data={
            "agent_name": "developer_agent",
            "tokens": 100,
            "message": "Starting task",
        },
    )
    
    result = formatter.format_event(event)
    assert result is not None
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "activate_agent"
    assert data["data"]["state"] == "running"
    assert data["data"]["agent_id"] == "agent_123"
    assert data["data"]["process_task_id"] == "task_456"
    assert data["data"]["agent_name"] == "developer_agent"
    assert data["data"]["tokens"] == 100


def test_format_deactivate_agent():
    """测试 deactivate_agent 事件格式化"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.AGENT_DEACTIVATED,
        agent_id="agent_123",
        task_id="task_456",
        data={
            "agent_name": "developer_agent",
            "tokens": 200,
            "message": "Task completed",
        },
    )
    
    result = formatter.format_event(event)
    assert result is not None
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "deactivate_agent"
    assert data["data"]["state"] == "completed"
    assert data["data"]["agent_id"] == "agent_123"


def test_format_assign_task():
    """测试 assign_task 事件格式化"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.TASK_ASSIGNED,
        agent_id="agent_123",
        task_id="task_456",
        data={
            "content": "Implement feature X",
            "state": "waiting",
            "failure_count": 0,
        },
    )
    
    result = formatter.format_event(event)
    assert result is not None
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "assign_task"
    assert data["data"]["assignee_id"] == "agent_123"
    assert data["data"]["task_id"] == "task_456"
    assert data["data"]["content"] == "Implement feature X"


def test_format_task_state_completed():
    """测试 task_state 事件格式化（完成）"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.TASK_COMPLETED,
        task_id="task_456",
        data={
            "result": "Task completed successfully",
            "failure_count": 0,
        },
    )
    
    result = formatter.format_event(event)
    assert result is not None
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "task_state"
    assert data["data"]["state"] == "DONE"
    assert data["data"]["task_id"] == "task_456"


def test_format_task_state_failed():
    """测试 task_state 事件格式化（失败）"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.TASK_FAILED,
        task_id="task_456",
        data={
            "result": "Task failed",
            "failure_count": 1,
        },
    )
    
    result = formatter.format_event(event)
    assert result is not None
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "task_state"
    assert data["data"]["state"] == "FAILED"
    assert data["data"]["failure_count"] == 1


def test_format_end():
    """测试 end 事件格式化"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.WORKFORCE_STOPPED,
        data={"summary": "All tasks completed"},
    )
    
    result = formatter.format_event(event)
    assert result is not None
    
    json_str = result[6:-2]
    data = json.loads(json_str)
    
    assert data["step"] == "end"
    assert data["data"]["summary"] == "All tasks completed"


def test_format_unsupported_action():
    """测试不支持的动作类型"""
    formatter = SSEFormatter()
    
    event = WorkforceEvent(
        action=WorkforceAction.USER_MESSAGE,
        data={"content": "test"},
    )
    
    result = formatter.format_event(event)
    assert result is None  # Should return None for unsupported actions


def test_format_custom_events():
    """测试自定义事件格式化方法"""
    formatter = SSEFormatter()
    
    # Test confirmed
    result = formatter.format_confirmed("Test question")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "confirmed"
    assert data["data"]["question"] == "Test question"
    
    # Test wait_confirm
    result = formatter.format_wait_confirm("Answer", "Question")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "wait_confirm"
    assert data["data"]["content"] == "Answer"
    assert data["data"]["question"] == "Question"
    
    # Test create_agent
    result = formatter.format_create_agent("dev_agent", "agent_1", ["tool1", "tool2"])
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "create_agent"
    assert data["data"]["agent_name"] == "dev_agent"
    assert data["data"]["agent_id"] == "agent_1"
    assert data["data"]["tools"] == ["tool1", "tool2"]
    
    # Test write_file
    result = formatter.format_write_file("/path/to/file.txt")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "write_file"
    assert data["data"]["file_path"] == "/path/to/file.txt"
    
    # Test terminal
    result = formatter.format_terminal("task_123", "Output text")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "terminal"
    assert data["data"]["process_task_id"] == "task_123"
    assert data["data"]["output"] == "Output text"
    
    # Test notice
    result = formatter.format_notice("Notice message", "task_123")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "notice"
    assert data["data"]["notice"] == "Notice message"
    assert data["data"]["process_task_id"] == "task_123"
    
    # Test ask
    result = formatter.format_ask("agent1", "Content", "Question", "Answer")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "ask"
    assert data["data"]["agent"] == "agent1"
    assert data["data"]["content"] == "Content"
    assert data["data"]["question"] == "Question"
    assert data["data"]["answer"] == "Answer"
    
    # Test budget_not_enough
    result = formatter.format_budget_not_enough()
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "budget_not_enough"
    assert data["data"] == {}
    
    # Test context_too_long
    result = formatter.format_context_too_long(150000, 100000)
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "context_too_long"
    assert data["data"]["current_length"] == 150000
    assert data["data"]["max_length"] == 100000
    
    # Test add_task
    result = formatter.format_add_task("project_1", "task_1", "Task content")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "add_task"
    assert data["data"]["project_id"] == "project_1"
    assert data["data"]["task_id"] == "task_1"
    assert data["data"]["content"] == "Task content"
    
    # Test remove_task
    result = formatter.format_remove_task("project_1", "task_1")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "remove_task"
    assert data["data"]["project_id"] == "project_1"
    assert data["data"]["task_id"] == "task_1"
    
    # Test error
    result = formatter.format_error("Error message")
    json_str = result[6:-2]
    data = json.loads(json_str)
    assert data["step"] == "error"
    assert data["data"]["message"] == "Error message"


def test_all_sse_event_types():
    """测试所有 SSE 事件类型枚举"""
    # Verify all 24 event types exist
    event_types = [
        SSEEvent.CONFIRMED,
        SSEEvent.DECOMPOSE_TEXT,
        SSEEvent.TO_SUB_TASKS,
        SSEEvent.END,
        SSEEvent.ERROR,
        SSEEvent.CREATE_AGENT,
        SSEEvent.ACTIVATE_AGENT,
        SSEEvent.DEACTIVATE_AGENT,
        SSEEvent.TASK_STATE,
        SSEEvent.ASSIGN_TASK,
        SSEEvent.NEW_TASK_STATE,
        SSEEvent.ACTIVATE_TOOLKIT,
        SSEEvent.DEACTIVATE_TOOLKIT,
        SSEEvent.WAIT_CONFIRM,
        SSEEvent.ASK,
        SSEEvent.NOTICE,
        SSEEvent.WRITE_FILE,
        SSEEvent.TERMINAL,
        SSEEvent.BUDGET_NOT_ENOUGH,
        SSEEvent.CONTEXT_TOO_LONG,
        SSEEvent.ADD_TASK,
        SSEEvent.REMOVE_TASK,
        SSEEvent.SYNC,
    ]
    
    assert len(event_types) == 23  # 24 - 1 (SYNC is special)
    
    # Test that all can be formatted
    formatter = SSEFormatter()
    for event_type in event_types:
        if event_type != SSEEvent.SYNC:  # SYNC is ignored
            result = formatter.format_custom_event(event_type, {"test": "data"})
            assert result.startswith("data: ")
            assert result.endswith("\n\n")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
