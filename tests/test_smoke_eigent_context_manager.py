"""
Eigent ContextManager 冒烟测试

测试 Coordinator 和 Worker 上下文的精细化管理。
"""

import pytest

from agenticx.collaboration.workforce.context_manager import ContextManager
from agenticx.core.event import EventLog, TaskStartEvent, TaskEndEvent
from agenticx.core.context_compiler import ContextCompiler
from agenticx.core.token_counter import TokenCounter


def test_create_context_manager():
    """测试创建 ContextManager"""
    manager = ContextManager()
    assert manager is not None
    assert manager.context_compiler is not None
    assert manager.token_counter is not None


def test_build_coordinator_context_from_conversation():
    """测试从对话历史构建 Coordinator 上下文"""
    manager = ContextManager()
    
    conversation_history = [
        {"role": "user", "content": "Write a report"},
        {"role": "assistant", "content": "I will help you"},
        {"role": "task_result", "content": {
            "task_content": "Write report",
            "task_result": "Report completed successfully"
        }},
        {"role": "user", "content": "Now create a presentation"},
    ]
    
    context = manager.build_coordinator_context(conversation_history)
    
    assert "User: Write a report" in context
    assert "Assistant: I will help you" in context
    assert "Previous Task" in context
    assert "Report completed" in context
    assert "User: Now create a presentation" in context


def test_build_coordinator_context_with_event_log():
    """测试从 EventLog 构建 Coordinator 上下文"""
    manager = ContextManager()
    event_log = EventLog()
    
    # 添加一些事件
    event_log.add_event(TaskStartEvent(
        task_description="Task 1",
        agent_id="agent_1",
    ))
    event_log.add_event(TaskEndEvent(
        success=True,
        result="Task 1 completed",
        agent_id="agent_1",
    ))
    
    context = manager.build_coordinator_context(
        conversation_history=[],
        event_log=event_log,
    )
    
    # 应该使用 EventLog 而不是 conversation_history
    assert isinstance(context, str)
    # ContextCompiler 会生成一些内容
    # 具体内容取决于 ContextCompiler 的实现


def test_build_coordinator_context_token_limit():
    """测试 Coordinator 上下文 Token 限制"""
    manager = ContextManager(max_coordinator_tokens=50)
    
    # 创建很长的对话历史
    long_content = "A" * 1000
    conversation_history = [
        {"role": "user", "content": long_content},
    ]
    
    context = manager.build_coordinator_context(conversation_history)
    
    # 验证上下文被截断
    token_count = manager.estimate_tokens(context)
    assert token_count <= 50


def test_build_worker_context():
    """测试构建 Worker 上下文"""
    manager = ContextManager()
    
    context = manager.build_worker_context(
        task_description="Implement feature X",
    )
    
    assert "Task: Implement feature X" in context


def test_build_worker_context_with_dependencies():
    """测试带依赖结果的 Worker 上下文"""
    manager = ContextManager()
    
    dependency_results = {
        "task_1": {"content": "Feature A implemented"},
        "task_2": {"content": "Feature B tested"},
    }
    
    context = manager.build_worker_context(
        task_description="Integrate features",
        dependency_results=dependency_results,
    )
    
    assert "Task: Integrate features" in context
    assert "Dependency Results:" in context
    assert "task_1" in context
    assert "Feature A" in context
    assert "task_2" in context
    assert "Feature B" in context


def test_build_worker_context_token_limit():
    """测试 Worker 上下文 Token 限制"""
    manager = ContextManager(max_worker_tokens=50)
    
    # 创建很长的任务描述
    long_task = "A" * 1000
    
    context = manager.build_worker_context(long_task)
    
    # 验证上下文被截断（允许小误差 ±5 tokens）
    token_count = manager.estimate_tokens(context)
    assert token_count <= 55  # 允许小误差


def test_summarize_content():
    """测试内容摘要"""
    manager = ContextManager()
    
    # 短内容不应被截断
    short_content = "Short message"
    summary = manager._summarize_content(short_content, max_length=100)
    assert summary == short_content
    
    # 长内容应被截断
    long_content = "A" * 300
    summary = manager._summarize_content(long_content, max_length=200)
    assert len(summary) == 203  # 200 + "..."
    assert summary.endswith("...")


def test_estimate_tokens():
    """测试 Token 估算"""
    manager = ContextManager()
    
    text = "Hello, world! This is a test."
    token_count = manager.estimate_tokens(text)
    
    assert isinstance(token_count, int)
    assert token_count > 0


def test_get_stats():
    """测试获取统计信息"""
    manager = ContextManager(
        max_coordinator_tokens=2000,
        max_worker_tokens=1000,
    )
    
    stats = manager.get_stats()
    
    assert stats["max_coordinator_tokens"] == 2000
    assert stats["max_worker_tokens"] == 1000
    assert stats["compiler_enabled"] is True
    assert stats["counter_enabled"] is True


def test_context_isolation():
    """测试上下文隔离（Coordinator vs Worker）"""
    manager = ContextManager()
    
    conversation_history = [
        {"role": "user", "content": "Historical message"},
        {"role": "task_result", "content": {
            "task_content": "Previous task",
            "task_result": "Previous result"
        }},
    ]
    
    # Coordinator 上下文应包含历史
    coordinator_ctx = manager.build_coordinator_context(conversation_history)
    assert "Historical message" in coordinator_ctx or "Previous Task" in coordinator_ctx
    
    # Worker 上下文不应包含历史
    worker_ctx = manager.build_worker_context("Current task")
    assert "Task: Current task" in worker_ctx
    assert "Historical message" not in worker_ctx
    assert "Previous task" not in worker_ctx


def test_custom_token_limits():
    """测试自定义 Token 限制"""
    manager = ContextManager(
        max_coordinator_tokens=100,
        max_worker_tokens=50,
    )
    
    assert manager.max_coordinator_tokens == 100
    assert manager.max_worker_tokens == 50


def test_multiple_task_results_summarization():
    """测试多个任务结果的摘要"""
    manager = ContextManager()
    
    conversation_history = []
    for i in range(5):
        conversation_history.append({
            "role": "task_result",
            "content": {
                "task_content": f"Task {i}",
                "task_result": f"Result {i}" * 100,  # 长结果
            }
        })
    
    context = manager.build_coordinator_context(conversation_history)
    
    # 验证所有任务都被包含
    for i in range(5):
        assert f"Task {i}" in context
    
    # 验证内容被摘要（不是全部内容）
    full_content = "Result 0" * 100
    assert full_content not in context


def test_dependency_results_summarization():
    """测试依赖结果的摘要"""
    manager = ContextManager()
    
    # 创建很长的依赖结果
    long_result = "A" * 1000
    dependency_results = {
        "dep_1": {"content": long_result},
    }
    
    context = manager.build_worker_context(
        "Task description",
        dependency_results=dependency_results,
    )
    
    # 验证依赖结果被包含但被摘要
    assert "dep_1" in context
    assert len(context) < len(long_result)  # 应该比原始内容短
