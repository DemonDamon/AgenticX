"""
CAMEL TaskAssigner 智能任务分配冒烟测试

验证 P0.3 功能点：
- TaskAssigner 类可正常创建
- assign_tasks() 方法可正常调用
- 优先使用 CollaborationIntelligence，回退到 LLM 驱动分配
- Worker 能力匹配、负载均衡
"""

import pytest
from unittest.mock import Mock, AsyncMock
from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.collaboration.workforce import TaskAssigner
from agenticx.collaboration.workforce.coordinator import CoordinatorAgent
from agenticx.collaboration.workforce.worker import SingleAgentWorker
from agenticx.collaboration.intelligence import CollaborationIntelligence


@pytest.fixture
def coordinator_agent():
    """创建测试用的 Coordinator Agent"""
    return Agent.fast_construct(
        name="Coordinator",
        role="coordinator",
        goal="分配任务",
        organization_id="test-org"
    )


@pytest.fixture
def coordinator(coordinator_agent):
    """创建测试用的 CoordinatorAgent"""
    executor = Mock()
    return CoordinatorAgent(agent=coordinator_agent, executor=executor)


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


@pytest.fixture
def sample_tasks():
    """创建测试用的任务列表"""
    return [
        Task(
            id="task_1",
            description="Research AI trends",
            expected_output="A summary report",
        ),
        Task(
            id="task_2",
            description="Generate code",
            expected_output="Python code",
        ),
    ]


def test_task_assigner_creation(coordinator_agent, coordinator):
    """测试 TaskAssigner 可正常创建"""
    assigner = TaskAssigner(
        coordinator_agent=coordinator_agent,
        coordinator=coordinator,
    )
    
    assert assigner is not None
    assert assigner.coordinator_agent.id == coordinator_agent.id
    assert assigner.collaboration_intelligence is None


def test_task_assigner_with_intelligence(coordinator_agent, coordinator):
    """测试 TaskAssigner 可以接受 CollaborationIntelligence"""
    intelligence = CollaborationIntelligence()
    assigner = TaskAssigner(
        coordinator_agent=coordinator_agent,
        coordinator=coordinator,
        collaboration_intelligence=intelligence,
        session_id="test-session",
    )
    
    assert assigner.collaboration_intelligence is not None
    assert assigner.session_id == "test-session"


@pytest.mark.asyncio
async def test_assign_tasks_with_llm_fallback(
    coordinator_agent, coordinator, sample_tasks, sample_workers
):
    """测试 LLM 驱动分配（回退方案）"""
    assigner = TaskAssigner(
        coordinator_agent=coordinator_agent,
        coordinator=coordinator,
    )
    
    # Mock coordinator.assign_tasks
    coordinator.assign_tasks = AsyncMock(return_value={
        "task_1": sample_workers[0].id,
        "task_2": sample_workers[1].id,
    })
    
    assignment_map = await assigner.assign_tasks(
        tasks=sample_tasks,
        workers=sample_workers,
    )
    
    assert len(assignment_map) == 2
    assert "task_1" in assignment_map
    assert "task_2" in assignment_map
    coordinator.assign_tasks.assert_called_once()


@pytest.mark.asyncio
async def test_assign_tasks_with_intelligence(
    coordinator_agent, coordinator, sample_tasks, sample_workers
):
    """测试使用 CollaborationIntelligence 分配"""
    intelligence = CollaborationIntelligence()
    
    # 创建协作会话
    from agenticx.collaboration.intelligence.models import (
        CollaborationContext,
        AgentProfile,
        AgentStatus,
        AgentCapability,
    )
    
    # 注册 Worker Agent
    for worker in sample_workers:
        capability = AgentCapability(
            name=worker.agent.role,
            level=5,
            domain="general",
            description=f"Worker capability: {worker.agent.role}",
        )
        agent_profile = AgentProfile(
            agent_id=worker.id,
            name=worker.agent.name,
            capabilities=[capability],
            current_status=AgentStatus.IDLE,
        )
        intelligence.register_agent(agent_profile)
    
    # 创建协作上下文
    context = CollaborationContext(
        session_id="test-session",
        participants=[w.id for w in sample_workers],
        current_phase="planning",
        objectives=["Complete test tasks"],
        shared_state={},
    )
    session_id = intelligence.create_collaboration_session(context)
    
    assigner = TaskAssigner(
        coordinator_agent=coordinator_agent,
        coordinator=coordinator,
        collaboration_intelligence=intelligence,
        session_id=session_id,
    )
    
    # Mock coordinator.assign_tasks（作为回退）
    coordinator.assign_tasks = AsyncMock(return_value={})
    
    assignment_map = await assigner.assign_tasks(
        tasks=sample_tasks,
        workers=sample_workers,
    )
    
    # 验证是否调用了 CollaborationIntelligence（即使分配失败也会回退）
    assert isinstance(assignment_map, dict)


@pytest.mark.asyncio
async def test_assign_tasks_intelligence_fallback(
    coordinator_agent, coordinator, sample_tasks, sample_workers
):
    """测试 CollaborationIntelligence 失败时回退到 LLM"""
    intelligence = Mock(spec=CollaborationIntelligence)
    intelligence.allocate_tasks = Mock(side_effect=Exception("Intelligence error"))
    
    assigner = TaskAssigner(
        coordinator_agent=coordinator_agent,
        coordinator=coordinator,
        collaboration_intelligence=intelligence,
        session_id="test-session",
    )
    
    # Mock coordinator.assign_tasks（回退方案）
    coordinator.assign_tasks = AsyncMock(return_value={
        "task_1": sample_workers[0].id,
        "task_2": sample_workers[1].id,
    })
    
    assignment_map = await assigner.assign_tasks(
        tasks=sample_tasks,
        workers=sample_workers,
    )
    
    # 应该回退到 LLM 分配
    assert len(assignment_map) == 2
    coordinator.assign_tasks.assert_called_once()
