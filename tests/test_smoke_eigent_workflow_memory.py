"""
Eigent 工作流记忆传递冒烟测试

测试 Worker 之间的记忆传递机制。
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.core.agent_executor import AgentExecutor
from agenticx.collaboration.workforce.worker import SingleAgentWorker


@pytest.fixture
def mock_executor():
    """模拟 AgentExecutor"""
    executor = MagicMock(spec=AgentExecutor)
    executor.run = MagicMock(return_value={"success": True, "result": "Task completed"})
    return executor


@pytest.fixture
def test_agent():
    """创建测试 Agent"""
    return Agent.fast_construct(
        name="TestWorker",
        role="worker",
        goal="Execute tasks",
        organization_id="test-org"
    )


@pytest.mark.asyncio
async def test_worker_without_workflow_memory(test_agent, mock_executor):
    """测试不启用工作流记忆的 Worker"""
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=mock_executor,
        enable_workflow_memory=False,
    )
    
    assert worker.enable_workflow_memory is False
    assert worker._conversation_accumulator is None
    
    task = Task(description="Test task", expected_output="Output")
    result = await worker.process_task(task)
    
    assert result["success"] is True
    assert worker.get_conversation_accumulator() is None


@pytest.mark.asyncio
async def test_worker_with_workflow_memory(test_agent, mock_executor):
    """测试启用工作流记忆的 Worker"""
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=mock_executor,
        enable_workflow_memory=True,
        max_memory_messages=5,
    )
    
    assert worker.enable_workflow_memory is True
    assert worker._conversation_accumulator is not None
    
    # 执行第一个任务
    task1 = Task(description="Task 1", expected_output="Output 1")
    result1 = await worker.process_task(task1)
    
    assert result1["success"] is True
    
    # 检查记忆已更新
    memory = worker.get_conversation_accumulator()
    assert memory is not None
    assert len(memory) == 1
    assert memory[0]["task_id"] == task1.id
    assert memory[0]["task_description"] == "Task 1"


@pytest.mark.asyncio
async def test_workflow_memory_accumulation(test_agent, mock_executor):
    """测试工作流记忆累积"""
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=mock_executor,
        enable_workflow_memory=True,
        max_memory_messages=5,
    )
    
    # 执行多个任务
    for i in range(3):
        task = Task(description=f"Task {i}", expected_output=f"Output {i}")
        await worker.process_task(task)
    
    # 检查记忆累积
    memory = worker.get_conversation_accumulator()
    assert len(memory) == 3
    for i in range(3):
        assert memory[i]["task_description"] == f"Task {i}"


@pytest.mark.asyncio
async def test_workflow_memory_max_limit(test_agent, mock_executor):
    """测试工作流记忆最大限制"""
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=mock_executor,
        enable_workflow_memory=True,
        max_memory_messages=3,  # 最多保留 3 条
    )
    
    # 执行 5 个任务
    for i in range(5):
        task = Task(description=f"Task {i}", expected_output=f"Output {i}")
        await worker.process_task(task)
    
    # 应该只保留最近的 3 条
    memory = worker.get_conversation_accumulator()
    assert len(memory) == 3
    assert memory[0]["task_description"] == "Task 2"  # 最老的
    assert memory[2]["task_description"] == "Task 4"  # 最新的


@pytest.mark.asyncio
async def test_workflow_memory_injection(test_agent):
    """测试工作流记忆注入到任务上下文"""
    captured_task = None
    
    def mock_run(agent, task):
        nonlocal captured_task
        captured_task = task
        return {"success": True, "result": "Done"}
    
    executor = MagicMock(spec=AgentExecutor)
    executor.run = mock_run
    
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=executor,
        enable_workflow_memory=True,
    )
    
    # 第一个任务
    task1 = Task(description="Task 1", expected_output="Output 1")
    await worker.process_task(task1)
    
    # 第二个任务（应该包含第一个任务的记忆）
    task2 = Task(description="Task 2", expected_output="Output 2")
    await worker.process_task(task2)
    
    # 验证第二个任务的上下文包含工作流记忆
    assert captured_task is not None
    assert "workflow_memory" in captured_task.context
    assert len(captured_task.context["workflow_memory"]) == 1
    assert captured_task.context["workflow_memory"][0]["task_description"] == "Task 1"


@pytest.mark.asyncio
async def test_worker_attempts_tracking(test_agent, mock_executor):
    """测试 Worker 尝试详情记录"""
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=mock_executor,
    )
    
    # 执行几个任务
    for i in range(3):
        task = Task(description=f"Task {i}", expected_output=f"Output {i}")
        await worker.process_task(task)
    
    # 检查尝试记录
    attempts = worker.get_attempt_history()
    assert len(attempts) == 3
    
    for i, attempt in enumerate(attempts):
        assert attempt["success"] is True
        assert "duration" in attempt
        assert "timestamp" in attempt


@pytest.mark.asyncio
async def test_worker_failed_attempt_tracking(test_agent):
    """测试失败尝试的记录"""
    executor = MagicMock(spec=AgentExecutor)
    executor.run = MagicMock(side_effect=ValueError("Task execution failed"))
    
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=executor,
    )
    
    task = Task(description="Failing task", expected_output="Output")
    result = await worker.process_task(task)
    
    assert result["success"] is False
    assert result["failed"] is True
    
    # 检查失败记录
    attempts = worker.get_attempt_history()
    assert len(attempts) == 1
    assert attempts[0]["success"] is False
    assert "error" in attempts[0]
    assert "Task execution failed" in attempts[0]["error"]


@pytest.mark.asyncio
async def test_get_attempt_count(test_agent, mock_executor):
    """测试获取尝试次数"""
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=mock_executor,
    )
    
    assert worker.get_attempt_count() == 0
    
    # 执行任务
    task = Task(description="Task", expected_output="Output")
    await worker.process_task(task)
    
    assert worker.get_attempt_count() == 1


@pytest.mark.asyncio
async def test_get_attempt_history_with_limit(test_agent, mock_executor):
    """测试限制尝试历史返回数量"""
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=mock_executor,
    )
    
    # 执行多个任务
    for i in range(5):
        task = Task(description=f"Task {i}", expected_output=f"Output {i}")
        await worker.process_task(task)
    
    # 只获取最近的 2 个
    recent_attempts = worker.get_attempt_history(limit=2)
    assert len(recent_attempts) == 2


@pytest.mark.asyncio
async def test_workflow_memory_with_dependency_results(test_agent, mock_executor):
    """测试工作流记忆与依赖结果的结合"""
    worker = SingleAgentWorker(
        agent=test_agent,
        executor=mock_executor,
        enable_workflow_memory=True,
    )
    
    # 执行第一个任务
    task1 = Task(description="Task 1", expected_output="Output 1")
    await worker.process_task(task1)
    
    # 执行第二个任务，带依赖结果
    task2 = Task(description="Task 2", expected_output="Output 2")
    dependency_results = {
        "dep_task": {"content": "Dependency result"}
    }
    
    captured_task = None
    
    def mock_run(agent, task):
        nonlocal captured_task
        captured_task = task
        return {"success": True, "result": "Done"}
    
    worker.executor.run = mock_run
    
    await worker.process_task(task2, dependency_results=dependency_results)
    
    # 验证上下文同时包含工作流记忆和依赖结果
    assert "workflow_memory" in captured_task.context
    assert "dependency_results" in captured_task.context
    assert captured_task.context["dependency_results"] == dependency_results
