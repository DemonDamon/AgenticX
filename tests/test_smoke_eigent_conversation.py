"""
Eigent ConversationManager 冒烟测试

测试对话历史管理的基本功能。
"""

import pytest
import asyncio

from agenticx.collaboration.conversation import (
    ConversationManager,
    ConversationEntry,
)
from agenticx.core.event import EventLog
from agenticx.memory.short_term import ShortTermMemory


def test_create_conversation_manager():
    """测试创建 ConversationManager"""
    manager = ConversationManager()
    assert manager is not None
    assert manager.conversation_history == []


@pytest.mark.asyncio
async def test_add_conversation():
    """测试添加对话记录"""
    manager = ConversationManager()
    
    await manager.add_conversation("user", "Hello, how are you?")
    await manager.add_conversation("assistant", "I'm doing well, thank you!")
    
    history = manager.get_history()
    assert len(history) == 2
    assert history[0].role == "user"
    assert history[0].content == "Hello, how are you?"
    assert history[1].role == "assistant"


@pytest.mark.asyncio
async def test_add_task_result():
    """测试添加任务结果"""
    manager = ConversationManager()
    
    task_result = {
        "task_content": "Write a report",
        "task_result": "Report completed successfully",
        "working_directory": "/tmp/workspace",
    }
    
    await manager.add_conversation("task_result", task_result)
    
    history = manager.get_history()
    assert len(history) == 1
    assert history[0].role == "task_result"
    assert isinstance(history[0].content, dict)


def test_get_conversation_context():
    """测试获取对话上下文"""
    manager = ConversationManager()
    manager.conversation_history = [
        ConversationEntry(role="user", content="What is AI?"),
        ConversationEntry(role="assistant", content="AI is..."),
        ConversationEntry(role="task_result", content={
            "task_content": "Research AI",
            "task_result": "AI research completed"
        }),
    ]
    
    context = manager.get_conversation_context()
    
    assert "User: What is AI?" in context
    assert "Assistant: AI is..." in context
    assert "Previous Task: Research AI" in context
    assert "Result: AI research completed" in context


def test_get_conversation_context_with_role_filter():
    """测试按角色过滤对话上下文"""
    manager = ConversationManager()
    manager.conversation_history = [
        ConversationEntry(role="user", content="Question 1"),
        ConversationEntry(role="assistant", content="Answer 1"),
        ConversationEntry(role="system", content="System message"),
    ]
    
    # 只包含用户消息
    context = manager.get_conversation_context(include_roles=["user"])
    
    assert "User: Question 1" in context
    assert "Answer 1" not in context
    assert "System message" not in context


def test_get_conversation_context_with_token_limit():
    """测试 Token 限制"""
    manager = ConversationManager()
    
    # 添加很长的对话
    long_content = "A" * 10000
    manager.conversation_history = [
        ConversationEntry(role="user", content=long_content),
    ]
    
    # 限制为 100 tokens (约 400 字符)
    context = manager.get_conversation_context(max_tokens=100)
    
    assert len(context) <= 400


@pytest.mark.asyncio
async def test_cleanup_history_by_entries():
    """测试按条目数清理历史"""
    manager = ConversationManager(max_entries=5)
    
    # 添加 10 个条目
    for i in range(10):
        await manager.add_conversation("user", f"Message {i}")
    
    # 应该只保留最近的 5 个
    history = manager.get_history()
    assert len(history) == 5
    assert history[0].content == "Message 5"
    assert history[-1].content == "Message 9"


@pytest.mark.asyncio
async def test_cleanup_history_by_length():
    """测试按字符数清理历史"""
    manager = ConversationManager(max_history_length=100)
    
    # 添加多个条目直到超过限制
    for i in range(10):
        await manager.add_conversation("user", f"This is a message number {i} with some content")
    
    # 验证总字符数不超过限制
    total_chars = sum(len(str(e.content)) for e in manager.conversation_history)
    assert total_chars <= 100


def test_get_history_with_filter():
    """测试获取历史时的过滤"""
    manager = ConversationManager()
    manager.conversation_history = [
        ConversationEntry(role="user", content="Message 1"),
        ConversationEntry(role="assistant", content="Response 1"),
        ConversationEntry(role="user", content="Message 2"),
        ConversationEntry(role="assistant", content="Response 2"),
    ]
    
    # 只获取用户消息
    user_messages = manager.get_history(role="user")
    assert len(user_messages) == 2
    assert all(e.role == "user" for e in user_messages)
    
    # 限制数量
    recent_messages = manager.get_history(limit=2)
    assert len(recent_messages) == 2
    assert recent_messages[0].content == "Message 2"


def test_clear_history():
    """测试清空历史"""
    manager = ConversationManager()
    manager.conversation_history = [
        ConversationEntry(role="user", content="Message 1"),
        ConversationEntry(role="assistant", content="Response 1"),
    ]
    
    count = manager.clear_history()
    
    assert count == 2
    assert len(manager.conversation_history) == 0


def test_get_history_stats():
    """测试获取历史统计"""
    manager = ConversationManager()
    manager.conversation_history = [
        ConversationEntry(role="user", content="User message"),
        ConversationEntry(role="assistant", content="Assistant response"),
        ConversationEntry(role="user", content="Another user message"),
    ]
    
    stats = manager.get_history_stats()
    
    assert stats["total_entries"] == 3
    assert stats["total_chars"] > 0
    assert stats["role_counts"]["user"] == 2
    assert stats["role_counts"]["assistant"] == 1
    assert stats["estimated_tokens"] > 0


@pytest.mark.asyncio
async def test_integration_with_memory():
    """测试与 Memory 系统集成（基础验证）"""
    memory = ShortTermMemory(
        tenant_id="test-tenant",
        max_records=10,
    )
    
    manager = ConversationManager(memory=memory)
    
    # 添加对话（即使 memory 接口不匹配也不应该崩溃）
    await manager.add_conversation("user", "Test message")
    
    # 验证对话被添加到 ConversationManager
    history = manager.get_history()
    assert len(history) == 1
    assert history[0].content == "Test message"


def test_conversation_entry_model():
    """测试 ConversationEntry 数据模型"""
    entry = ConversationEntry(
        role="user",
        content="Test content",
        metadata={"source": "web"},
    )
    
    assert entry.role == "user"
    assert entry.content == "Test content"
    assert entry.metadata["source"] == "web"
    assert isinstance(entry.timestamp, float)


@pytest.mark.asyncio
async def test_multiple_task_results():
    """测试多个任务结果的上下文构建"""
    manager = ConversationManager()
    
    await manager.add_conversation("task_result", {
        "task_content": "Task 1",
        "task_result": "Result 1"
    })
    await manager.add_conversation("user", "Continue with task 2")
    await manager.add_conversation("task_result", {
        "task_content": "Task 2",
        "task_result": "Result 2"
    })
    
    context = manager.get_conversation_context()
    
    assert "Previous Task: Task 1" in context
    assert "Result: Result 1" in context
    assert "Previous Task: Task 2" in context
    assert "Result: Result 2" in context
    assert "User: Continue with task 2" in context


def test_empty_conversation_context():
    """测试空对话历史的上下文"""
    manager = ConversationManager()
    
    context = manager.get_conversation_context()
    
    assert context == ""
