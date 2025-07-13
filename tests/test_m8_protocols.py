"""
Test suite for M8 Protocols module.

This module tests the A2A protocol implementation including
data models, task storage, client-server communication, and
the A2ASkillTool integration.
"""

import pytest
import asyncio
from datetime import datetime
from uuid import UUID, uuid4
from typing import Dict, Any

from agenticx.protocols import (
    # Data models
    AgentCard, Skill, CollaborationTask, TaskCreationRequest, TaskStatusResponse,
    # Storage
    InMemoryTaskStore,
    # Client/Server
    A2AClient, A2AWebServiceWrapper,
    # Tools
    A2ASkillTool, A2ASkillToolFactory,
    # Exceptions
    TaskNotFoundError, TaskAlreadyExistsError, A2AClientError
)
from agenticx.tools.base import BaseTool
from agenticx.core.agent_executor import AgentExecutor
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse


class MockLLMProvider(BaseLLMProvider):
    """Mock LLM provider for testing."""
    
    async def ainvoke(self, prompt: str, **kwargs) -> LLMResponse:
        return LLMResponse(
            content="Mock response",
            token_usage={"total_tokens": 10},
            cost=0.01,
            model_name="mock-model"
        )
    
    def invoke(self, prompt: str, **kwargs) -> LLMResponse:
        return LLMResponse(
            content="Mock response",
            token_usage={"total_tokens": 10},
            cost=0.01,
            model_name="mock-model"
        )


class MockTool(BaseTool):
    """Mock tool for testing."""
    
    def __init__(self, name: str, description: str = "Mock tool"):
        self.name = name
        self.description = description
        self.args_schema = None
    
    async def arun(self, **kwargs) -> str:
        return f"Mock result for {self.name} with args: {kwargs}"
    
    def run(self, **kwargs) -> str:
        return f"Mock result for {self.name} with args: {kwargs}"


class TestDataModels:
    """Test data model classes."""
    
    def test_skill_creation(self):
        """Test Skill model creation."""
        skill = Skill(
            name="test_skill",
            description="A test skill",
            parameters_schema={
                "type": "object",
                "properties": {
                    "input": {"type": "string"}
                },
                "required": ["input"]
            }
        )
        
        assert skill.name == "test_skill"
        assert skill.description == "A test skill"
        assert "input" in skill.parameters_schema["properties"]
    
    def test_agent_card_creation(self):
        """Test AgentCard model creation."""
        skills = [
            Skill(name="skill1", description="First skill"),
            Skill(name="skill2", description="Second skill")
        ]
        
        agent_card = AgentCard(
            agent_id="test_agent",
            name="Test Agent",
            description="A test agent",
            endpoint="http://localhost:8000",
            skills=skills
        )
        
        assert agent_card.agent_id == "test_agent"
        assert agent_card.name == "Test Agent"
        assert len(agent_card.skills) == 2
        assert agent_card.skills[0].name == "skill1"
    
    def test_collaboration_task_lifecycle(self):
        """Test CollaborationTask lifecycle methods."""
        task = CollaborationTask(
            issuer_agent_id="issuer",
            target_agent_id="target",
            skill_name="test_skill",
            parameters={"input": "test"}
        )
        
        # Initial state
        assert task.status == "pending"
        assert task.result is None
        assert task.error is None
        
        # Update status
        task.update_status("in_progress")
        assert task.status == "in_progress"
        
        # Complete task
        task.complete("success result")
        assert task.status == "completed"
        assert task.result == "success result"
        
        # Create new task and fail it
        task2 = CollaborationTask(
            issuer_agent_id="issuer",
            target_agent_id="target",
            skill_name="test_skill",
            parameters={"input": "test"}
        )
        
        task2.fail("error message")
        assert task2.status == "failed"
        assert task2.error == "error message"


