"""
WorkforcePattern - Workforce 编排模式实现

内化自 CAMEL-AI 的 Workforce 编排系统。
参考：camel/societies/workforce/workforce.py
License: Apache 2.0 (CAMEL-AI.org)
"""

import time
import logging
import asyncio
from typing import List, Optional, Dict, Any
from collections import deque
from datetime import datetime

from ...core.agent import Agent
from ...core.task import Task
from ...core.agent_executor import AgentExecutor
from ...core.event import EventLog, TaskStartEvent, TaskEndEvent
from ...planner import AdaptivePlanner
from ...collaboration.base import (
    BaseCollaborationPattern,
    CollaborationResult,
    CollaborationState,
    SubTask,
    TaskResult,
)
from ...collaboration.config import CollaborationConfig, WorkforceConfig
from ...collaboration.enums import CollaborationStatus
from ...collaboration.intelligence import CollaborationIntelligence
from .coordinator import CoordinatorAgent
from .task_planner import TaskPlannerAgent
from .worker import Worker, SingleAgentWorker
from .utils import (
    RecoveryStrategy,
    FailureHandlingConfig,
    WorkforceMode,
    TaskAnalysisResult,
)
from .prompts import TASK_AGENT_SYSTEM_MESSAGE, COORDINATOR_AGENT_SYSTEM_MESSAGE

logger = logging.getLogger(__name__)




