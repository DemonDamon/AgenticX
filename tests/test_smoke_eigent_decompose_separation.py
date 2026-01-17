"""
Eigent 任务分解/执行分离冒烟测试

测试 decompose_task 和 start_execution 的分离执行。
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.collaboration.workforce.workforce_pattern import WorkforcePattern
from agenticx.collaboration.workforce.events import WorkforceAction, WorkforceEventBus


@pytest.fixture
def mock_llm_provider():
    """模拟 LLM 提供者"""
    provider = MagicMock()
    return provider


@pytest.fixture
def test_agents():
    """创建测试用的 Agents"""
    coordinator = Agent.fast_construct(
        name="Coordinator",
        role="Task Coordinator",
        goal="Assign tasks to workers",
        organization_id="test-org"
    )
    task_planner = Agent.fast_construct(
        name="TaskPlanner",
        role="Task Planner",
        goal="Decompose complex tasks",
        organization_id="test-org"
    )
    worker1 = Agent.fast_construct(
        name="Worker1",
        role="Developer",
        goal="Execute development tasks",
        organization_id="test-org"
    )
    worker2 = Agent.fast_construct(
        name="Worker2",
        role="Tester",
        goal="Execute testing tasks",
        organization_id="test-org"
    )
    return coordinator, task_planner, [worker1, worker2]


@pytest.mark.asyncio
async def test_decompose_task_basic(test_agents, mock_llm_provider):
    """测试基本任务分解"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    # 模拟任务分解
    mock_subtasks = [
        Task(description="Subtask 1", expected_output="Output 1"),
        Task(description="Subtask 2", expected_output="Output 2"),
    ]
    
    with patch.object(workforce.task_planner, 'decompose_task', new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = mock_subtasks
        
        main_task = Task(description="Main task", expected_output="Final output")
        subtasks = await workforce.decompose_task(main_task)
        
        # 验证返回子任务
        assert len(subtasks) == 2
        assert subtasks[0].description == "Subtask 1"
        assert subtasks[1].description == "Subtask 2"
        
        # 验证主任务内容未被修改
        assert main_task.description == "Main task"


@pytest.mark.asyncio
async def test_decompose_task_with_coordinator_context(test_agents, mock_llm_provider):
    """测试带 Coordinator Context 的任务分解"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    mock_subtasks = [Task(description="Subtask 1", expected_output="Output 1")]
    
    captured_task_content = None
    
    async def mock_decompose(task, **kwargs):
        nonlocal captured_task_content
        captured_task_content = task.description
        return mock_subtasks
    
    with patch.object(workforce.task_planner, 'decompose_task', new=mock_decompose):
        main_task = Task(description="Main task", expected_output="Final output")
        coordinator_ctx = "Previous context: User completed task A"
        
        subtasks = await workforce.decompose_task(
            main_task,
            coordinator_context=coordinator_ctx
        )
        
        # 验证 Coordinator Context 被注入
        assert "Previous context" in captured_task_content
        assert "=== CURRENT TASK ===" in captured_task_content
        assert "Main task" in captured_task_content
        
        # 验证主任务内容被恢复
        assert main_task.description == "Main task"
        assert "Previous context" not in main_task.description


@pytest.mark.asyncio
async def test_decompose_task_event_emission(test_agents, mock_llm_provider):
    """测试任务分解事件发送"""
    coordinator, task_planner, workers = test_agents
    
    event_bus = WorkforceEventBus()
    received_events = []
    
    def callback(event):
        received_events.append(event)
    
    event_bus.subscribe(callback)
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
        event_bus=event_bus,
    )
    
    mock_subtasks = [Task(description="Subtask 1", expected_output="Output 1")]
    
    with patch.object(workforce.task_planner, 'decompose_task', new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = mock_subtasks
        
        main_task = Task(description="Main task", expected_output="Final output")
        await workforce.decompose_task(main_task)
        
        # 验证事件发送
        assert len(received_events) >= 2
        assert received_events[0].action == WorkforceAction.DECOMPOSE_START
        assert received_events[-1].action == WorkforceAction.DECOMPOSE_COMPLETE
        assert received_events[-1].data["subtasks_count"] == 1


@pytest.mark.asyncio
async def test_decompose_task_empty_result(test_agents, mock_llm_provider):
    """测试任务分解返回空列表"""
    coordinator, task_planner, workers = test_agents
    
    event_bus = WorkforceEventBus()
    received_events = []
    event_bus.subscribe(lambda e: received_events.append(e))
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
        event_bus=event_bus,
    )
    
    with patch.object(workforce.task_planner, 'decompose_task', new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = []  # 空结果
        
        main_task = Task(description="Main task", expected_output="Final output")
        subtasks = await workforce.decompose_task(main_task)
        
        assert len(subtasks) == 0
        # 验证发送失败事件
        failed_events = [e for e in received_events if e.action == WorkforceAction.DECOMPOSE_FAILED]
        assert len(failed_events) == 1


@pytest.mark.asyncio
async def test_start_execution_basic(test_agents, mock_llm_provider):
    """测试基本任务执行"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    subtasks = [
        Task(description="Subtask 1", expected_output="Output 1"),
        Task(description="Subtask 2", expected_output="Output 2"),
    ]
    
    # 模拟任务分配和执行
    with patch.object(workforce.coordinator, 'assign_tasks', new_callable=AsyncMock) as mock_assign:
        mock_assign.return_value = {
            subtasks[0].id: workers[0].id,
            subtasks[1].id: workers[1].id,
        }
        
        with patch.object(workforce, '_execute_subtask', new_callable=AsyncMock) as mock_execute:
            # 模拟任务完成
            async def mock_exec(subtask, worker, parent_task):
                workforce._task_results[subtask.id] = {
                    "success": True,
                    "content": f"Result for {subtask.description}",
                    "worker_id": worker.id,
                }
            
            mock_execute.side_effect = mock_exec
            
            with patch.object(workforce.task_planner, 'compose_results', new_callable=AsyncMock) as mock_compose:
                mock_compose.return_value = "Final composed result"
                
                result = await workforce.start_execution(subtasks)
                
                assert result["success"] is True
                assert result["content"] == "Final composed result"
                assert not result.get("failed", False)