class TestInMemoryTaskStore:
    """Test InMemoryTaskStore implementation."""
    
    @pytest.fixture
    def task_store(self):
        """Create a task store for testing."""
        return InMemoryTaskStore()
    
    @pytest.fixture
    def sample_task(self):
        """Create a sample task for testing."""
        return CollaborationTask(
            issuer_agent_id="issuer",
            target_agent_id="target",
            skill_name="test_skill",
            parameters={"input": "test"}
        )
    
    @pytest.mark.asyncio
    async def test_create_and_get_task(self, task_store, sample_task):
        """Test creating and retrieving a task."""
        # Create task
        await task_store.create_task(sample_task)
        
        # Retrieve task
        retrieved_task = await task_store.get_task(sample_task.task_id)
        assert retrieved_task is not None
        assert retrieved_task.task_id == sample_task.task_id
        assert retrieved_task.skill_name == sample_task.skill_name
    
    @pytest.mark.asyncio
    async def test_update_task(self, task_store, sample_task):
        """Test updating a task."""
        # Create task
        await task_store.create_task(sample_task)
        
        # Update task
        sample_task.complete("test result")
        await task_store.update_task(sample_task)
        
        # Retrieve updated task
        retrieved_task = await task_store.get_task(sample_task.task_id)
        assert retrieved_task.status == "completed"
        assert retrieved_task.result == "test result"
    
    @pytest.mark.asyncio
    async def test_list_tasks(self, task_store):
        """Test listing tasks with filters."""
        # Create multiple tasks
        task1 = CollaborationTask(
            issuer_agent_id="agent1",
            target_agent_id="target",
            skill_name="skill1",
            parameters={}
        )
        
        task2 = CollaborationTask(
            issuer_agent_id="agent2",
            target_agent_id="target",
            skill_name="skill2",
            parameters={}
        )
        
        await task_store.create_task(task1)
        await task_store.create_task(task2)
        
        # List all tasks
        all_tasks = await task_store.list_tasks()
        assert len(all_tasks) == 2
        
        # Filter by agent
        agent1_tasks = await task_store.list_tasks(agent_id="agent1")
        assert len(agent1_tasks) == 1
        assert agent1_tasks[0].issuer_agent_id == "agent1"
        
        # Filter by status
        pending_tasks = await task_store.list_tasks(status="pending")
        assert len(pending_tasks) == 2
    
    @pytest.mark.asyncio
    async def test_delete_task(self, task_store, sample_task):
        """Test deleting a task."""
        # Create task
        await task_store.create_task(sample_task)
        
        # Delete task
        deleted = await task_store.delete_task(sample_task.task_id)
        assert deleted is True
        
        # Verify task is gone
        retrieved_task = await task_store.get_task(sample_task.task_id)
        assert retrieved_task is None
        
        # Try to delete non-existent task
        deleted = await task_store.delete_task(uuid4())
        assert deleted is False
    
    @pytest.mark.asyncio
    async def test_duplicate_task_creation(self, task_store, sample_task):
        """Test that creating duplicate tasks raises an error."""
        # Create task
        await task_store.create_task(sample_task)
        
        # Try to create same task again
        with pytest.raises(TaskAlreadyExistsError):
            await task_store.create_task(sample_task)
    
    @pytest.mark.asyncio
    async def test_update_nonexistent_task(self, task_store, sample_task):
        """Test that updating non-existent task raises an error."""
        with pytest.raises(TaskNotFoundError):
            await task_store.update_task(sample_task)


class TestA2ASkillTool:
    """Test A2ASkillTool implementation."""
    
    @pytest.fixture
    def mock_agent_card(self):
        """Create a mock agent card."""
        skills = [
            Skill(
                name="test_skill",
                description="A test skill",
                parameters_schema={
                    "type": "object",
                    "properties": {
                        "input": {"type": "string"}
                    },
                    "required": ["input"]
                }
            )
        ]
        
        return AgentCard(
            agent_id="test_agent",
            name="Test Agent",
            description="A test agent",
            endpoint="http://localhost:8000",
            skills=skills
        )
    
    @pytest.fixture
    def mock_client(self, mock_agent_card):
        """Create a mock A2A client."""
        return A2AClient(mock_agent_card)
    
    def test_skill_tool_properties(self, mock_client, mock_agent_card):
        """Test A2ASkillTool properties."""
        skill = mock_agent_card.skills[0]
        tool = A2ASkillTool(
            client=mock_client,
            skill=skill,
            issuer_agent_id="issuer_agent"
        )
        
        assert tool.name == "Test Agent/test_skill"
        assert tool.description == "A test skill"
        assert tool.args_schema is not None
    
    def test_openai_schema_conversion(self, mock_client, mock_agent_card):
        """Test converting tool to OpenAI schema."""
        skill = mock_agent_card.skills[0]
        tool = A2ASkillTool(
            client=mock_client,
            skill=skill,
            issuer_agent_id="issuer_agent"
        )
        
        schema = tool.to_openai_schema()
        assert schema["name"] == "Test Agent_test_skill"  # "/" replaced with "_"
        assert schema["description"] == "A test skill"
        assert "parameters" in schema


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 