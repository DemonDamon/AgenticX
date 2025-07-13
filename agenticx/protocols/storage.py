"""
Storage implementations for A2A protocol task persistence.

This module provides concrete implementations of the BaseTaskStore interface,
starting with an in-memory implementation for development and testing.
"""

import asyncio
from typing import Dict, List, Optional
from uuid import UUID

from .interfaces import BaseTaskStore, TaskNotFoundError, TaskAlreadyExistsError
from .models import CollaborationTask


class InMemoryTaskStore(BaseTaskStore):
    """
    In-memory implementation of BaseTaskStore.
    
    This implementation stores tasks in memory and is suitable for
    development and testing. For production use, consider implementing
    a persistent storage backend (Redis, database, etc.).
    """
    
    def __init__(self):
        """Initialize the in-memory task store."""
        self._tasks: Dict[UUID, CollaborationTask] = {}
        self._lock = asyncio.Lock()
    
    async def get_task(self, task_id: UUID) -> Optional[CollaborationTask]:
        """
        Retrieve a task by its ID.
        
        Args:
            task_id: Unique identifier for the task
            
        Returns:
            CollaborationTask if found, None otherwise
        """
        async with self._lock:
            return self._tasks.get(task_id)
    
    async def create_task(self, task: CollaborationTask) -> None:
        """
        Create and store a new task.
        
        Args:
            task: The collaboration task to store
            
        Raises:
            TaskAlreadyExistsError: If task with same ID already exists
        """
        async with self._lock:
            if task.task_id in self._tasks:
                raise TaskAlreadyExistsError(f"Task with ID {task.task_id} already exists")
            
            # Create a deep copy to avoid external mutations
            self._tasks[task.task_id] = task.copy(deep=True)
    
    async def update_task(self, task: CollaborationTask) -> None:
        """
        Update an existing task's state or properties.
        
        Args:
            task: The updated task object
            
        Raises:
            TaskNotFoundError: If task doesn't exist
        """
        async with self._lock:
            if task.task_id not in self._tasks:
                raise TaskNotFoundError(f"Task with ID {task.task_id} not found")
            
            # Update with a deep copy
            self._tasks[task.task_id] = task.copy(deep=True)
    
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
        async with self._lock:
            tasks = list(self._tasks.values())
            
            # Apply filters
            if agent_id:
                tasks = [
                    task for task in tasks 
                    if task.issuer_agent_id == agent_id or task.target_agent_id == agent_id
                ]
            
            if status:
                tasks = [task for task in tasks if task.status == status]
            
            # Sort by creation time (newest first) and apply limit
            tasks.sort(key=lambda t: t.created_at, reverse=True)
            return tasks[:limit]
    
    async def delete_task(self, task_id: UUID) -> bool:
        """
        Delete a task from storage.
        
        Args:
            task_id: Unique identifier for the task
            
        Returns:
            True if task was deleted, False if not found
        """
        async with self._lock:
            if task_id in self._tasks:
                del self._tasks[task_id]
                return True
            return False
    
    async def clear_all(self) -> None:
        """
        Clear all tasks from storage.
        
        This method is primarily for testing purposes.
        """
        async with self._lock:
            self._tasks.clear()
    
    async def task_count(self) -> int:
        """
        Get the total number of tasks in storage.
        
        Returns:
            Number of tasks currently stored
        """
        async with self._lock:
            return len(self._tasks)
    
    async def get_tasks_by_status(self, status: str) -> List[CollaborationTask]:
        """
        Get all tasks with a specific status.
        
        Args:
            status: The status to filter by
            
        Returns:
            List of tasks with the specified status
        """
        return await self.list_tasks(status=status, limit=1000)  # High limit for all tasks 