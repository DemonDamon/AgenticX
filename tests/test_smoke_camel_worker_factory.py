"""
CAMEL WorkerFactory 动态 Worker 创建冒烟测试

验证 P1.1 功能点：
- WorkerFactory 类可正常创建
- create_worker_for_task() 方法可正常调用
- Worker 配置（工具、系统 Prompt）正确性
"""

import pytest
from unittest.mock import Mock, AsyncMock
from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.collaboration.workforce import WorkerFactory
from agenticx.collaboration.workforce.worker import SingleAgentWorker
from agenticx.core.discovery import DiscoveryBus


@pytest.fixture
def coordinator_agent():
    """创建测试用的 Coordinator Agent"""
    return Agent.fast_construct(
        name="Coordinator",
        role="coordinator",
        goal="创建 Worker",
        organization_id="test-org"
    )


@pytest.fixture
def executor():
    """创建测试用的 AgentExecutor"""
    executor = Mock()
    executor.run = Mock(return_value={
        "success": True,
        "result": "Role: researcher\nSystem Message: You are a researcher\nDescription: Research worker"
    })
    return executor


@pytest.fixture
def discovery_bus():
    """创建测试用的 DiscoveryBus"""
    bus = Mock(spec=DiscoveryBus)
    bus.publish = AsyncMock()
    return bus


def test_worker_factory_creation(coordinator_agent, executor):
    """测试 WorkerFactory 可正常创建"""
    factory = WorkerFactory(
        coordinator_agent=coordinator_agent,
        executor=executor,
    )
    
    assert factory is not None
    assert factory.coordinator_agent.id == coordinator_agent.id
    assert factory.discovery_bus is None


def test_worker_factory_with_discovery_bus(coordinator_agent, executor, discovery_bus):
    """测试 WorkerFactory 可以接受 DiscoveryBus"""
    factory = WorkerFactory(
        coordinator_agent=coordinator_agent,
        executor=executor,
        discovery_bus=discovery_bus,
    )
    
    assert factory.discovery_bus is discovery_bus


@pytest.mark.asyncio
async def test_create_worker_for_task_basic(coordinator_agent, executor):
    """测试 create_worker_for_task() 基本功能"""
    factory = WorkerFactory(
        coordinator_agent=coordinator_agent,
        executor=executor,
        organization_id="test-org",
    )
    
    task = Task(
        description="Research AI trends",
        expected_output="A summary report"
    )
    
    existing_workers = []
    
    worker = await factory.create_worker_for_task(
        task=task,
        existing_workers=existing_workers,
    )
    
    assert isinstance(worker, SingleAgentWorker)
    assert worker.agent is not None
    assert worker.agent.organization_id == "test-org"
    assert worker.description is not None


@pytest.mark.asyncio
async def test_create_worker_with_existing_workers(coordinator_agent, executor):
    """测试创建 Worker 时考虑现有 Worker"""
    factory = WorkerFactory(
        coordinator_agent=coordinator_agent,
        executor=executor,
        organization_id="test-org",
    )
    
    # 创建现有 Worker
    existing_worker_agent = Agent.fast_construct(
        name="Existing Worker",
        role="worker",
        goal="Existing task",
        organization_id="test-org"
    )
    existing_worker = SingleAgentWorker(
        agent=existing_worker_agent,
        executor=executor,
    )
    
    task = Task(
        description="New specialized task",
        expected_output="Result"
    )
    
    worker = await factory.create_worker_for_task(
        task=task,
        existing_workers=[existing_worker],
    )
    
    assert isinstance(worker, SingleAgentWorker)
    assert worker.id != existing_worker.id


@pytest.mark.asyncio
async def test_create_worker_publishes_discovery(coordinator_agent, executor, discovery_bus):
    """测试创建 Worker 时发布发现事件"""
    factory = WorkerFactory(
        coordinator_agent=coordinator_agent,
        executor=executor,
        discovery_bus=discovery_bus,
        organization_id="test-org",
    )
    
    task = Task(
        description="Test task",
        expected_output="Result"
    )
    
    worker = await factory.create_worker_for_task(
        task=task,
        existing_workers=[],
    )
    
    # 验证发布了发现事件
    discovery_bus.publish.assert_called_once()
    call_args = discovery_bus.publish.call_args[0][0]
    assert call_args.type.value == "capability"
    assert worker.id in str(call_args.metadata.get("worker_id", ""))


def test_worker_config_parsing(coordinator_agent, executor):
    """测试 Worker 配置解析"""
    factory = WorkerFactory(
        coordinator_agent=coordinator_agent,
        executor=executor,
    )
    
    llm_output = """
    Role: data_analyst
    System Message: You are a data analyst
    Description: Analyzes data and generates insights
    """
    
    task = Task(
        description="Analyze data",
        expected_output="Insights"
    )
    
    config = factory._parse_worker_config(llm_output, task)
    
    assert "role" in config
    assert "description" in config
    assert "name" in config
    assert "goal" in config