@pytest.mark.asyncio
async def test_start_execution_empty_subtasks(test_agents, mock_llm_provider):
    """测试空子任务列表执行"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    result = await workforce.start_execution([])
    
    assert result["success"] is False
    assert "No subtasks" in result["content"]
    assert result["failed"] is True


@pytest.mark.asyncio
async def test_decompose_and_execute_separation(test_agents, mock_llm_provider):
    """测试分解和执行分离流程"""
    coordinator, task_planner, workers = test_agents
    
    event_bus = WorkforceEventBus()
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
        event_bus=event_bus,
    )
    
    # 步骤 1: 分解任务
    mock_subtasks = [Task(description="Subtask 1", expected_output="Output 1")]
    
    with patch.object(workforce.task_planner, 'decompose_task', new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = mock_subtasks
        
        main_task = Task(description="Main task", expected_output="Final output")
        subtasks = await workforce.decompose_task(main_task)
        
        assert len(subtasks) == 1
        
        # 从事件历史验证分解事件
        decompose_events = event_bus.get_event_history(action=WorkforceAction.DECOMPOSE_START)
        decompose_complete = event_bus.get_event_history(action=WorkforceAction.DECOMPOSE_COMPLETE)
        assert len(decompose_events) >= 1
        assert len(decompose_complete) >= 1
    
    # 步骤 2: 执行子任务（可以编辑后再执行）
    with patch.object(workforce.coordinator, 'assign_tasks', new_callable=AsyncMock) as mock_assign:
        mock_assign.return_value = {subtasks[0].id: workers[0].id}
        
        with patch.object(workforce, '_execute_subtask', new_callable=AsyncMock):
            workforce._task_results[subtasks[0].id] = {"success": True, "content": "Result"}
            
            with patch.object(workforce.task_planner, 'compose_results', new_callable=AsyncMock) as mock_compose:
                mock_compose.return_value = "Final result"
                
                result = await workforce.start_execution(subtasks, parent_task=main_task)
                
                assert result["success"] is True
                
                # 从事件历史验证执行事件
                started_events = event_bus.get_event_history(action=WorkforceAction.WORKFORCE_STARTED)
                stopped_events = event_bus.get_event_history(action=WorkforceAction.WORKFORCE_STOPPED)
                assert len(started_events) >= 1
                assert len(stopped_events) >= 1


@pytest.mark.asyncio
async def test_stream_callbacks(test_agents, mock_llm_provider):
    """测试流式回调"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    batch_called = []
    text_called = []
    
    def on_batch(subtasks, is_final):
        batch_called.append((len(subtasks), is_final))
    
    def on_text(text):
        text_called.append(text)
    
    mock_subtasks = [Task(description="Subtask 1", expected_output="Output 1")]
    
    with patch.object(workforce.task_planner, 'decompose_task', new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = mock_subtasks
        
        main_task = Task(description="Main task", expected_output="Final output")
        await workforce.decompose_task(
            main_task,
            on_stream_batch=on_batch,
            on_stream_text=on_text,
        )
        
        # 验证批次回调被调用
        assert len(batch_called) == 1
        assert batch_called[0] == (1, True)
