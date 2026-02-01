"""TaskLock smoke tests.

Tests core functionality of TaskLock state manager:
- Action Queue management
- Conversation history management
- Multi-turn conversation state consistency
- Task pause and resume

Author: Damon Li
"""

import pytest # type: ignore
import asyncio
from datetime import datetime
from agenticx.collaboration.task_lock import (
    TaskLock,
    TaskStatus,
    Action,
    ActionData,
    get_or_create_task_lock,
    remove_task_lock,
)


@pytest.mark.asyncio
async def test_task_lock_create():
    """测试创建 TaskLock"""
    task_lock = TaskLock(project_id="test_project_1")
    
    assert task_lock.id == "test_project_1"
    assert task_lock.status == TaskStatus.CONFIRMING
    assert len(task_lock.conversation_history) == 0
    assert task_lock.last_task_result == ""


@pytest.mark.asyncio
async def test_action_queue_put_get():
    """测试 Action Queue 的 put 和 get"""
    task_lock = TaskLock(project_id="test_project_2")
    
    # Put action
    action_data = ActionData(
        action=Action.IMPROVE,
        data={"question": "test question"},
    )
    await task_lock.put_queue(action_data)
    
    # Get action
    retrieved = await task_lock.get_queue()
    assert retrieved is not None
    assert retrieved.action == Action.IMPROVE
    assert retrieved.data["question"] == "test question"


@pytest.mark.asyncio
async def test_action_queue_timeout():
    """测试 Action Queue 超时"""
    task_lock = TaskLock(project_id="test_project_3")
    
    # Get with timeout (should return None)
    result = await task_lock.get_queue(timeout=0.1)
    assert result is None


@pytest.mark.asyncio
async def test_conversation_history():
    """测试对话历史管理"""
    task_lock = TaskLock(project_id="test_project_4")
    
    # Add conversations
    task_lock.add_conversation("user", "Hello")
    task_lock.add_conversation("assistant", "Hi there")
    task_lock.add_conversation("user", "How are you?")
    
    # Get history
    history = task_lock.get_conversation_history()
    assert len(history) == 3
    assert history[0]["role"] == "user"
    assert history[0]["content"] == "Hello"
    assert history[1]["role"] == "assistant"
    assert history[2]["role"] == "user"
    
    # Get limited history
    limited = task_lock.get_conversation_history(limit=2)
    assert len(limited) == 2
    assert limited[0]["role"] == "assistant"  # Last 2 entries


@pytest.mark.asyncio
async def test_conversation_history_cleanup():
    """测试对话历史自动清理"""
    task_lock = TaskLock(project_id="test_project_5", max_history_length=100)
    
    # Add many conversations
    for i in range(20):
        task_lock.add_conversation("user", f"Message {i} " * 10)  # Each ~100 chars
    
    # History should be cleaned up
    history = task_lock.get_conversation_history()
    total_length = sum(len(str(e.get("content", ""))) for e in history)
    assert total_length <= task_lock.max_history_length


@pytest.mark.asyncio
async def test_multi_turn_conversation():
    """测试多轮对话状态一致性"""
    task_lock = TaskLock(project_id="test_project_6")
    
    # First turn
    task_lock.add_conversation("user", "Create a file")
    task_lock.set_status(TaskStatus.PROCESSING)
    task_lock.update_last_task_result("File created successfully", "Created file.txt")
    
    # Second turn (should preserve history)
    task_lock.add_conversation("user", "Update the file")
    
    # Check history preserved
    history = task_lock.get_conversation_history()
    assert len(history) == 2
    assert history[0]["content"] == "Create a file"
    assert history[1]["content"] == "Update the file"
    
    # Check last task result preserved
    assert task_lock.last_task_result == "File created successfully"
    assert task_lock.last_task_summary == "Created file.txt"


@pytest.mark.asyncio
async def test_task_status_transitions():
    """测试任务状态转换"""
    task_lock = TaskLock(project_id="test_project_7")
    
    assert task_lock.status == TaskStatus.CONFIRMING
    
    task_lock.set_status(TaskStatus.CONFIRMED)
    assert task_lock.status == TaskStatus.CONFIRMED
    
    task_lock.set_status(TaskStatus.PROCESSING)
    assert task_lock.status == TaskStatus.PROCESSING
    
    task_lock.set_status(TaskStatus.DONE)
    assert task_lock.status == TaskStatus.DONE


@pytest.mark.asyncio
async def test_task_pause_resume():
    """测试任务暂停和恢复"""
    task_lock = TaskLock(project_id="test_project_8")
    
    task_lock.set_status(TaskStatus.PROCESSING)
    assert task_lock.status == TaskStatus.PROCESSING
    
    # Pause
    task_lock.set_status(TaskStatus.PAUSED)
    assert task_lock.status == TaskStatus.PAUSED
    
    # Resume (back to processing)
    task_lock.set_status(TaskStatus.PROCESSING)
    assert task_lock.status == TaskStatus.PROCESSING


@pytest.mark.asyncio
async def test_background_tasks():
    """测试后台任务管理"""
    task_lock = TaskLock(project_id="test_project_9")
    
    async def dummy_task():
        await asyncio.sleep(0.1)
        return "done"
    
    # Add background task
    task = asyncio.create_task(dummy_task())
    task_lock.add_background_task(task)
    assert len(task_lock.background_tasks) == 1
    
    # Wait for task to complete
    await task
    
    # Remove task
    task_lock.remove_background_task(task)
    assert len(task_lock.background_tasks) == 0


@pytest.mark.asyncio
async def test_cleanup():
    """测试清理功能"""
    task_lock = TaskLock(project_id="test_project_10")
    
    # Add some data
    await task_lock.put_queue(ActionData(action=Action.START, data={}))
    task_lock.add_conversation("user", "test")
    
    async def dummy_task():
        await asyncio.sleep(1)
    
    task = asyncio.create_task(dummy_task())
    task_lock.add_background_task(task)
    
    # Cleanup
    await task_lock.cleanup()
    
    # Check cleanup
    assert task_lock.queue.empty()
    assert len(task_lock.background_tasks) == 0
    # Conversation history should remain (not cleared)
    assert len(task_lock.conversation_history) == 1


@pytest.mark.asyncio
async def test_human_input_queue():
    """测试人类输入队列"""
    task_lock = TaskLock(project_id="test_project_11")
    
    # Get queue for agent
    queue1 = task_lock.get_human_input_queue("agent1")
    queue2 = task_lock.get_human_input_queue("agent1")
    
    # Should return same queue
    assert queue1 is queue2
    
    # Different agent should get different queue
    queue3 = task_lock.get_human_input_queue("agent2")
    assert queue3 is not queue1


@pytest.mark.asyncio
async def test_get_or_create_task_lock():
    """测试 get_or_create_task_lock"""
    # Create first time
    lock1 = get_or_create_task_lock("shared_project")
    assert lock1.id == "shared_project"
    
    # Get existing
    lock2 = get_or_create_task_lock("shared_project")
    assert lock2 is lock1  # Same instance
    
    # Cleanup
    remove_task_lock("shared_project")


@pytest.mark.asyncio
async def test_update_last_task_result():
    """测试更新最后任务结果"""
    task_lock = TaskLock(project_id="test_project_12")
    
    task_lock.update_last_task_result("Result 1", "Summary 1")
    assert task_lock.last_task_result == "Result 1"
    assert task_lock.last_task_summary == "Summary 1"
    
    task_lock.update_last_task_result("Result 2")
    assert task_lock.last_task_result == "Result 2"
    assert task_lock.last_task_summary == "Summary 1"  # Summary unchanged


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
