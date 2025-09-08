"""
Server-side implementation for A2A protocol.

This module provides the A2AWebServiceWrapper class that wraps an
AgentExecutor into a FastAPI/Starlette application compliant with
the A2A protocol specification.
"""

import asyncio
import logging
from typing import Dict, Any, Optional
from uuid import UUID

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, status
from fastapi.responses import JSONResponse

from ..core.agent_executor import AgentExecutor
from ..core.task import Task
from ..tools.base import BaseTool
from .interfaces import BaseTaskStore, TaskNotFoundError
from .models import (
    AgentCard, Skill, CollaborationTask, TaskCreationRequest, TaskStatusResponse
)

logger = logging.getLogger(__name__)


class A2AWebServiceWrapper:
    """
    Wraps an AgentExecutor into an A2A protocol-compliant FastAPI application.
    
    This class creates a web service that can receive collaboration tasks
    from remote agents and execute them using the local AgentExecutor.
    """
    
    def __init__(
        self, 
        agent_executor: AgentExecutor,
        task_store: BaseTaskStore,
        agent_id: str,
        agent_name: str,
        agent_description: str,
        base_url: str = "http://localhost:8000"
    ):
        """
        Initialize the A2A web service wrapper.
        
        Args:
            agent_executor: The AgentExecutor to wrap
            task_store: Storage backend for collaboration tasks
            agent_id: Unique identifier for this agent
            agent_name: Human-readable name for this agent
            agent_description: Description of this agent's purpose
            base_url: Base URL where this service will be hosted
        """
        self.agent_executor = agent_executor
        self.task_store = task_store
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.agent_description = agent_description
        self.base_url = base_url
        
        # Create FastAPI app
        self.app = FastAPI(
            title=f"{agent_name} A2A Service",
            description=f"A2A-compliant service for {agent_description}",
            version="1.0.0"
        )
        
        # Register routes
        self._register_routes()
    
    def _register_routes(self) -> None:
        """Register all A2A protocol endpoints."""
        
        @self.app.get("/.well-known/agent.json", response_model=AgentCard)
        async def get_agent_card() -> AgentCard:
            """
            Publish AgentCard for service discovery.
            
            This endpoint implements the A2A service discovery mechanism
            by exposing the agent's capabilities and metadata.
            """
            return await self._generate_agent_card()
        
        @self.app.post("/tasks", status_code=status.HTTP_202_ACCEPTED, response_model=TaskStatusResponse)
        async def create_task(
            task_request: TaskCreationRequest,
            background_tasks: BackgroundTasks
        ) -> TaskStatusResponse:
            """
            Create a new collaboration task.
            
            Accepts a task creation request from a remote agent,
            stores it in the task store, and schedules it for execution.
            """
            # Convert request to collaboration task
            task = task_request.to_collaboration_task(self.agent_id)
            
            try:
                # Store the task
                await self.task_store.create_task(task)
                
                # Schedule background execution
                background_tasks.add_task(self._execute_task, task.task_id)
                
                logger.info(f"Created task {task.task_id} for skill '{task.skill_name}'")
                return TaskStatusResponse.from_collaboration_task(task)
                
            except Exception as e:
                logger.error(f"Failed to create task: {e}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to create task: {str(e)}"
                )
        
        @self.app.get("/tasks/{task_id}", response_model=TaskStatusResponse)
        async def get_task_status(task_id: UUID) -> TaskStatusResponse:
            """
            Query the status of a collaboration task.
            
            Returns the current status, result, or error information
            for the specified task.
            """
            task = await self.task_store.get_task(task_id)
            if not task:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Task {task_id} not found"
                )
            
            return TaskStatusResponse.from_collaboration_task(task)
        
        @self.app.get("/health")
        async def health_check() -> Dict[str, str]:
            """Health check endpoint."""
            return {"status": "healthy", "agent_id": self.agent_id}
    
    async def _generate_agent_card(self) -> AgentCard:
        """
        Generate the AgentCard for this agent.
        
        Dynamically creates the agent card based on the available
        tools in the AgentExecutor.
        """
        skills = []
        
        # Extract skills from agent's tools
        for tool_name, tool in self.agent_executor.tool_registry.tools.items():
            if isinstance(tool, BaseTool):
                skill = Skill(
                    name=tool_name,
                    description=tool.description,
                    parameters_schema=tool.args_schema.schema() if tool.args_schema else {}
                )
                skills.append(skill)
        
        # Create AgentCard with explicit HttpUrl conversion
        agent_card_dict = {
            "agent_id": self.agent_id,
            "name": self.agent_name,
            "description": self.agent_description,
            "endpoint": self.base_url,  # Pydantic will convert this to HttpUrl
            "skills": skills
        }
        
        return AgentCard(**agent_card_dict)
    
    async def _execute_task(self, task_id: UUID) -> None:
        """
        Execute a collaboration task in the background.
        
        This method runs the task using the AgentExecutor and updates
        the task status based on the execution result.
        """
        try:
            # Get task from store
            task = await self.task_store.get_task(task_id)
            if not task:
                logger.error(f"Task {task_id} not found during execution")
                return
            
            # Mark as in progress
            task.update_status('in_progress')
            await self.task_store.update_task(task)
            
            # Execute the task
            logger.info(f"Executing task {task_id} with skill '{task.skill_name}'")
            
            # Check if the skill (tool) exists
            if task.skill_name not in self.agent_executor.tool_registry.tools:
                error_msg = f"Skill '{task.skill_name}' not found in agent tools"
                task.fail(error_msg)
                await self.task_store.update_task(task)
                logger.error(error_msg)
                return
            
            # Get the tool and execute it
            tool = self.agent_executor.tool_registry.tools[task.skill_name]
            result = await tool.arun(**task.parameters)
            
            # Mark as completed
            task.complete(result)
            await self.task_store.update_task(task)
            
            logger.info(f"Task {task_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Task {task_id} execution failed: {e}")
            
            # Mark as failed
            try:
                task = await self.task_store.get_task(task_id)
                if task:
                    task.fail(str(e))
                    await self.task_store.update_task(task)
            except Exception as update_error:
                logger.error(f"Failed to update task {task_id} status: {update_error}")
    
    def get_app(self) -> FastAPI:
        """
        Get the FastAPI application instance.
        
        Returns:
            The configured FastAPI application
        """
        return self.app
    
    async def start_server(self, host: str = "0.0.0.0", port: int = 8000) -> None:
        """
        Start the A2A web service.
        
        Args:
            host: Host address to bind to
            port: Port number to listen on
        """
        import uvicorn
        
        logger.info(f"Starting A2A service for agent '{self.agent_name}' on {host}:{port}")
        
        config = uvicorn.Config(
            app=self.app,
            host=host,
            port=port,
            log_level="info"
        )
        
        server = uvicorn.Server(config)
        await server.serve() 