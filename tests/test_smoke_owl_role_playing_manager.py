"""
OWL 角色扮演模式 CollaborationManager 集成冒烟测试

验证 P0.4 功能点：
- CollaborationManager 支持创建 RolePlayingPattern
- create_collaboration() 方法可正常创建角色扮演模式
"""

import pytest
from agenticx.core.agent import Agent
from agenticx.collaboration.manager import CollaborationManager
from agenticx.collaboration.config import CollaborationManagerConfig, RolePlayingConfig
from agenticx.collaboration.enums import CollaborationMode
from agenticx.collaboration.role_playing import RolePlayingPattern


@pytest.fixture
def manager():
    """创建测试用的 CollaborationManager"""
    return CollaborationManager()


@pytest.fixture
def sample_agents():
    """创建测试用的 User Agent 和 Assistant Agent"""
    user_agent = Agent.fast_construct(
        name="User Agent",
        role="user",
        goal="分解任务并指导执行",
        organization_id="test-org"
    )
    
    assistant_agent = Agent.fast_construct(
        name="Assistant Agent",
        role="assistant",
        goal="执行任务并使用工具",
        organization_id="test-org"
    )
    
    return [user_agent, assistant_agent]


def test_create_role_playing_collaboration(manager, sample_agents):
    """测试通过 CollaborationManager 创建角色扮演模式"""
    collaboration = manager.create_collaboration(
        pattern=CollaborationMode.ROLE_PLAYING,
        agents=sample_agents,
        user_agent_id=sample_agents[0].id,
        assistant_agent_id=sample_agents[1].id,
        round_limit=10
    )
    
    assert collaboration is not None
    assert isinstance(collaboration, RolePlayingPattern)
    assert collaboration.user_agent.id == sample_agents[0].id
    assert collaboration.assistant_agent.id == sample_agents[1].id
    assert collaboration.config.round_limit == 10


def test_create_role_playing_with_config(manager, sample_agents):
    """测试使用 RolePlayingConfig 创建角色扮演模式"""
    config = RolePlayingConfig(
        user_agent_id=sample_agents[0].id,
        assistant_agent_id=sample_agents[1].id,
        round_limit=15,
        enable_context_injection=False
    )
    
    collaboration = manager.create_collaboration(
        pattern=CollaborationMode.ROLE_PLAYING,
        agents=sample_agents,
        config=config
    )
    
    assert collaboration is not None
    assert isinstance(collaboration, RolePlayingPattern)
    assert collaboration.config.round_limit == 15
    assert collaboration.config.enable_context_injection is False


def test_create_role_playing_wrong_agent_count(manager):
    """测试 Agent 数量不正确的情况"""
    single_agent = Agent.fast_construct(
        name="Single Agent",
        role="test",
        goal="test",
        organization_id="test-org"
    )
    
    with pytest.raises(ValueError, match="恰好2个智能体"):
        manager.create_collaboration(
            pattern=CollaborationMode.ROLE_PLAYING,
            agents=[single_agent]
        )


def test_create_role_playing_default_ids(manager, sample_agents):
    """测试使用默认 Agent ID（第一个是 user，第二个是 assistant）"""
    collaboration = manager.create_collaboration(
        pattern=CollaborationMode.ROLE_PLAYING,
        agents=sample_agents,
        round_limit=5
    )
    
    assert collaboration is not None
    assert collaboration.user_agent.id == sample_agents[0].id
    assert collaboration.assistant_agent.id == sample_agents[1].id


def test_manager_registers_collaboration(manager, sample_agents):
    """测试 Manager 正确注册协作"""
    collaboration = manager.create_collaboration(
        pattern=CollaborationMode.ROLE_PLAYING,
        agents=sample_agents,
        user_agent_id=sample_agents[0].id,
        assistant_agent_id=sample_agents[1].id
    )
    
    assert collaboration.collaboration_id in manager.active_collaborations
    assert len(manager.active_collaborations) == 1
    assert len(manager.collaboration_history) == 1


def test_manager_monitors_role_playing(manager, sample_agents):
    """测试 Manager 可以监控角色扮演模式"""
    collaboration = manager.create_collaboration(
        pattern=CollaborationMode.ROLE_PLAYING,
        agents=sample_agents,
        user_agent_id=sample_agents[0].id,
        assistant_agent_id=sample_agents[1].id
    )
    
    status = manager.monitor_collaboration(collaboration.collaboration_id)
    
    assert status["collaboration_id"] == collaboration.collaboration_id
    assert status["pattern"] == "role_playing"
    assert "status" in status
    assert "current_iteration" in status
