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
from ...core.stream_accumulator import StreamContentAccumulator
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
from .events import WorkforceEventBus, WorkforceEvent, WorkforceAction

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
        event_bus: Optional[WorkforceEventBus] = None,
        enable_decompose_separation: bool = True,
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
            event_bus: WorkforceEventBus 实例（可选，用于事件通知）
            enable_decompose_separation: 是否启用任务分解和执行分离
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
        
        # 事件总线（新增：支持前端订阅）
        self.event_bus = event_bus or WorkforceEventBus(event_log=self.event_log)
        self.enable_decompose_separation = enable_decompose_separation
        
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
    
    async def decompose_task(
        self,
        task: Task,
        coordinator_context: Optional[str] = None,
        on_stream_batch: Optional[Any] = None,
        on_stream_text: Optional[Any] = None,
    ) -> List[Task]:
        """
        分解任务为子任务（不执行）
        
        参考 Eigent eigent_make_sub_tasks 实现。
        支持流式显示分解过程和 Coordinator Context 注入。
        
        Args:
            task: 主任务
            coordinator_context: Coordinator 专用上下文（不传递给 Worker）
            on_stream_batch: 流式批次回调 (subtasks: List[Task], is_final: bool)
            on_stream_text: 流式文本回调 (text: str)
        
        Returns:
            子任务列表
        """
        logger.info(f"[Workforce] Decomposing task: {task.id}")
        
        # 发送分解开始事件
        if self.event_bus:
            self.event_bus.publish(WorkforceEvent(
                action=WorkforceAction.DECOMPOSE_START,
                data={"task_id": task.id, "task_description": task.description},
                task_id=task.id,
            ))
        
        try:
            # 注入 Coordinator Context（仅在分解阶段）
            original_content = task.description
            if coordinator_context:
                task.description = f"{coordinator_context}\n=== CURRENT TASK ===\n{original_content}"
                logger.debug("[Workforce] Injected coordinator context for decomposition")
            
            # 任务分解
            subtasks = await self.task_planner.decompose_task(
                task=task,
                available_workers=self.worker_instances,
            )
            
            # 恢复原始任务内容（Invariant: 不污染 Worker 上下文）
            task.description = original_content
            
            if not subtasks:
                logger.warning("[Workforce] Task decomposition returned no subtasks")
                if self.event_bus:
                    self.event_bus.publish(WorkforceEvent(
                        action=WorkforceAction.DECOMPOSE_FAILED,
                        data={"task_id": task.id, "error": "No subtasks generated"},
                        task_id=task.id,
                    ))
                return []
            
            logger.info(f"[Workforce] Decomposed into {len(subtasks)} subtasks")
            
            # 流式批次回调
            if on_stream_batch:
                try:
                    on_stream_batch(subtasks, is_final=True)
                except Exception as e:
                    logger.error(f"Stream batch callback error: {e}")
            
            # 发送分解完成事件
            if self.event_bus:
                self.event_bus.publish(WorkforceEvent(
                    action=WorkforceAction.DECOMPOSE_COMPLETE,
                    data={
                        "task_id": task.id,
                        "subtasks_count": len(subtasks),
                        "subtasks": [{"id": st.id, "description": st.description} for st in subtasks],
                    },
                    task_id=task.id,
                ))
            
            return subtasks
            
        except Exception as e:
            # 恢复原始任务内容
            task.description = original_content
            
            logger.error(f"[Workforce] Task decomposition failed: {e}")
            
            # 发送分解失败事件
            if self.event_bus:
                self.event_bus.publish(WorkforceEvent(
                    action=WorkforceAction.DECOMPOSE_FAILED,
                    data={"task_id": task.id, "error": str(e)},
                    task_id=task.id,
                ))
            
            raise
    
    async def start_execution(
        self,
        subtasks: List[Task],
        parent_task: Optional[Task] = None,
    ) -> Dict[str, Any]:
        """
        启动任务执行（使用预分解的子任务）
        
        参考 Eigent eigent_start 实现。
        
        Args:
            subtasks: 预分解的子任务列表
            parent_task: 父任务（可选）
        
        Returns:
            执行结果
        """
        if not subtasks:
            logger.warning("[Workforce] No subtasks to execute")
            return {
                "success": False,
                "content": "No subtasks to execute",
                "failed": True,
            }
        
        logger.info(f"[Workforce] Starting execution of {len(subtasks)} subtasks")
        
        # 发送 Workforce 启动事件
        if self.event_bus:
            self.event_bus.publish(WorkforceEvent(
                action=WorkforceAction.WORKFORCE_STARTED,
                data={"subtasks_count": len(subtasks)},
            ))
        
        try:
            # 创建临时的父任务（如果未提供）
            if not parent_task:
                parent_task = Task(
                    description="Parent task",
                    expected_output="Task execution result"
                )
            
            # 任务分配
            assignment_map = await self.coordinator.assign_tasks(
                tasks=subtasks,
                workers=self.worker_instances,
            )
            
            # 执行子任务（按依赖顺序）
            completed_tasks = set()
            max_iterations = len(subtasks) * 10  # 防止死循环
            iteration = 0
            
            while len(completed_tasks) < len(subtasks):
                iteration += 1
                if iteration > max_iterations:
                    logger.error("[Workforce] Max iterations reached, breaking execution loop")
                    break
                
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
                tasks_to_execute = ready_tasks[:len(self.worker_instances)]
                execution_tasks = []
                
                for subtask in tasks_to_execute:
                    worker_id = assignment_map.get(subtask.id)
                    if not worker_id:
                        logger.warning(f"[Workforce] No worker assigned for task {subtask.id}")
                        # 标记为完成（失败）
                        completed_tasks.add(subtask.id)
                        continue
                    
                    # 找到对应的 Worker
                    worker = next(
                        (w for w in self.worker_instances if w.id == worker_id),
                        None
                    )
                    if not worker:
                        logger.warning(f"[Workforce] Worker {worker_id} not found")
                        # 标记为完成（失败）
                        completed_tasks.add(subtask.id)
                        continue
                    
                    # 执行任务
                    exec_task = asyncio.create_task(self._execute_subtask(subtask, worker, parent_task))
                    execution_tasks.append((subtask.id, exec_task))
                
                # 等待所有任务完成
                if execution_tasks:
                    await asyncio.gather(*[t[1] for t in execution_tasks], return_exceptions=True)
                    # 标记任务为完成
                    for task_id, _ in execution_tasks:
                        completed_tasks.add(task_id)
            
            # 组合结果
            subtask_results = [
                self._task_results.get(st.id, {})
                for st in subtasks
            ]
            
            final_result = await self.task_planner.compose_results(
                parent_task=parent_task,
                subtask_results=subtask_results,
            )
            
            # 发送 Workforce 停止事件
            if self.event_bus:
                self.event_bus.publish(WorkforceEvent(
                    action=WorkforceAction.WORKFORCE_STOPPED,
                    data={"success": True},
                ))
            
            return {
                "success": True,
                "content": final_result,
                "failed": False,
            }
            
        except Exception as e:
            logger.error(f"[Workforce] Execution failed: {e}")
            
            # 发送 Workforce 停止事件
            if self.event_bus:
                self.event_bus.publish(WorkforceEvent(
                    action=WorkforceAction.WORKFORCE_STOPPED,
                    data={"success": False, "error": str(e)},
                ))
            
            raise
    
    async def is_simple_question(
        self,
        question: str,
        conversation_context: Optional[str] = None,
    ) -> bool:
        """
        判断是否为简单问题（不需要启动 Workforce）
        
        参考 Eigent question_confirm 实现。
        
        策略:
        1. 关键词快速判断
        2. 使用 LLM 判断（通过 task_agent）
        
        Args:
            question: 用户问题
            conversation_context: 对话上下文（可选）
        
        Returns:
            bool: True 表示简单问题，False 表示复杂任务
        """
        # 快速路径：关键词匹配
        simple_keywords = [
            "hello", "hi", "thanks", "thank you", "what is", "who is",
            "how are you", "你好", "谢谢", "什么是"
        ]
        question_lower = question.lower()
        
        # 如果问题很短且包含简单关键词
        if len(question) < 50:
            for keyword in simple_keywords:
                if keyword in question_lower:
                    logger.debug(f"[Workforce] Detected simple question by keyword: {keyword}")
                    return True
        
        # LLM 判断
        prompt = f"""Determine if this user query is a complex task or a simple question.

**Complex task** (answer "yes"): Requires tools, code execution, file operations, multi-step planning, or creating/modifying content
- Examples: "create a file", "search for X", "implement feature Y", "write code", "analyze data", "build something"

**Simple question** (answer "no"): Can be answered directly with knowledge or conversation history, no action needed
- Examples: greetings ("hello", "hi"), fact queries ("what is X?"), clarifications ("what did you mean?"), status checks ("how are you?")

User Query: {question}

Answer only "yes" or "no". Do not provide any explanation.

Is this a complex task? (yes/no):"""
        
        if conversation_context:
            prompt = f"{conversation_context}\n\n{prompt}"
        
        try:
            # 创建临时任务
            temp_task = Task(
                description=prompt,
                expected_output="yes or no"
            )
            
            # 使用 task_executor 执行判断
            result = self.task_executor.run(self.task_agent, temp_task)
            
            # 解析结果
            if isinstance(result, dict):
                content = result.get("result", result.get("output", ""))
            else:
                content = str(result)
            
            normalized = content.strip().lower()
            is_complex = "yes" in normalized
            
            logger.info(
                f"[Workforce] Question complexity: "
                f"{'complex task' if is_complex else 'simple question'}"
            )
            
            # 返回是否为简单问题
            return not is_complex
            
        except Exception as e:
            logger.error(f"[Workforce] Error in is_simple_question: {e}")
            # 默认为复杂任务（安全降级）
            return False
    
    async def answer_simple_question(
        self,
        question: str,
        conversation_context: Optional[str] = None,
    ) -> str:
        """
        直接回答简单问题（不启动 Workforce）
        
        Args:
            question: 用户问题
            conversation_context: 对话上下文（可选）
        
        Returns:
            回答内容
        """
        logger.info(f"[Workforce] Answering simple question directly")
        
        prompt = f"""User Query: {question}

Provide a direct, helpful answer to this simple question."""
        
        if conversation_context:
            prompt = f"{conversation_context}\n\n{prompt}"
        
        try:
            # 创建临时任务
            temp_task = Task(
                description=prompt,
                expected_output="Direct answer"
            )
            
            # 使用 task_executor 执行
            result = self.task_executor.run(self.task_agent, temp_task)
            
            # 解析结果
            if isinstance(result, dict):
                answer = result.get("result", result.get("output", ""))
            else:
                answer = str(result)
            
            logger.debug(f"[Workforce] Simple answer: {answer[:100]}...")
            return answer
            
        except Exception as e:
            logger.error(f"[Workforce] Error answering simple question: {e}")
            return f"I understand your question, but I'm having trouble generating a response right now. Error: {str(e)}"
