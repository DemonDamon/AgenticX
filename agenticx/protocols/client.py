"""
Client-side implementation for A2A protocol.

This module provides the A2AClient class for communicating with
remote A2A-compliant agent services.
"""

import asyncio
import logging
from typing import Dict, Any, Optional
from uuid import UUID

import httpx
from pydantic import ValidationError

from .models import AgentCard, CollaborationTask, TaskCreationRequest, TaskStatusResponse

logger = logging.getLogger(__name__)


class A2AClientError(Exception):
    """Base exception for A2A client errors."""
    pass


class A2AConnectionError(A2AClientError):
    """Raised when connection to remote agent fails."""
    pass


class A2ATaskError(A2AClientError):
    """Raised when task creation or execution fails."""
    pass


class A2AClient:
    """
    Client for interacting with remote A2A-compliant agent services.
    
    This class provides methods to discover agent capabilities,
    create collaboration tasks, and monitor their execution.
    """
    
    def __init__(
        self,
        target_agent_card: AgentCard,
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_delay: float = 1.0
    ):
        """
        Initialize the A2A client.
        
        Args:
            target_agent_card: AgentCard of the target agent
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
            retry_delay: Delay between retries in seconds
        """
        self.target_agent_card = target_agent_card
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        
        # HTTP client configuration
        self.http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            follow_redirects=True
        )
    
    async def __aenter__(self):
        """Async context manager entry."""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
    
    async def close(self) -> None:
        """Close the HTTP client."""
        await self.http_client.aclose()
    
    @classmethod
    async def from_endpoint(
        cls,
        endpoint: str,
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_delay: float = 1.0
    ) -> 'A2AClient':
        """
        Create an A2AClient by discovering the agent card from an endpoint.
        
        Args:
            endpoint: Base URL of the target agent
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
            retry_delay: Delay between retries in seconds
            
        Returns:
            Configured A2AClient instance
            
        Raises:
            A2AConnectionError: If agent discovery fails
        """
        # Discover agent card
        agent_card_url = f"{endpoint.rstrip('/')}/.well-known/agent.json"
        
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
            try:
                response = await client.get(agent_card_url)
                response.raise_for_status()
                
                agent_card_data = response.json()
                agent_card = AgentCard(**agent_card_data)
                
                return cls(
                    target_agent_card=agent_card,
                    timeout=timeout,
                    max_retries=max_retries,
                    retry_delay=retry_delay
                )
                
            except httpx.HTTPError as e:
                raise A2AConnectionError(f"Failed to discover agent at {endpoint}: {e}")
            except ValidationError as e:
                raise A2AConnectionError(f"Invalid agent card format: {e}")
    
    async def create_task(
        self,
        issuer_agent_id: str,
        skill_name: str,
        parameters: Dict[str, Any]
    ) -> CollaborationTask:
        """
        Create a new collaboration task on the remote agent.
        
        Args:
            issuer_agent_id: ID of the agent creating the task
            skill_name: Name of the skill to invoke
            parameters: Parameters to pass to the skill
            
        Returns:
            Created CollaborationTask with initial status
            
        Raises:
            A2ATaskError: If task creation fails
        """
        # Validate skill exists
        if not any(skill.name == skill_name for skill in self.target_agent_card.skills):
            raise A2ATaskError(f"Skill '{skill_name}' not found in target agent")
        
        # Create task request
        task_request = TaskCreationRequest(
            issuer_agent_id=issuer_agent_id,
            skill_name=skill_name,
            parameters=parameters
        )
        
        # Send request with retries
        last_exception: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                endpoint = f"{str(self.target_agent_card.endpoint).rstrip('/')}/tasks"
                
                response = await self.http_client.post(
                    endpoint,
                    json=task_request.dict(),
                    headers={"Content-Type": "application/json"}
                )
                
                response.raise_for_status()
                
                # Parse response
                task_data = response.json()
                task_response = TaskStatusResponse(**task_data)
                
                # Convert to CollaborationTask
                return CollaborationTask(
                    task_id=task_response.task_id,
                    issuer_agent_id=issuer_agent_id,
                    target_agent_id=self.target_agent_card.agent_id,
                    skill_name=skill_name,
                    parameters=parameters,
                    status=task_response.status,
                    result=task_response.result,
                    error=task_response.error,
                    created_at=task_response.created_at,
                    updated_at=task_response.updated_at
                )
                
            except httpx.HTTPError as e:
                last_exception = e
                if attempt < self.max_retries:
                    logger.warning(f"Task creation attempt {attempt + 1} failed: {e}, retrying...")
                    await asyncio.sleep(self.retry_delay * (2 ** attempt))  # Exponential backoff
                    continue
                else:
                    raise A2ATaskError(f"Failed to create task after {self.max_retries + 1} attempts: {e}")
            except ValidationError as e:
                raise A2ATaskError(f"Invalid task response format: {e}")
        
        # This line should never be reached due to the raise statements above,
        # but added for type checker safety
        if last_exception is not None:
            raise A2ATaskError(f"Failed to create task: {last_exception}")
        # Fallback to satisfy type checker - this should never be reached
        raise A2ATaskError("Failed to create task: Unknown error")
    
    async def get_task(self, task_id: UUID) -> CollaborationTask:
        """
        Get the status and result of a collaboration task.
        
        Args:
            task_id: Unique identifier of the task
            
        Returns:
            Updated CollaborationTask with current status
            
        Raises:
            A2ATaskError: If task retrieval fails
        """
        last_exception: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                endpoint = f"{str(self.target_agent_card.endpoint).rstrip('/')}/tasks/{task_id}"
                
                response = await self.http_client.get(endpoint)
                response.raise_for_status()
                
                # Parse response
                task_data = response.json()
                task_response = TaskStatusResponse(**task_data)
                
                # Convert to CollaborationTask
                return CollaborationTask(
                    task_id=task_response.task_id,
                    issuer_agent_id="",  # Not provided in response
                    target_agent_id=self.target_agent_card.agent_id,
                    skill_name="",  # Not provided in response
                    parameters={},  # Not provided in response
                    status=task_response.status,
                    result=task_response.result,
                    error=task_response.error,
                    created_at=task_response.created_at,
                    updated_at=task_response.updated_at
                )
                
            except httpx.HTTPError as e:
                last_exception = e
                if attempt < self.max_retries:
                    logger.warning(f"Task retrieval attempt {attempt + 1} failed: {e}, retrying...")
                    await asyncio.sleep(self.retry_delay * (2 ** attempt))
                    continue
                else:
                    raise A2ATaskError(f"Failed to get task after {self.max_retries + 1} attempts: {e}")
            except ValidationError as e:
                raise A2ATaskError(f"Invalid task response format: {e}")
        
        # This line should never be reached due to the raise statements above,
        # but added for type checker safety
        if last_exception is not None:
            raise A2ATaskError(f"Failed to get task: {last_exception}")
        # Fallback to satisfy type checker - this should never be reached
        raise A2ATaskError("Failed to get task: Unknown error")
    
    async def wait_for_completion(
        self,
        task_id: UUID,
        polling_interval: float = 1.0,
        max_wait_time: float = 300.0
    ) -> CollaborationTask:
        """
        Wait for a task to complete by polling its status.
        
        Args:
            task_id: Unique identifier of the task
            polling_interval: Time between status checks in seconds
            max_wait_time: Maximum time to wait in seconds
            
        Returns:
            Completed CollaborationTask
            
        Raises:
            A2ATaskError: If task fails or times out
        """
        start_time = asyncio.get_event_loop().time()
        
        while True:
            # Check if we've exceeded max wait time
            if asyncio.get_event_loop().time() - start_time > max_wait_time:
                raise A2ATaskError(f"Task {task_id} timed out after {max_wait_time} seconds")
            
            # Get current task status
            task = await self.get_task(task_id)
            
            if task.status == 'completed':
                return task
            elif task.status == 'failed':
                raise A2ATaskError(f"Task {task_id} failed: {task.error}")
            
            # Wait before next poll
            await asyncio.sleep(polling_interval)
    
    async def health_check(self) -> Dict[str, Any]:
        """
        Check if the remote agent service is healthy.
        
        Returns:
            Health status information
            
        Raises:
            A2AConnectionError: If health check fails
        """
        try:
            endpoint = f"{str(self.target_agent_card.endpoint).rstrip('/')}/health"
            response = await self.http_client.get(endpoint)
            response.raise_for_status()
            
            return response.json()
            
        except httpx.HTTPError as e:
            raise A2AConnectionError(f"Health check failed: {e}")
    
    def get_available_skills(self) -> Dict[str, str]:
        """
        Get a dictionary of available skills and their descriptions.
        
        Returns:
            Dictionary mapping skill names to descriptions
        """
        return {skill.name: skill.description for skill in self.target_agent_card.skills} 