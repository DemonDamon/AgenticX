"""
Agent Builder: Declarative Agent Construction

Enables declarative definition and construction of agents from YAML/dict configurations.

This module implements the agent building mechanism from VeADK, allowing agents and
multi-agent systems to be defined in configuration files without code, supporting:
1. Nested agent/workflow definitions
2. Dynamic tool registration
3. Flexible LLM configuration
4. Agent type registry for extensibility
"""

from typing import Dict, List, Any, Optional, Type, Union
from pathlib import Path
import json
import importlib
from abc import ABC, abstractmethod

from pydantic import BaseModel, Field

from agenticx.core.agent import Agent

# Import required for forward references
try:
    from agenticx.core.guiderails import GuideRails
except Exception:
    pass


class AgentBuilderConfig(BaseModel):
    """Configuration for building an agent."""
    type: str = Field(description="Type of agent to build (e.g., 'Agent', 'WorkflowEngine')")
    name: str = Field(description="Name of the agent")
    description: Optional[str] = Field(default=None, description="Description")
    
    # Agent-specific fields
    role: Optional[str] = Field(default=None, description="Role of the agent")
    goal: Optional[str] = Field(default=None, description="Goal of the agent")
    backstory: Optional[str] = Field(default=None, description="Backstory")
    
    # LLM configuration
    llm_config_name: Optional[str] = Field(default=None, description="LLM config reference")
    model: Optional[str] = Field(default=None, description="Model name")
    
    # Tools
    tools: Optional[List[Union[str, Dict[str, Any]]]] = Field(default=None, description="Tools available to agent")
    tool_names: Optional[List[str]] = Field(default=None, description="Tool names")
    
    # Sub-agents (for multi-agent systems)
    sub_agents: Optional[List[Dict[str, Any]]] = Field(default=None, description="Sub-agents for workflows")
    
    # Additional metadata
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")
    
    class Config:
        """Pydantic config."""
        extra = "allow"  # Allow extra fields for flexibility


