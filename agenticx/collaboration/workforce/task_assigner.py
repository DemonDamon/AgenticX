"""
TaskAssigner - 智能任务分配器

将任务分配给合适的 Worker，优先使用 CollaborationIntelligence，回退到 LLM 驱动分配。
参考：camel/societies/workforce/workforce.py:_assign_task()
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
from typing import List, Optional, Dict, Any

from ...core.agent import Agent
from ...core.task import Task
from ...collaboration.intelligence import CollaborationIntelligence
from .coordinator import CoordinatorAgent

logger = logging.getLogger(__name__)


class TaskAssigner:
    """任务分配器
    
    优先使用 CollaborationIntelligence 进行智能分配，如果没有则回退到 LLM 驱动分配。
    """
    
    def __init__(
        self,
        coordinator_agent: Agent,
        coordinator: CoordinatorAgent,
        collaboration_intelligence: Optional[CollaborationIntelligence] = None,
        session_id: Optional[str] = None,
    ):
        """
        初始化 TaskAssigner
        
        Args:
            coordinator_agent: Coordinator Agent 实例
            coordinator: CoordinatorAgent 封装实例
            collaboration_intelligence: CollaborationIntelligence 实例（可选）
            session_id: 协作会话 ID（可选，用于 CollaborationIntelligence）
        """
        self.coordinator_agent = coordinator_agent
        self.coordinator = coordinator
        self.collaboration_intelligence = collaboration_intelligence
        self.session_id = session_id
    
    async def assign_tasks(
        self,
        tasks: List[Task],
        workers: List[Any],  # List[Worker]
    ) -> Dict[str, str]:
        """
        分配任务给 Worker
        
        Args:
            tasks: 任务列表
            workers: Worker 列表
            
        Returns:
            任务分配映射 {task_id: worker_id}
        """
        logger.info(f"[TaskAssigner] Assigning {len(tasks)} tasks to {len(workers)} workers")
        
        # 优先使用 CollaborationIntelligence
        if self.collaboration_intelligence and self.session_id:
            try:
                return await self._assign_with_intelligence(tasks, workers)
            except Exception as e:
                logger.warning(
                    f"[TaskAssigner] CollaborationIntelligence assignment failed: {e}, "
                    "falling back to LLM-driven assignment"
                )
        
        # 回退到 LLM 驱动分配
        return await self._assign_with_llm(tasks, workers)
    
    async def _assign_with_intelligence(
        self,
        tasks: List[Task],
        workers: List[Any],
    ) -> Dict[str, str]:
        """使用 CollaborationIntelligence 进行分配"""
        # 将 Task 对象转换为 Dict 格式
        task_dicts = []
        for task in tasks:
            task_dict = {
                "task_id": task.id,
                "description": task.description,
                "expected_output": task.expected_output or "",
                "dependencies": task.dependencies or [],
                "priority": getattr(task, "priority", 1),
            }
            task_dicts.append(task_dict)
        
        # 调用 CollaborationIntelligence
        allocations = self.collaboration_intelligence.allocate_tasks(
            session_id=self.session_id,
            tasks=task_dicts,
        )
        
        # 转换为分配映射
        assignment_map = {}
        for allocation in allocations:
            task_id = allocation.task_id
            worker_id = allocation.assigned_agent
            
            # 验证 worker_id 是否在 workers 列表中
            worker_ids = [w.id for w in workers]
            if worker_id in worker_ids:
                assignment_map[task_id] = worker_id
            else:
                logger.warning(
                    f"[TaskAssigner] Allocated worker {worker_id} not found in workers list, "
                    f"skipping task {task_id}"
                )
        
        logger.info(
            f"[TaskAssigner] CollaborationIntelligence assigned {len(assignment_map)} tasks"
        )
        return assignment_map
    
    async def _assign_with_llm(
        self,
        tasks: List[Task],
        workers: List[Any],
    ) -> Dict[str, str]:
        """使用 LLM 驱动分配（回退方案）"""
        logger.info("[TaskAssigner] Using LLM-driven assignment")
        return await self.coordinator.assign_tasks(tasks, workers)
