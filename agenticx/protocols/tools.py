"""
Tool integration for A2A protocol.

This module provides the A2ASkillTool class that wraps remote agent skills
as local tools, enabling seamless integration with the AgentExecutor.
"""

import asyncio
import logging
from typing import Dict, Any, Optional, Type
from uuid import uuid4

from pydantic import BaseModel, create_model

from ..tools.base import BaseTool
from .client import A2AClient, A2ATaskError, A2AConnectionError
from .models import AgentCard, Skill

logger = logging.getLogger(__name__)


class A2ASkillTool(BaseTool):
    """
    Wraps a remote agent skill as a local tool.
    
    This class implements the "A2A Skill as a Tool" design pattern,
    allowing remote agent capabilities to be invoked as if they were
    local tools, providing a unified interface for the AgentExecutor.
    """
    
    def __init__(
        self,
        client: A2AClient,
        skill: Skill,
        issuer_agent_id: str,
        polling_interval: float = 1.0,
        max_wait_time: float = 300.0
    ):
        """
        Initialize the A2A skill tool.
        
        Args:
            client: A2AClient for communicating with the remote agent
            skill: Skill definition from the remote agent
            issuer_agent_id: ID of the agent that will issue tasks
            polling_interval: Time between status checks in seconds
            max_wait_time: Maximum time to wait for task completion
        """
        # Generate dynamic name in format "{agent_name}/{skill_name}"
        agent_name = client.target_agent_card.name
        skill_name = skill.name
        tool_name = f"{agent_name}/{skill_name}"
        
        # Create dynamic Pydantic model from skill's parameters schema
        args_schema = self._create_args_schema_static(skill)
        
        # Initialize parent class
        super().__init__(
            name=tool_name,
            description=skill.description,
            args_schema=args_schema
        )
        
        self.client = client
        self.skill = skill
        self.issuer_agent_id = issuer_agent_id
        self.polling_interval = polling_interval
        self.max_wait_time = max_wait_time
    

    
    @staticmethod
    def _create_args_schema_static(skill: Skill) -> Optional[Type[BaseModel]]:
        """
        Create a Pydantic model from the skill's parameters schema.
        
        Args:
            skill: Skill definition
            
        Returns:
            Dynamically created Pydantic model class
        """
        if not skill.parameters_schema:
            return None
        
        try:
            # Extract properties from JSON schema
            properties = skill.parameters_schema.get('properties', {})
            required = skill.parameters_schema.get('required', [])
            
            # Convert JSON schema types to Python types
            field_definitions = {}
            for field_name, field_schema in properties.items():
                field_type = A2ASkillTool._json_schema_to_python_type_static(field_schema)
                default_value = ... if field_name in required else None
                field_definitions[field_name] = (field_type, default_value)
            
            # Create dynamic model
            model_name = f"{skill.name.title()}Args"
            return create_model(model_name, **field_definitions)
            
        except Exception as e:
            logger.warning(f"Failed to create args schema for skill {skill.name}: {e}")
            return None
    
    def _create_args_schema(self) -> Optional[Type[BaseModel]]:
        """Backward compatibility method."""
        return self._create_args_schema_static(self.skill)
    
    @staticmethod
    def _json_schema_to_python_type_static(schema: Dict[str, Any]) -> Type:
        """
        Convert JSON schema type to Python type.
        
        Args:
            schema: JSON schema field definition
            
        Returns:
            Corresponding Python type
        """
        schema_type = schema.get('type', 'string')
        
        type_mapping = {
            'string': str,
            'integer': int,
            'number': float,
            'boolean': bool,
            'array': list,
            'object': dict
        }
        
        return type_mapping.get(schema_type, str)
    
    def _json_schema_to_python_type(self, schema: Dict[str, Any]) -> Type:
        """Backward compatibility method."""
        return self._json_schema_to_python_type_static(schema)
    
    async def _arun(self, **kwargs) -> str:
        """
        Execute the remote skill asynchronously.
        
        This method implements the core execution logic:
        1. Create a collaboration task on the remote agent
        2. Poll for task completion
        3. Return the result or raise an error
        
        Args:
            **kwargs: Parameters to pass to the remote skill
            
        Returns:
            String representation of the task result
            
        Raises:
            Exception: If task creation, execution, or communication fails
        """
        try:
            logger.info(f"Executing remote skill '{self.skill.name}' with parameters: {kwargs}")
            
            # Create collaboration task
            task = await self.client.create_task(
                issuer_agent_id=self.issuer_agent_id,
                skill_name=self.skill.name,
                parameters=kwargs
            )
            
            logger.info(f"Created task {task.task_id} for skill '{self.skill.name}'")
            
            # Wait for completion
            completed_task = await self.client.wait_for_completion(
                task_id=task.task_id,
                polling_interval=self.polling_interval,
                max_wait_time=self.max_wait_time
            )
            
            logger.info(f"Task {task.task_id} completed successfully")
            
            # Return result as string
            if completed_task.result is not None:
                return str(completed_task.result)
            else:
                return "Task completed successfully (no result data)"
                
        except A2ATaskError as e:
            logger.error(f"A2A task error in skill '{self.skill.name}': {e}")
            raise Exception(f"Remote skill execution failed: {e}")
        except A2AConnectionError as e:
            logger.error(f"A2A connection error in skill '{self.skill.name}': {e}")
            raise Exception(f"Failed to connect to remote agent: {e}")
        except asyncio.TimeoutError:
            logger.error(f"Timeout executing skill '{self.skill.name}'")
            raise Exception(f"Remote skill execution timed out after {self.max_wait_time} seconds")
        except Exception as e:
            logger.error(f"Unexpected error executing skill '{self.skill.name}': {e}")
            raise Exception(f"Unexpected error in remote skill execution: {e}")
    
    def _run(self, **kwargs) -> str:
        """
        Synchronous wrapper for async execution.
        
        Args:
            **kwargs: Parameters to pass to the remote skill
            
        Returns:
            String representation of the task result
        """
        try:
            # Get or create event loop
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(self._arun(**kwargs))
    
    def to_openai_schema(self) -> Dict[str, Any]:
        """
        Convert the tool to OpenAI function calling schema.
        
        Returns:
            OpenAI-compatible function schema
        """
        schema = {
            "name": self.name.replace("/", "_"),  # OpenAI doesn't allow "/" in function names
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
        
        # Add parameters from skill schema
        if self.skill.parameters_schema:
            schema["parameters"] = self.skill.parameters_schema
        
        return schema
    
    async def close(self) -> None:
        """
        Close the underlying client connection.
        
        This method should be called when the tool is no longer needed
        to clean up HTTP connections.
        """
        await self.client.close()
    
    def __str__(self) -> str:
        """String representation of the tool."""
        return f"A2ASkillTool(name='{self.name}', agent='{self.client.target_agent_card.name}')"
    
    def __repr__(self) -> str:
        """Detailed string representation of the tool."""
        return (
            f"A2ASkillTool("
            f"name='{self.name}', "
            f"agent='{self.client.target_agent_card.name}', "
            f"skill='{self.skill.name}', "
            f"issuer='{self.issuer_agent_id}'"
            f")"
        )


class A2ASkillToolFactory:
    """
    Factory class for creating A2ASkillTool instances.
    
    This factory simplifies the process of creating tools from
    remote agent capabilities.
    """
    
    @staticmethod
    async def create_tools_from_agent(
        agent_endpoint: str,
        issuer_agent_id: str,
        polling_interval: float = 1.0,
        max_wait_time: float = 300.0
    ) -> Dict[str, A2ASkillTool]:
        """
        Create A2ASkillTool instances for all skills of a remote agent.
        
        Args:
            agent_endpoint: Base URL of the remote agent
            issuer_agent_id: ID of the agent that will issue tasks
            polling_interval: Time between status checks in seconds
            max_wait_time: Maximum time to wait for task completion
            
        Returns:
            Dictionary mapping tool names to A2ASkillTool instances
            
        Raises:
            A2AConnectionError: If agent discovery fails
        """
        # Create client and discover agent
        client = await A2AClient.from_endpoint(agent_endpoint)
        
        # Create tools for each skill
        tools = {}
        for skill in client.target_agent_card.skills:
            tool = A2ASkillTool(
                client=client,
                skill=skill,
                issuer_agent_id=issuer_agent_id,
                polling_interval=polling_interval,
                max_wait_time=max_wait_time
            )
            tools[tool.name] = tool
        
        return tools
    
    @staticmethod
    def create_tool_from_skill(
        client: A2AClient,
        skill: Skill,
        issuer_agent_id: str,
        polling_interval: float = 1.0,
        max_wait_time: float = 300.0
    ) -> A2ASkillTool:
        """
        Create a single A2ASkillTool from a skill definition.
        
        Args:
            client: A2AClient for the target agent
            skill: Skill definition to wrap
            issuer_agent_id: ID of the agent that will issue tasks
            polling_interval: Time between status checks in seconds
            max_wait_time: Maximum time to wait for task completion
            
        Returns:
            A2ASkillTool instance
        """
        return A2ASkillTool(
            client=client,
            skill=skill,
            issuer_agent_id=issuer_agent_id,
            polling_interval=polling_interval,
            max_wait_time=max_wait_time
        ) 