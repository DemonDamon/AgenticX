"""
Core interfaces for A2A protocol implementation.

This module defines the abstract base classes that establish contracts
for task storage and other protocol components.
"""

from abc import ABC, abstractmethod
from typing import Optional, List
from uuid import UUID

from .models import CollaborationTask


class BaseTaskStore(ABC):
    """
    Abstract base class for A2A collaboration task persistence.
    
    This interface ensures reliable task tracking in distributed systems,
    allowing different storage backends (memory, Redis, database) to be
    used interchangeably.
    """
    
    @abstractmethod
    async def get_task(self, task_id: UUID) -> Optional[CollaborationTask]:
        """
        Retrieve a task by its ID.
        
        Args:
            task_id: Unique identifier for the task
            
        Returns:
            CollaborationTask if found, None otherwise
        """
        pass
    
    @abstractmethod
    async def create_task(self, task: CollaborationTask) -> None:
        """
        Create and store a new task.
        
        Args:
            task: The collaboration task to store
            
        Raises:
            TaskAlreadyExistsError: If task with same ID already exists
        """
        pass
    
    @abstractmethod
    async def update_task(self, task: CollaborationTask) -> None:
        """
        Update an existing task's state or properties.
        
        Args:
            task: The updated task object
            
        Raises:
            TaskNotFoundError: If task doesn't exist
        """
        pass
    
    @abstractmethod
    async def list_tasks(
        self, 
        agent_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100
    ) -> List[CollaborationTask]:
        """
        List tasks with optional filtering.
        
        Args:
            agent_id: Filter by issuer or target agent ID
            status: Filter by task status
            limit: Maximum number of tasks to return
            
        Returns:
            List of matching collaboration tasks
        """
        pass
    
    @abstractmethod
    async def delete_task(self, task_id: UUID) -> bool:
        """
        Delete a task from storage.
        
        Args:
            task_id: Unique identifier for the task
            
        Returns:
            True if task was deleted, False if not found
        """
        pass


class TaskError(Exception):
    """Base exception for task-related errors."""
    pass


class TaskNotFoundError(TaskError):
    """Raised when a requested task cannot be found."""
    pass


class TaskAlreadyExistsError(TaskError):
    """Raised when trying to create a task that already exists."""
    pass 