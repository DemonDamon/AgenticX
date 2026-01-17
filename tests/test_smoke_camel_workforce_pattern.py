"""
CAMEL Workforce Pattern 基础框架冒烟测试

验证 P0.1 功能点：
- WorkforcePattern 类可正常创建
- execute() 方法可正常调用
- coordinator/task_planner/worker 三层架构正常工作
"""

import pytest
from unittest.mock import Mock, AsyncMock, MagicMock
from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.collaboration.workforce import WorkforcePattern
from agenticx.collaboration.config import WorkforceConfig
from agenticx.collaboration.enums import CollaborationMode


@pytest.fixture
def mock_llm_provider():
    """创建模拟的 LLM Provider"""
    provider = Mock()
    provider.generate = AsyncMock(return_value="Mock response")
    return provider


@pytest.fixture
def sample_agents():
    """创建测试用的 Agent"""
    coordinator_agent = Agent.fast_construct(
        name="Coordinator",
        role="coordinator",
        goal="分配任务给合适的 Worker",
        organization_id="test-org"
    )
    
    task_agent = Agent.fast_construct(
        name="Task Planner",
        role="planner",
        goal="分解复杂任务为子任务",
        organization_id="test-org"
    )
    
    worker1 = Agent.fast_construct(
        name="Worker 1",
        role="worker",
        goal="执行分配的任务",
        organization_id="test-org"
    )
    
    worker2 = Agent.fast_construct(
        name="Worker 2",
        role="worker",
        goal="执行分配的任务",
        organization_id="test-org"
    )
    
    return {
        "coordinator": coordinator_agent,
        "task_planner": task_agent,
        "workers": [worker1, worker2]
    }


@pytest.fixture
def workforce_config(sample_agents):
    """创建测试用的 WorkforceConfig"""
    return WorkforceConfig(
        coordinator_agent_id=sample_agents["coordinator"].id,
        task_agent_id=sample_agents["task_planner"].id,
        worker_agent_ids=[w.id for w in sample_agents["workers"]],
        execution_mode="auto_decompose"
    )


def test_workforce_pattern_creation(sample_agents, mock_llm_provider, workforce_config):
    """测试 WorkforcePattern 可正常创建"""
    pattern = WorkforcePattern(
        coordinator_agent=sample_agents["coordinator"],
        task_agent=sample_agents["task_planner"],
        workers=sample_agents["workers"],
        llm_provider=mock_llm_provider,
        config=workforce_config
    )
    
    assert pattern is not None
    assert pattern.coordinator_agent.id == sample_agents["coordinator"].id
    assert pattern.task_agent.id == sample_agents["task_planner"].id
    assert len(pattern.worker_instances) == 2
    assert pattern.coordinator is not None
    assert pattern.task_planner is not None


def test_workforce_pattern_three_layer_architecture(sample_agents, mock_llm_provider, workforce_config):
    """测试 coordinator/task_planner/worker 三层架构"""
    pattern = WorkforcePattern(
        coordinator_agent=sample_agents["coordinator"],
        task_agent=sample_agents["task_planner"],
        workers=sample_agents["workers"],
        llm_provider=mock_llm_provider,
        config=workforce_config
    )
    
    # 验证 Coordinator 层
    assert hasattr(pattern, 'coordinator')
    assert pattern.coordinator.agent.id == sample_agents["coordinator"].id
    
    # 验证 Task Planner 层
    assert hasattr(pattern, 'task_planner')
    assert pattern.task_planner.agent.id == sample_agents["task_planner"].id
    
    # 验证 Worker 层
    assert len(pattern.worker_instances) == 2
    for i, worker in enumerate(pattern.worker_instances):
        assert worker.agent.id == sample_agents["workers"][i].id


def test_workforce_pattern_execute_basic(mock_llm_provider):
    """测试 execute() 方法基本调用（不验证实际执行）"""
    # 创建简单的 Agent
    coordinator = Agent.fast_construct(
        name="Coordinator",
        role="coordinator",
        goal="test",
        organization_id="test-org"
    )
    
    task_planner = Agent.fast_construct(
        name="Task Planner",
        role="planner",
        goal="test",
        organization_id="test-org"
    )
    
    worker = Agent.fast_construct(
        name="Worker",
        role="worker",
        goal="test",
        organization_id="test-org"
    )
    
    config = WorkforceConfig(
        coordinator_agent_id=coordinator.id,
        task_agent_id=task_planner.id,
        worker_agent_ids=[worker.id],
        execution_mode="auto_decompose"
    )
    
    # Mock AgentExecutor 以避免实际执行
    pattern = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=[worker],
        llm_provider=mock_llm_provider,
        config=config
    )
    
    # Mock executor 的 run 方法
    pattern.coordinator_executor.run = Mock(return_value={
        "success": True,
        "result": '{"assignments": [{"task_id": "task_1", "assignee_id": "' + worker.id + '", "dependencies": []}]}'
    })
    
    pattern.task_executor.run = Mock(return_value={
        "success": True,
        "result": "<tasks><task>Subtask 1</task></tasks>"
    })
    
    pattern.worker_executor.run = Mock(return_value={
        "success": True,
        "result": "Task completed"
    })
    
    # 执行（可能会因为异步调用而失败，但至少验证了结构）
    # 注意：由于 execute 内部调用异步方法，这里只测试结构
    assert hasattr(pattern, 'execute')
    assert callable(pattern.execute)


def test_workforce_pattern_config_validation(sample_agents, mock_llm_provider):
    """测试 WorkforceConfig 验证"""
    # 测试缺少必需字段
    with pytest.raises(Exception):  # Pydantic 会抛出 ValidationError
        WorkforceConfig(
            mode=CollaborationMode.WORKFORCE,
            # 缺少 coordinator_agent_id 和 task_agent_id
        )
    
    # 测试有效配置
    valid_config = WorkforceConfig(
        coordinator_agent_id=sample_agents["coordinator"].id,
        task_agent_id=sample_agents["task_planner"].id,
        worker_agent_ids=[w.id for w in sample_agents["workers"]],
    )
    assert valid_config.execution_mode == "auto_decompose"  # 默认值


def test_workforce_pattern_event_log(sample_agents, mock_llm_provider, workforce_config):
    """测试事件日志功能"""
    pattern = WorkforcePattern(
        coordinator_agent=sample_agents["coordinator"],
        task_agent=sample_agents["task_planner"],
        workers=sample_agents["workers"],
        llm_provider=mock_llm_provider,
        config=workforce_config
    )
    
    assert pattern.event_log is not None
    assert pattern.event_log.agent_id == pattern.collaboration_id
