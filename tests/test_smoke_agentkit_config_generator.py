#!/usr/bin/env python3
"""
Smoke tests for AgentKit Config Generator.

Tests the generation of agentkit.yaml configuration files.

Author: Damon Li
"""

import pytest
import yaml
from pathlib import Path


def test_generate_agentkit_yaml_local():
    """Test generating configuration for local strategy."""
    from agenticx.deploy.components.volcengine.config_generator import generate_agentkit_yaml
    
    config = generate_agentkit_yaml(
        agent_name="test-agent",
        strategy="local"
    )
    
    # Check structure
    assert "common" in config
    assert "launch_types" in config
    
    # Check common fields
    assert config["common"]["agent_name"] == "test-agent"
    assert config["common"]["launch_type"] == "local"
    
    # Check local-specific fields
    assert "local" in config["launch_types"]
    local_config = config["launch_types"]["local"]
    assert local_config["invoke_port"] == 8000
    assert local_config["image_tag"] == "latest"


def test_generate_agentkit_yaml_hybrid():
    """Test generating configuration for hybrid strategy."""
    from agenticx.deploy.components.volcengine.config_generator import generate_agentkit_yaml
    
    config = generate_agentkit_yaml(
        agent_name="test-agent",
        strategy="hybrid",
        region="cn-beijing"
    )
    
    # Check hybrid-specific fields
    assert "hybrid" in config["launch_types"]
    hybrid_config = config["launch_types"]["hybrid"]
    assert hybrid_config["region"] == "cn-beijing"
    assert hybrid_config["cr_namespace_name"] == "agenticx"
    assert hybrid_config["runtime_auth_type"] == "key_auth"


def test_generate_agentkit_yaml_cloud():
    """Test generating configuration for cloud strategy."""
    from agenticx.deploy.components.volcengine.config_generator import generate_agentkit_yaml
    
    config = generate_agentkit_yaml(
        agent_name="test-agent",
        strategy="cloud",
        region="cn-shanghai"
    )
    
    # Check cloud-specific fields
    assert "cloud" in config["launch_types"]
    cloud_config = config["launch_types"]["cloud"]
    assert cloud_config["region"] == "cn-shanghai"
    assert cloud_config["tos_bucket"] == "Auto"
    assert cloud_config["build_timeout"] == 3600


def test_generate_agentkit_yaml_with_runtime_envs():
    """Test generating configuration with runtime environment variables."""
    from agenticx.deploy.components.volcengine.config_generator import generate_agentkit_yaml
    
    runtime_envs = {
        "API_KEY": "test-key",
        "DEBUG": "true"
    }
    
    config = generate_agentkit_yaml(
        agent_name="test-agent",
        strategy="local",
        runtime_envs=runtime_envs
    )
    
    assert config["common"]["runtime_envs"] == runtime_envs


def test_generate_agentkit_yaml_empty_agent_name():
    """Test that empty agent_name raises ValueError."""
    from agenticx.deploy.components.volcengine.config_generator import generate_agentkit_yaml
    
    with pytest.raises(ValueError, match="agent_name cannot be empty"):
        generate_agentkit_yaml(agent_name="", strategy="local")
    
    with pytest.raises(ValueError, match="agent_name cannot be empty"):
        generate_agentkit_yaml(agent_name="   ", strategy="local")


def test_generate_agentkit_yaml_invalid_strategy():
    """Test that invalid strategy raises ValueError."""
    from agenticx.deploy.components.volcengine.config_generator import generate_agentkit_yaml
    
    with pytest.raises(ValueError, match="Invalid strategy"):
        generate_agentkit_yaml(agent_name="test-agent", strategy="invalid")


def test_save_agentkit_yaml(tmp_path):
    """Test saving configuration to YAML file."""
    from agenticx.deploy.components.volcengine.config_generator import (
        generate_agentkit_yaml,
        save_agentkit_yaml
    )
    
    config = generate_agentkit_yaml(
        agent_name="test-agent",
        strategy="hybrid"
    )
    
    output_path = tmp_path / "agentkit.yaml"
    result_path = save_agentkit_yaml(config, str(output_path))
    
    # Check file was created
    assert output_path.exists()
    assert result_path == output_path
    
    # Check content can be loaded
    with open(output_path, 'r') as f:
        loaded_config = yaml.safe_load(f)
    
    assert loaded_config["common"]["agent_name"] == "test-agent"
    assert loaded_config["common"]["launch_type"] == "hybrid"


def test_save_agentkit_yaml_creates_parent_dirs(tmp_path):
    """Test that save_agentkit_yaml creates parent directories."""
    from agenticx.deploy.components.volcengine.config_generator import (
        generate_agentkit_yaml,
        save_agentkit_yaml
    )
    
    config = generate_agentkit_yaml(
        agent_name="test-agent",
        strategy="local"
    )
    
    # Use nested path that doesn't exist
    output_path = tmp_path / "nested" / "dir" / "agentkit.yaml"
    result_path = save_agentkit_yaml(config, str(output_path))
    
    # Check file was created with parent dirs
    assert output_path.exists()
    assert output_path.parent.exists()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
