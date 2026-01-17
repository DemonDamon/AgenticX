"""
CAMEL RecoveryStrategies 恢复策略冒烟测试

验证 P0.5 功能点：
- RecoveryStrategyExecutor 类可正常创建
- 5 种恢复策略（RETRY, REASSIGN, DECOMPOSE, REPLAN, CREATE_WORKER）可正常应用
- 策略应用后的任务状态正确性
"""

import pytest
from unittest.mock import Mock, AsyncMock
from agenticx.core.task import Task
from agenticx.collaboration.workforce import (
    RecoveryStrategyExecutor,
    RecoveryStrategy,
)
from agenticx.collaboration.workforce.worker import SingleAgentWorker


@pytest.fixture
def sample_task():
    """创建测试用的任务"""
    return Task(
        id="task_1",
        description="Test task",
        expected_output="Result"
    )


@pytest.fixture
def sample_workers():
    """创建测试用的 Worker 列表"""
    worker1_agent = Mock()
    worker1_agent.id = "worker_1"
    worker1_agent.name = "Worker 1"
    worker1_agent.role = "worker"
    
    worker2_agent = Mock()
    worker2_agent.id = "worker_2"
    worker2_agent.name = "Worker 2"
    worker2_agent.role = "worker"
    
    executor = Mock()
    return [
        SingleAgentWorker(agent=worker1_agent, executor=executor),
        SingleAgentWorker(agent=worker2_agent, executor=executor),
    ]


def test_recovery_strategy_executor_creation():
    """测试 RecoveryStrategyExecutor 可正常创建"""
    executor = RecoveryStrategyExecutor()
    
    assert executor is not None
    assert executor.task_decomposer is None
    assert executor.worker_factory is None


def test_recovery_strategy_executor_with_dependencies():
    """测试 RecoveryStrategyExecutor 可以接受依赖"""
    task_decomposer = Mock()
    worker_factory = Mock()
    
    executor = RecoveryStrategyExecutor(
        task_decomposer=task_decomposer,
        worker_factory=worker_factory,
    )
    
    assert executor.task_decomposer is task_decomposer
    assert executor.worker_factory is worker_factory


@pytest.mark.asyncio
async def test_retry_strategy(sample_task, sample_workers):
    """测试 RETRY 策略"""
    executor = RecoveryStrategyExecutor()
    
    failed_worker = sample_workers[0]
    result = await executor.apply_strategy(
        strategy=RecoveryStrategy.RETRY,
        task=sample_task,
        failed_worker=failed_worker,
    )
    
    assert result["strategy"] == "retry"
    assert result["action"] == "retry"
    assert result["task"].id == sample_task.id
    assert result["worker"] == failed_worker
    assert result["modified_task"] is None


@pytest.mark.asyncio
async def test_reassign_strategy(sample_task, sample_workers):
    """测试 REASSIGN 策略"""
    executor = RecoveryStrategyExecutor()
    
    failed_worker = sample_workers[0]
    result = await executor.apply_strategy(
        strategy=RecoveryStrategy.REASSIGN,
        task=sample_task,
        failed_worker=failed_worker,
        available_workers=sample_workers,
    )
    
    assert result["strategy"] == "reassign"
    assert result["action"] == "reassign"
    assert result["task"].id == sample_task.id
    assert result["old_worker"] == failed_worker
    assert result["new_worker"].id != failed_worker.id
    assert result["modified_task"] is None


@pytest.mark.asyncio
async def test_decompose_strategy(sample_task, sample_workers):
    """测试 DECOMPOSE 策略"""
    task_decomposer = Mock()
    task_decomposer.decompose_task = AsyncMock(return_value=[
        Task(id="subtask_1", description="Subtask 1", expected_output="Result 1"),
        Task(id="subtask_2", description="Subtask 2", expected_output="Result 2"),
    ])
    
    executor = RecoveryStrategyExecutor(
        task_decomposer=task_decomposer,
    )
    
    result = await executor.apply_strategy(
        strategy=RecoveryStrategy.DECOMPOSE,
        task=sample_task,
        available_workers=sample_workers,
    )
    
    assert result["strategy"] == "decompose"
    assert result["action"] == "decompose"
    assert result["original_task"].id == sample_task.id
    assert len(result["subtasks"]) == 2


@pytest.mark.asyncio
async def test_replan_strategy(sample_task):
    """测试 REPLAN 策略"""
    executor = RecoveryStrategyExecutor()
    
    failure_context = {
        "modified_task_content": "Revised task description with clearer instructions"
    }
    
    result = await executor.apply_strategy(
        strategy=RecoveryStrategy.REPLAN,
        task=sample_task,
        failure_context=failure_context,
    )
    
    assert result["strategy"] == "replan"
    assert result["action"] == "replan"
    assert result["original_task"].id == sample_task.id
    assert result["modified_task"] is not None
    assert result["modified_task"].id.endswith("_replanned")


@pytest.mark.asyncio
async def test_create_worker_strategy(sample_task, sample_workers):
    """测试 CREATE_WORKER 策略"""
    worker_factory = Mock()
    new_worker = Mock()
    new_worker.id = "worker_new"
    worker_factory.create_worker_for_task = AsyncMock(return_value=new_worker)
    
    executor = RecoveryStrategyExecutor(
        worker_factory=worker_factory,
    )
    
    result = await executor.apply_strategy(
        strategy=RecoveryStrategy.CREATE_WORKER,
        task=sample_task,
        available_workers=sample_workers,
    )
    
    assert result["strategy"] == "create_worker"
    assert result["action"] == "create_worker"
    assert result["task"].id == sample_task.id
    assert result["new_worker"] == new_worker


@pytest.mark.asyncio
async def test_unknown_strategy(sample_task):
    """测试未知策略的错误处理"""
    executor = RecoveryStrategyExecutor()
    
    # 创建一个无效的策略值
    invalid_strategy = Mock()
    invalid_strategy.value = "invalid_strategy"
    
    with pytest.raises(ValueError, match="Unknown recovery strategy"):
        await executor.apply_strategy(
            strategy=invalid_strategy,
            task=sample_task,
        )