class AgentBuilder:
    """
    Declarative agent builder.
    
    Builds agents from configuration dictionaries or YAML files.
    Supports nested agent hierarchies and dynamic tool registration.
    """
    
    # Registry of supported agent types and their corresponding classes
    AGENT_TYPES: Dict[str, Type] = {}
    
    def __init__(self):
        """Initialize agent builder."""
        # Register default agent types
        if not self.AGENT_TYPES:
            self._register_default_types()
    
    @classmethod
    def _register_default_types(cls):
        """Register default agent types."""
        from agenticx.core import Agent, WorkflowEngine
        
        cls.AGENT_TYPES["Agent"] = Agent
        cls.AGENT_TYPES["WorkflowEngine"] = WorkflowEngine
    
    @classmethod
    def register_agent_type(cls, type_name: str, agent_class: Type):
        """
        Register a custom agent type.
        
        Args:
            type_name: Name of the agent type
            agent_class: The agent class
        """
        cls.AGENT_TYPES[type_name] = agent_class
    
    def build(self, config_path: Union[str, Path]) -> Any:
        """
        Build agent from configuration file.
        
        Args:
            config_path: Path to YAML or JSON config file
            
        Returns:
            Built agent instance
        """
        config_path = Path(config_path)
        
        if config_path.suffix in [".yaml", ".yml"]:
            import yaml
            with open(config_path, "r", encoding="utf-8") as f:
                config_dict = yaml.safe_load(f)
        elif config_path.suffix == ".json":
            with open(config_path, "r", encoding="utf-8") as f:
                config_dict = json.load(f)
        else:
            raise ValueError(f"Unsupported config file format: {config_path.suffix}")
        
        return self.build_from_dict(config_dict)
    
    def build_from_dict(self, config: Dict[str, Any]) -> Any:
        """
        Build agent from configuration dictionary.
        
        Args:
            config: Agent configuration dictionary
            
        Returns:
            Built agent instance
            
        Raises:
            ValueError: If configuration is invalid
            KeyError: If required fields are missing
        """
        if not config:
            raise ValueError("Configuration dictionary is empty")
        
        # Parse configuration
        if isinstance(config, dict):
            agent_config = AgentBuilderConfig(**config)
        else:
            raise ValueError("Configuration must be a dictionary")
        
        # Get agent class
        agent_type = agent_config.type
        if agent_type not in self.AGENT_TYPES:
            raise ValueError(f"Unknown agent type: {agent_type}. Registered types: {list(self.AGENT_TYPES.keys())}")
        
        agent_class = self.AGENT_TYPES[agent_type]
        
        # Build agent based on type
        if agent_type == "Agent":
            return self._build_agent(agent_config, agent_class)
        elif agent_type == "WorkflowEngine":
            return self._build_workflow(agent_config, agent_class)
        else:
            # Try generic building for custom types
            return self._build_generic_agent(agent_config, agent_class)
    
    def _build_agent(self, config: AgentBuilderConfig, agent_class: Type) -> Agent:
        """
        Build a standard Agent.
        
        Args:
            config: Agent configuration
            agent_class: Agent class
            
        Returns:
            Built Agent instance
        """
        # Rebuild model to resolve forward references
        try:
            agent_class.model_rebuild()
        except Exception:
            pass  # Ignore if already built
        
        # Prepare initialization arguments
        init_args = {
            "name": config.name,
            "organization_id": config.metadata.get("organization_id", "default") if config.metadata else "default",
        }
        
        # Add optional fields
        if config.role:
            init_args["role"] = config.role
        if config.goal:
            init_args["goal"] = config.goal
        if config.backstory:
            init_args["backstory"] = config.backstory
        if config.description:
            init_args["description"] = config.description
        if config.llm_config_name:
            init_args["llm_config_name"] = config.llm_config_name
        
        # Handle tools
        tool_names = config.tool_names or []
        if config.tools:
            for tool in config.tools:
                if isinstance(tool, str):
                    tool_names.append(tool)
                elif isinstance(tool, dict) and "name" in tool:
                    tool_names.append(tool["name"])
        
        if tool_names:
            init_args["tool_names"] = tool_names
        
        # Add metadata
        if config.metadata:
            init_args["metadata"] = config.metadata
        
        return agent_class(**init_args)
    
    def _build_workflow(self, config: AgentBuilderConfig, workflow_class: Type) -> Any:
        """
        Build a WorkflowEngine.
        
        Args:
            config: Workflow configuration
            workflow_class: WorkflowEngine class
            
        Returns:
            Built WorkflowEngine instance
        """
        # Rebuild model to resolve forward references
        try:
            workflow_class.model_rebuild()
        except Exception:
            pass  # Ignore if already built
        
        # Prepare initialization arguments
        init_args = {
            "name": config.name,
            "organization_id": config.metadata.get("organization_id", "default") if config.metadata else "default",
        }
        
        if config.description:
            init_args["description"] = config.description
        
        # Build sub-agents if any
        if config.sub_agents:
            sub_agents = []
            for sub_agent_config in config.sub_agents:
                sub_agent = self.build_from_dict(sub_agent_config)
                sub_agents.append(sub_agent)
            init_args["sub_agents"] = sub_agents
        
        # Add metadata
        if config.metadata:
            init_args["metadata"] = config.metadata
        
        return workflow_class(**init_args)
    
    def _build_generic_agent(self, config: AgentBuilderConfig, agent_class: Type) -> Any:
        """
        Build a custom agent type (generic fallback).
        
        Args:
            config: Agent configuration
            agent_class: Agent class
            
        Returns:
            Built agent instance
        """
        # Extract fields that might match agent class constructor
        init_args = {
            "name": config.name,
        }
        
        if config.description:
            init_args["description"] = config.description
        if config.role:
            init_args["role"] = config.role
        if config.goal:
            init_args["goal"] = config.goal
        
        return agent_class(**init_args)
    
    @staticmethod
    def _import_tool(tool_path: str) -> Any:
        """
        Dynamically import a tool from module path.
        
        Args:
            tool_path: Tool path in format "module.function" or "module.Class"
            
        Returns:
            The imported tool
            
        Raises:
            ImportError: If tool cannot be imported
        """
        parts = tool_path.rsplit(".", 1)
        if len(parts) != 2:
            raise ImportError(f"Invalid tool path: {tool_path}. Use 'module.function' format.")
        
        module_name, obj_name = parts
        
        try:
            module = importlib.import_module(module_name)
            return getattr(module, obj_name)
        except (ImportError, AttributeError) as e:
            raise ImportError(f"Failed to import {tool_path}: {e}")
    
    @staticmethod
    def load_config_from_file(config_path: Union[str, Path]) -> Dict[str, Any]:
        """
        Load configuration from file without building.
        
        Args:
            config_path: Path to config file
            
        Returns:
            Configuration dictionary
        """
        config_path = Path(config_path)
        
        if config_path.suffix in [".yaml", ".yml"]:
            import yaml
            with open(config_path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)
        elif config_path.suffix == ".json":
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        else:
            raise ValueError(f"Unsupported config file format: {config_path.suffix}")


def create_agent_from_config(config: Union[str, Path, Dict[str, Any]]) -> Any:
    """
    Convenience function to create an agent from configuration.
    
    Args:
        config: Config file path or config dictionary
        
    Returns:
        Built agent instance
    """
    builder = AgentBuilder()
    
    if isinstance(config, (str, Path)):
        return builder.build(config)
    else:
        return builder.build_from_dict(config)
