"""
Smoke tests for VeADK Agent Builder (Declarative Construction) feature.

Tests declarative agent and workflow construction from configurations.
"""

import pytest
import tempfile
import json
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

from agenticx.core.agent_builder import (
    AgentBuilder, AgentBuilderConfig, create_agent_from_config
)


class TestAgentBuilderConfig:
    """Test suite for AgentBuilderConfig."""
    
    def test_minimal_config(self):
        """Test creating minimal configuration."""
        config = AgentBuilderConfig(
            type="Agent",
            name="TestAgent"
        )
        
        assert config.type == "Agent"
        assert config.name == "TestAgent"
        assert config.role is None
        assert config.goal is None
    
    def test_full_config(self):
        """Test creating full configuration."""
        config = AgentBuilderConfig(
            type="Agent",
            name="TestAgent",
            description="A test agent",
            role="Assistant",
            goal="Help users",
            backstory="Created for testing",
            llm_config_name="gpt-4",
            tool_names=["search", "calculator"]
        )
        
        assert config.name == "TestAgent"
        assert config.role == "Assistant"
        assert config.goal == "Help users"
        assert config.tool_names == ["search", "calculator"]
    
    def test_config_with_metadata(self):
        """Test config with metadata."""
        config = AgentBuilderConfig(
            type="Agent",
            name="TestAgent",
            metadata={"version": "1.0", "tags": ["test"]}
        )
        
        assert config.metadata["version"] == "1.0"
        assert "test" in config.metadata["tags"]


class TestAgentBuilder:
    """Test suite for AgentBuilder."""
    
    @pytest.fixture
    def builder(self):
        """Create an agent builder instance."""
        return AgentBuilder()
    
    def test_builder_initialization(self, builder):
        """Test agent builder initialization."""
        assert builder is not None
        assert len(AgentBuilder.AGENT_TYPES) > 0
    
    def test_agent_types_registered(self, builder):
        """Test that default agent types are registered."""
        assert "Agent" in AgentBuilder.AGENT_TYPES
        assert "WorkflowEngine" in AgentBuilder.AGENT_TYPES
    
    def test_register_custom_agent_type(self, builder):
        """Test registering custom agent type."""
        class CustomAgent:
            def __init__(self, name, **kwargs):
                self.name = name
        
        AgentBuilder.register_agent_type("CustomAgent", CustomAgent)
        
        assert "CustomAgent" in AgentBuilder.AGENT_TYPES
        assert AgentBuilder.AGENT_TYPES["CustomAgent"] is CustomAgent
    
    def test_build_agent_config_validation(self, builder):
        """Test that configuration is validated properly."""
        # Missing required 'name' field should fail
        config = {
            "type": "Agent",
            "role": "Assistant"
        }
        
        with pytest.raises(ValueError):
            builder.build_from_dict(config)
    
    def test_build_agent_unknown_type(self, builder):
        """Test that building fails with unknown agent type."""
        config = {
            "type": "UnknownAgent",
            "name": "UnknownAgent",
            "organization_id": "test_org"
        }
        
        with pytest.raises(ValueError, match="Unknown agent type"):
            builder.build_from_dict(config)
    
    def test_build_agent_empty_config(self, builder):
        """Test that building fails with empty config."""
        with pytest.raises(ValueError):
            builder.build_from_dict({})
    
    def test_load_config_from_json(self, builder):
        """Test loading config from JSON file without building."""
        config_dict = {
            "type": "Agent",
            "name": "ConfigAgent",
            "organization_id": "test_org"
        }
        
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(config_dict, f)
            f.flush()
            temp_path = f.name
        
        try:
            config = AgentBuilder.load_config_from_file(temp_path)
            assert config["type"] == "Agent"
            assert config["name"] == "ConfigAgent"
        finally:
            Path(temp_path).unlink()
    
    def test_import_tool_invalid_format(self, builder):
        """Test that invalid tool path format raises error."""
        with pytest.raises(ImportError, match="Invalid tool path"):
            AgentBuilder._import_tool("invalid_path_without_dot")
    
    def test_import_tool_nonexistent_module(self, builder):
        """Test that importing nonexistent module raises error."""
        with pytest.raises(ImportError):
            AgentBuilder._import_tool("nonexistent.module.tool")


class TestAgentBuilderIntegration:
    """Integration tests for agent builder."""
    
    def test_agent_builder_config_dict_conversion(self):
        """Test converting config dict to AgentBuilderConfig."""
        builder = AgentBuilder()
        
        config_dict = {
            "type": "Agent",
            "name": "TestAgent",
            "role": "Role1",
            "goal": "Goal1",
            "organization_id": "test_org",
            "tool_names": ["tool1", "tool2"]
        }
        
        # This should successfully create a config (before attempting to build)
        config = AgentBuilderConfig(**config_dict)
        
        assert config.name == "TestAgent"
        assert config.role == "Role1"
        assert len(config.tool_names) == 2
    
    def test_agent_builder_multiple_configs(self):
        """Test working with multiple agent configurations."""
        builder = AgentBuilder()
        
        config1 = AgentBuilderConfig(
            type="Agent",
            name="Agent1",
            role="Role1",
            organization_id="test_org"
        )
        
        config2 = AgentBuilderConfig(
            type="Agent",
            name="Agent2",
            role="Role2",
            organization_id="test_org"
        )
        
        assert config1.name == "Agent1"
        assert config2.name == "Agent2"
        assert config1.name != config2.name
    
    def test_agent_builder_workflow_config(self):
        """Test workflow configuration creation."""
        builder = AgentBuilder()
        
        config = AgentBuilderConfig(
            type="WorkflowEngine",
            name="TestWorkflow",
            description="A test workflow",
            organization_id="test_org",
            sub_agents=[
                {
                    "type": "Agent",
                    "name": "SubAgent1",
                    "organization_id": "test_org"
                }
            ]
        )
        
        assert config.type == "WorkflowEngine"
        assert config.name == "TestWorkflow"
        assert len(config.sub_agents) == 1


class TestAgentBuilderAPIs:
    """Test public APIs of AgentBuilder."""
    
    def test_create_agent_from_config_function(self):
        """Test the convenience function exists and is callable."""
        from agenticx.core.agent_builder import create_agent_from_config
        assert callable(create_agent_from_config)
    
    def test_agent_builder_registry(self):
        """Test agent types registry."""
        assert "Agent" in AgentBuilder.AGENT_TYPES
        assert "WorkflowEngine" in AgentBuilder.AGENT_TYPES
        assert len(AgentBuilder.AGENT_TYPES) >= 2
    
    def test_agent_builder_register_type(self):
        """Test registering custom types."""
        class MockAgent:
            def __init__(self, name, **kwargs):
                self.name = name
        
        # Store original count
        original_count = len(AgentBuilder.AGENT_TYPES)
        
        # Register new type
        AgentBuilder.register_agent_type("MockAgent", MockAgent)
        
        # Should have one more type
        assert len(AgentBuilder.AGENT_TYPES) == original_count + 1
        assert AgentBuilder.AGENT_TYPES["MockAgent"] is MockAgent


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