class WorkforcePattern(BaseCollaborationPattern):
    """Workforce 编排模式
    
    实现 coordinator-planner-worker 三层架构，支持智能任务分解和故障恢复。
    """
    
    def __init__(
        self,
        coordinator_agent: Agent,
        task_agent: Agent,
        workers: List[Agent],
        llm_provider,
        config: Optional[WorkforceConfig] = None,
        planner: Optional[AdaptivePlanner] = None,
        collaboration_intelligence: Optional[CollaborationIntelligence] = None,
        event_log: Optional[EventLog] = None,
        **kwargs
    ):
        """
        初始化 WorkforcePattern
        
        Args:
            coordinator_agent: Coordinator Agent（负责任务分配）
            task_agent: Task Agent（负责任务分解）
            workers: Worker Agent 列表
            llm_provider: LLM 提供者
            config: Workforce 配置
            planner: AdaptivePlanner 实例（可选，用于任务分解优化）
            collaboration_intelligence: CollaborationIntelligence 实例（可选，用于智能任务分配）
            event_log: EventLog 实例（可选）
            **kwargs: 额外参数
        """
        # 构建 agents 列表
        agents = [coordinator_agent, task_agent] + workers
        
        # 创建配置
        if config is None:
            from ...collaboration.enums import CollaborationMode
            config = WorkforceConfig(
                mode=CollaborationMode.WORKFORCE,
                coordinator_agent_id=coordinator_agent.id,
                task_agent_id=task_agent.id,
                worker_agent_ids=[w.id for w in workers],
            )
        
        super().__init__(agents, config)
        
        # 保存关键组件
        self.coordinator_agent = coordinator_agent
        self.task_agent = task_agent
        self.workers = workers
        self.llm_provider = llm_provider
        self.planner = planner
        self.collaboration_intelligence = collaboration_intelligence
        
        # 创建 AgentExecutor（启用上下文编译）
        self.coordinator_executor = AgentExecutor(
            llm_provider=llm_provider,
            enable_context_compilation=True
        )
        self.task_executor = AgentExecutor(
            llm_provider=llm_provider,
            enable_context_compilation=True
        )
        self.worker_executor = AgentExecutor(
            llm_provider=llm_provider,
            enable_context_compilation=True
        )
        
        # 创建封装类
        self.coordinator = CoordinatorAgent(
            agent=coordinator_agent,
            executor=self.coordinator_executor
        )
        self.task_planner = TaskPlannerAgent(
            agent=task_agent,
            executor=self.task_executor
        )
        
        # 创建 Worker 实例
        self.worker_instances: List[Worker] = [
            SingleAgentWorker(agent=w, executor=self.worker_executor)
            for w in workers
        ]
        
        # 任务管理
        self._pending_tasks: deque = deque()
        self._task_dependencies: Dict[str, List[str]] = {}
        self._task_results: Dict[str, Dict[str, Any]] = {}
        self._task_failure_count: Dict[str, int] = {}
        
        # 事件日志
        self.event_log = event_log or EventLog(
            agent_id=self.collaboration_id,
            task_id=self.collaboration_id
        )
        
        # 故障处理配置
        self.failure_config = (
            config.failure_handling_config or FailureHandlingConfig()
        )
        
        # 执行模式
        self.mode = WorkforceMode(config.execution_mode)
        
        logger.info(
            f"[初始化] WorkforcePattern, coordinator: {coordinator_agent.name}, "
            f"task_planner: {task_agent.name}, workers: {len(workers)}"
        )
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行 Workforce 协作任务
        
        Args:
            task: 任务描述
            **kwargs: 额外参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        logger.info(f"[执行] WorkforcePattern, 任务: {task}")
        start_time = time.time()
        self.update_state(status=CollaborationStatus.RUNNING)
        
        try:
            # 创建主任务
            main_task = Task(
                description=task,
                expected_output="Task execution result"
            )
            
            # 异步执行（同步包装）
            result = asyncio.run(self._process_task_async(main_task))
            
            execution_time = time.time() - start_time
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=result.get("success", False),
                result=result.get("content", ""),
                execution_time=execution_time,
                iteration_count=self.state.current_iteration,
                agent_contributions=self._get_agent_contributions(),
                metadata={
                    "subtasks_count": len(self._task_results),
                    "workers_used": list(set(
                        r.get("worker_id") for r in self._task_results.values()
                        if r.get("worker_id")
                    )),
                }
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            self.update_state(status=CollaborationStatus.FAILED)
            logger.error(f"[异常] WorkforcePattern 执行失败: {e}", exc_info=True)
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=False,
                error=str(e),
                execution_time=execution_time,
                iteration_count=self.state.current_iteration
            )
    
    async def _process_task_async(self, task: Task) -> Dict[str, Any]:
        """
        异步处理任务（核心方法）
        
        Args:
            task: 要处理的任务
            
        Returns:
            任务执行结果
        """
        logger.info(f"[Workforce] Processing task: {task.id}")
        
        # 记录任务开始事件
        self.event_log.add_event(TaskStartEvent(
            task_description=task.description,
            agent_id=self.coordinator_agent.id,
            task_id=task.id
        ))
        
        # 1. 任务分解
        subtasks = await self.task_planner.decompose_task(
            task=task,
            available_workers=self.worker_instances,
        )
        
        if not subtasks:
            return {
                "success": False,
                "content": "Failed to decompose task",
                "failed": True,
            }
        
        logger.info(f"[Workforce] Decomposed into {len(subtasks)} subtasks")
        
        # 2. 任务分配
        assignment_map = await self.coordinator.assign_tasks(
            tasks=subtasks,
            workers=self.worker_instances,
        )
        
        # 3. 执行子任务（按依赖顺序）
        completed_tasks = set()
        while len(completed_tasks) < len(subtasks):
            # 找到可以执行的任务（依赖已完成）
            ready_tasks = [
                st for st in subtasks
                if st.id not in completed_tasks
                and all(dep in completed_tasks for dep in (st.dependencies or []))
            ]
            
            if not ready_tasks:
                # 检查是否有循环依赖或所有任务都失败
                failed_tasks = [
                    st.id for st in subtasks
                    if st.id not in completed_tasks
                    and self._task_failure_count.get(st.id, 0) >= self.failure_config.max_retries
                ]
                if failed_tasks:
                    return {
                        "success": False,
                        "content": f"Tasks failed after max retries: {failed_tasks}",
                        "failed": True,
                    }
                # 等待或重试
                await asyncio.sleep(0.1)
                continue
            
            # 并行执行就绪的任务
            tasks_to_execute = ready_tasks[:len(self.worker_instances)]  # 限制并发数
            
            for subtask in tasks_to_execute:
                worker_id = assignment_map.get(subtask.id)
                if not worker_id:
                    logger.warning(f"[Workforce] No worker assigned for task {subtask.id}")
                    continue
                
                # 找到对应的 Worker
                worker = next(
                    (w for w in self.worker_instances if w.id == worker_id),
                    None
                )
                if not worker:
                    logger.warning(f"[Workforce] Worker {worker_id} not found")
                    continue
                
                # 执行任务
                asyncio.create_task(self._execute_subtask(subtask, worker, task))
            
            # 等待一些任务完成
            await asyncio.sleep(0.5)
        
        # 4. 组合结果
        subtask_results = [
            self._task_results.get(st.id, {})
            for st in subtasks
        ]
        
        final_result = await self.task_planner.compose_results(
            parent_task=task,
            subtask_results=subtask_results,
        )
        
        # 记录任务结束事件
        self.event_log.add_event(TaskEndEvent(
            success=True,
            result=final_result,
            agent_id=self.task_agent.id,
            task_id=task.id
        ))
        
        return {
            "success": True,
            "content": final_result,
            "failed": False,
        }
    
    async def _execute_subtask(
        self,
        subtask: Task,
        worker: Worker,
        parent_task: Task,
    ):
        """执行子任务"""
        try:
            # 获取依赖任务的结果
            dependency_results = {}
            for dep_id in (subtask.dependencies or []):
                if dep_id in self._task_results:
                    dependency_results[dep_id] = self._task_results[dep_id]
            
            # 执行任务
            result = await worker.process_task(
                task=subtask,
                parent_task_content=parent_task.description,
                dependency_results=dependency_results,
            )
            
            # 检查是否需要故障恢复
            if result.get("failed", False):
                failure_count = self._task_failure_count.get(subtask.id, 0) + 1
                self._task_failure_count[subtask.id] = failure_count
                
                if failure_count < self.failure_config.max_retries:
                    # 尝试故障恢复（简化版，后续会实现完整的 FailureAnalyzer）
                    logger.warning(
                        f"[Workforce] Task {subtask.id} failed, "
                        f"attempt {failure_count}/{self.failure_config.max_retries}"
                    )
                    # TODO: 实现故障恢复策略
                else:
                    logger.error(f"[Workforce] Task {subtask.id} failed after max retries")
            
            # 保存结果
            self._task_results[subtask.id] = result
            
        except Exception as e:
            logger.error(f"[Workforce] Error executing subtask {subtask.id}: {e}")
            self._task_results[subtask.id] = {
                "success": False,
                "content": f"Error: {str(e)}",
                "failed": True,
                "error": str(e),
            }
    
    def _get_agent_contributions(self) -> Dict[str, Any]:
        """获取智能体贡献"""
        contributions = {}
        
        # 统计每个 Worker 执行的任务数
        for worker in self.worker_instances:
            task_count = sum(
                1 for r in self._task_results.values()
                if r.get("worker_id") == worker.id
            )
            contributions[worker.agent.id] = {
                "tasks_executed": task_count,
                "worker_name": worker.agent.name,
            }
        
        return contributions
