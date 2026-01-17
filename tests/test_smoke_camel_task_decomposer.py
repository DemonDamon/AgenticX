"""
CAMEL TaskDecomposer 智能任务分解冒烟测试

验证 P0.2 功能点：
- TaskDecomposer 类可正常创建
- decompose_task() 方法可正常调用
- 子任务独立性、依赖关系正确性、结构化输出格式
"""

import pytest
from unittest.mock import Mock, AsyncMock
from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.collaboration.workforce import TaskDecomposer, TaskDecompositionResult
from agenticx.collaboration.workforce.worker import SingleAgentWorker


@pytest.fixture
def mock_llm_provider():
    """创建模拟的 LLM Provider"""
    provider = Mock()
    provider.generate = AsyncMock(return_value="Mock response")
    return provider


@pytest.fixture
def task_agent():
    """创建测试用的 Task Agent"""
    return Agent.fast_construct(
        name="Task Planner",
        role="planner",
        goal="分解复杂任务为子任务",
        organization_id="test-org"
    )


@pytest.fixture
def sample_workers():
    """创建测试用的 Worker 列表"""
    worker1_agent = Agent.fast_construct(
        name="Worker 1",
        role="worker",
        goal="执行任务",
        organization_id="test-org"
    )
    
    worker2_agent = Agent.fast_construct(
        name="Worker 2",
        role="worker",
        goal="执行任务",
        organization_id="test-org"
    )
    
    executor = Mock()
    return [
        SingleAgentWorker(agent=worker1_agent, executor=executor),
        SingleAgentWorker(agent=worker2_agent, executor=executor),
    ]


def test_task_decomposer_creation(task_agent, mock_llm_provider):
    """测试 TaskDecomposer 可正常创建"""
    decomposer = TaskDecomposer(
        task_agent=task_agent,
        llm_provider=mock_llm_provider,
    )
    
    assert decomposer is not None
    assert decomposer.task_agent.id == task_agent.id
    assert decomposer.executor is not None


def test_task_decomposer_with_planner(task_agent, mock_llm_provider):
    """测试 TaskDecomposer 可以接受 AdaptivePlanner"""
    from agenticx.planner import AdaptivePlanner
    
    planner = AdaptivePlanner(llm=mock_llm_provider)
    decomposer = TaskDecomposer(
        task_agent=task_agent,
        llm_provider=mock_llm_provider,
        planner=planner,
    )
    
    assert decomposer.planner is not None


@pytest.mark.asyncio
async def test_decompose_task_basic(task_agent, mock_llm_provider, sample_workers):
    """测试 decompose_task() 基本功能"""
    decomposer = TaskDecomposer(
        task_agent=task_agent,
        llm_provider=mock_llm_provider,
    )
    
    # Mock executor.run 返回 XML 格式的子任务
    decomposer.executor.run = Mock(return_value={
        "success": True,
        "result": "<tasks><task>Subtask 1: Research AI trends</task><task>Subtask 2: Generate report</task></tasks>"
    })
    
    task = Task(
        description="Research AI trends and generate a report",
        expected_output="A comprehensive report"
    )
    
    subtasks = await decomposer.decompose_task(
        task=task,
        available_workers=sample_workers,
    )
    
    assert len(subtasks) > 0
    assert all(isinstance(st, Task) for st in subtasks)
    assert all(st.id.startswith(task.id) for st in subtasks)


@pytest.mark.asyncio
async def test_decompose_task_structured_output(task_agent, mock_llm_provider, sample_workers):
    """测试结构化输出格式"""
    decomposer = TaskDecomposer(
        task_agent=task_agent,
        llm_provider=mock_llm_provider,
    )
    
    # Mock executor.run 返回 XML 格式的子任务
    decomposer.executor.run = Mock(return_value={
        "success": True,
        "result": "<tasks><task>Subtask 1</task><task>Subtask 2</task></tasks>"
    })
    
    task = Task(
        description="Complex task",
        expected_output="Result"
    )
    
    result = await decomposer.decompose_task_structured(
        task=task,
        available_workers=sample_workers,
    )
    
    assert isinstance(result, TaskDecompositionResult)
    assert len(result.subtasks) > 0
    assert isinstance(result.reasoning, str)
    assert isinstance(result.can_parallelize, bool)


def test_subtask_definition_model():
    """测试 SubtaskDefinition Pydantic 模型"""
    from agenticx.collaboration.workforce.task_decomposer import SubtaskDefinition
    
    subtask = SubtaskDefinition(
        description="Research AI trends",
        expected_output="A summary report",
        dependencies=[],
        priority=1,
    )
    
    assert subtask.description == "Research AI trends"
    assert subtask.expected_output == "A summary report"
    assert subtask.dependencies == []
    assert subtask.priority == 1


def test_task_decomposition_result_model():
    """测试 TaskDecompositionResult Pydantic 模型"""
    from agenticx.collaboration.workforce.task_decomposer import (
        TaskDecompositionResult,
        SubtaskDefinition,
    )
    
    subtasks = [
        SubtaskDefinition(
            description="Task 1",
            expected_output="Output 1",
        ),
        SubtaskDefinition(
            description="Task 2",
            expected_output="Output 2",
            dependencies=["Task 1"],
        ),
    ]
    
    result = TaskDecompositionResult(
        subtasks=subtasks,
        reasoning="Test decomposition",
        can_parallelize=False,  # 因为有依赖关系
    )
    
    assert len(result.subtasks) == 2
    assert result.reasoning == "Test decomposition"
    assert result.can_parallelize is False
