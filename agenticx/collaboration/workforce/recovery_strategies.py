"""
RecoveryStrategies - 5种恢复策略实现

实现 RETRY, REASSIGN, DECOMPOSE, REPLAN, CREATE_WORKER 五种恢复策略。
参考：camel/societies/workforce/workforce.py:_apply_recovery_strategy()
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
from typing import List, Optional, Dict, Any

from ...core.task import Task
from .utils import RecoveryStrategy
from .task_decomposer import TaskDecomposer
from .worker import Worker

logger = logging.getLogger(__name__)


class RecoveryStrategyExecutor:
    """恢复策略执行器
    
    实现 5 种恢复策略的具体逻辑。
    """
    
    def __init__(
        self,
        task_decomposer: Optional[TaskDecomposer] = None,
        worker_factory: Optional[Any] = None,  # WorkerFactory (延迟导入避免循环)
    ):
        """
        初始化 RecoveryStrategyExecutor
        
        Args:
            task_decomposer: TaskDecomposer 实例（用于 DECOMPOSE 策略）
            worker_factory: WorkerFactory 实例（用于 CREATE_WORKER 策略）
        """
        self.task_decomposer = task_decomposer
        self.worker_factory = worker_factory
    
    async def apply_strategy(
        self,
        strategy: RecoveryStrategy,
        task: Task,
        failed_worker: Optional[Worker] = None,
        available_workers: Optional[List[Worker]] = None,
        failure_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        应用恢复策略
        
        Args:
            strategy: 恢复策略
            task: 失败的任务
            failed_worker: 失败的 Worker（可选）
            available_workers: 可用的 Worker 列表（可选）
            failure_context: 失败上下文（可选）
            
        Returns:
            策略应用结果
        """
        logger.info(
            f"[RecoveryStrategy] Applying {strategy.value} strategy for task {task.id}"
        )
        
        if strategy == RecoveryStrategy.RETRY:
            return await self._apply_retry(task, failed_worker)
        elif strategy == RecoveryStrategy.REASSIGN:
            return await self._apply_reassign(task, failed_worker, available_workers)
        elif strategy == RecoveryStrategy.DECOMPOSE:
            return await self._apply_decompose(task, available_workers)
        elif strategy == RecoveryStrategy.REPLAN:
            return await self._apply_replan(task, failure_context)
        elif strategy == RecoveryStrategy.CREATE_WORKER:
            return await self._apply_create_worker(task, available_workers)
        else:
            raise ValueError(f"Unknown recovery strategy: {strategy}")
    
    async def _apply_retry(
        self,
        task: Task,
        failed_worker: Optional[Worker],
    ) -> Dict[str, Any]:
        """应用 RETRY 策略：使用相同的 Worker 和任务内容重试"""
        logger.info(f"[RecoveryStrategy] RETRY: Retrying task {task.id} with same worker")
        
        return {
            "strategy": RecoveryStrategy.RETRY.value,
            "action": "retry",
            "task": task,
            "worker": failed_worker,
            "modified_task": None,  # 任务内容不变
        }
    
    async def _apply_reassign(
        self,
        task: Task,
        failed_worker: Optional[Worker],
        available_workers: Optional[List[Worker]],
    ) -> Dict[str, Any]:
        """应用 REASSIGN 策略：将任务重新分配给不同的 Worker"""
        logger.info(f"[RecoveryStrategy] REASSIGN: Reassigning task {task.id} to different worker")
        
        if not available_workers:
            raise ValueError("No available workers for reassignment")
        
        # 找到除失败 Worker 之外的其他 Worker
        candidate_workers = [
            w for w in available_workers
            if failed_worker is None or w.id != failed_worker.id
        ]
        
        if not candidate_workers:
            raise ValueError("No alternative workers available for reassignment")
        
        # 简单策略：选择第一个候选 Worker
        # 实际应用中可以使用更智能的选择策略（基于能力匹配、负载等）
        new_worker = candidate_workers[0]
        
        return {
            "strategy": RecoveryStrategy.REASSIGN.value,
            "action": "reassign",
            "task": task,
            "old_worker": failed_worker,
            "new_worker": new_worker,
            "modified_task": None,  # 任务内容不变
        }
    
    async def _apply_decompose(
        self,
        task: Task,
        available_workers: Optional[List[Worker]],
    ) -> Dict[str, Any]:
        """应用 DECOMPOSE 策略：将任务分解为更小的子任务"""
        logger.info(f"[RecoveryStrategy] DECOMPOSE: Decomposing task {task.id} into subtasks")
        
        if not self.task_decomposer:
            raise ValueError("TaskDecomposer is required for DECOMPOSE strategy")
        
        if not available_workers:
            raise ValueError("Available workers are required for decomposition")
        
        # 使用 TaskDecomposer 分解任务
        subtasks = await self.task_decomposer.decompose_task(
            task=task,
            available_workers=available_workers,
        )
        
        return {
            "strategy": RecoveryStrategy.DECOMPOSE.value,
            "action": "decompose",
            "original_task": task,
            "subtasks": subtasks,
        }
    
    async def _apply_replan(
        self,
        task: Task,
        failure_context: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """应用 REPLAN 策略：修改任务内容，提供更清晰的指令"""
        logger.info(f"[RecoveryStrategy] REPLAN: Replanning task {task.id} with modified content")
        
        # 从失败上下文中提取修改后的任务内容
        modified_content = None
        if failure_context:
            modified_content = failure_context.get("modified_task_content")
        
        # 如果没有提供修改内容，使用原始任务描述（实际应用中应该由 LLM 生成）
        if not modified_content:
            modified_content = task.description + " (Revised with clearer instructions)"
        
        # 创建修改后的任务
        modified_task = Task(
            id=f"{task.id}_replanned",
            description=modified_content,
            expected_output=task.expected_output,
            dependencies=task.dependencies,
        )
        
        return {
            "strategy": RecoveryStrategy.REPLAN.value,
            "action": "replan",
            "original_task": task,
            "modified_task": modified_task,
        }
    
    async def _apply_create_worker(
        self,
        task: Task,
        available_workers: Optional[List[Worker]],
    ) -> Dict[str, Any]:
        """应用 CREATE_WORKER 策略：创建新的专门 Worker"""
        logger.info(f"[RecoveryStrategy] CREATE_WORKER: Creating new worker for task {task.id}")
        
        if not self.worker_factory:
            raise ValueError("WorkerFactory is required for CREATE_WORKER strategy")
        
        # 使用 WorkerFactory 创建新的 Worker
        new_worker = await self.worker_factory.create_worker_for_task(
            task=task,
            existing_workers=available_workers or [],
        )
        
        return {
            "strategy": RecoveryStrategy.CREATE_WORKER.value,
            "action": "create_worker",
            "task": task,
            "new_worker": new_worker,
        }
