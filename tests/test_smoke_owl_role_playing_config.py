"""
OWL 角色扮演模式配置冒烟测试

验证 P0.1 功能点：
- CollaborationMode.ROLE_PLAYING 枚举存在
- RolePlayingConfig 配置类可正常创建和使用
"""

import pytest
from agenticx.collaboration.enums import CollaborationMode
from agenticx.collaboration.config import RolePlayingConfig, create_pattern_config


def test_role_playing_enum_exists():
    """测试 ROLE_PLAYING 枚举值存在"""
    assert CollaborationMode.ROLE_PLAYING is not None
    assert CollaborationMode.ROLE_PLAYING.value == "role_playing"
    assert CollaborationMode.ROLE_PLAYING in CollaborationMode


def test_role_playing_config_creation():
    """测试 RolePlayingConfig 配置类可正常创建"""
    config = RolePlayingConfig(
        user_agent_id="user_001",
        assistant_agent_id="assistant_001",
        round_limit=10
    )
    
    assert config.mode == CollaborationMode.ROLE_PLAYING
    assert config.user_agent_id == "user_001"
    assert config.assistant_agent_id == "assistant_001"
    assert config.round_limit == 10
    assert config.enable_context_injection is True  # 默认值
    assert config.enable_task_done_detection is True  # 默认值


def test_role_playing_config_with_custom_values():
    """测试 RolePlayingConfig 支持自定义值"""
    config = RolePlayingConfig(
        user_agent_id="user_002",
        assistant_agent_id="assistant_002",
        round_limit=20,
        enable_context_injection=False,
        enable_task_done_detection=False,
        max_iterations=5,
        timeout=600.0
    )
    
    assert config.round_limit == 20
    assert config.enable_context_injection is False
    assert config.enable_task_done_detection is False
    assert config.max_iterations == 5
    assert config.timeout == 600.0


def test_create_pattern_config_role_playing():
    """测试 create_pattern_config 函数支持 ROLE_PLAYING 模式"""
    config = create_pattern_config(
        CollaborationMode.ROLE_PLAYING,
        user_agent_id="user_003",
        assistant_agent_id="assistant_003",
        round_limit=15
    )
    
    assert isinstance(config, RolePlayingConfig)
    assert config.mode == CollaborationMode.ROLE_PLAYING
    assert config.user_agent_id == "user_003"
    assert config.assistant_agent_id == "assistant_003"


def test_role_playing_config_validation():
    """测试 RolePlayingConfig 参数验证"""
    # 缺少必需参数应该抛出异常
    with pytest.raises(Exception):  # Pydantic 会抛出 ValidationError
        RolePlayingConfig(
            user_agent_id="user_004"
            # 缺少 assistant_agent_id
        )
    
    with pytest.raises(Exception):
        RolePlayingConfig(
            assistant_agent_id="assistant_004"
            # 缺少 user_agent_id
        )


def test_role_playing_config_inheritance():
    """测试 RolePlayingConfig 继承自 CollaborationConfig"""
    config = RolePlayingConfig(
        user_agent_id="user_005",
        assistant_agent_id="assistant_005"
    )
    
    # 验证继承的字段
    assert hasattr(config, 'max_iterations')
    assert hasattr(config, 'timeout')
    assert hasattr(config, 'enable_memory_sharing')
    assert hasattr(config, 'enable_context_sharing')
    
    # 验证继承的默认值
    assert config.max_iterations == 5  # 来自 CollaborationConfig
    assert config.timeout == 300.0  # 来自 CollaborationConfig
