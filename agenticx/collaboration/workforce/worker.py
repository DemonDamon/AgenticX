"""
Worker 基类和实现

内化自 CAMEL-AI 的 Worker 系统。
参考：camel/societies/workforce/worker.py, single_agent_worker.py
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
from datetime import datetime
from collections import deque

from ...core.agent import Agent
from ...core.task import Task
from ...core.agent_executor import AgentExecutor
from ...memory.short_term import ShortTermMemory

logger = logging.getLogger(__name__)


class Worker(ABC):
    """Worker 抽象基类
    
    参考：camel/societies/workforce/worker.py:Worker
    """
    
    def __init__(self, agent: Agent, description: Optional[str] = None):
        """
        初始化 Worker
        
        Args:
            agent: Worker 使用的 Agent
            description: Worker 描述
        """
        self.agent = agent
        self.description = description or agent.role
        self.id = agent.id
    
    @abstractmethod
    async def process_task(self, task: Task, **kwargs) -> Dict[str, Any]:
        """
        处理任务
        
        Args:
            task: 要处理的任务
            **kwargs: 额外参数
            
        Returns:
            任务执行结果
        """
        pass
    
    def get_info(self) -> str:
        """获取 Worker 信息字符串"""
        return f"{self.id}: {self.description}"


class SingleAgentWorker(Worker):
    """单智能体 Worker
    
    参考：camel/societies/workforce/single_agent_worker.py:SingleAgentWorker
    
    增强功能（参考 Eigent）：
    - enable_workflow_memory: 支持 Worker 之间的记忆传递
    - worker_attempts: 记录每次尝试的详情
    """
    
    def __init__(
        self,
        agent: Agent,
        executor: Optional[AgentExecutor] = None,
        description: Optional[str] = None,
        enable_workflow_memory: bool = False,
        max_memory_messages: int = 10,
    ):
        """
        初始化 SingleAgentWorker
        
        Args:
            agent: Worker 使用的 Agent
            executor: AgentExecutor 实例（可选）
            description: Worker 描述
            enable_workflow_memory: 是否启用工作流记忆传递
            max_memory_messages: 最大记忆消息数
        """
        super().__init__(agent, description)
        self.executor = executor
        self.enable_workflow_memory = enable_workflow_memory
        self.max_memory_messages = max_memory_messages
        
        # 工作流记忆（Worker 之间共享的对话历史）
        self._conversation_accumulator: Optional[deque] = None
        if enable_workflow_memory:
            self._conversation_accumulator = deque(maxlen=max_memory_messages)
        
        # Worker 尝试详情
        self.worker_attempts: List[Dict[str, Any]] = []
    
    async def process_task(
        self,
        task: Task,
        parent_task_content: Optional[str] = None,
        dependency_results: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        处理任务
        
        Args:
            task: 要处理的任务
            parent_task_content: 父任务内容（可选）
            dependency_results: 依赖任务的结果（可选）
            **kwargs: 额外参数
            
        Returns:
            任务执行结果
        """
        if not self.executor:
            raise ValueError("AgentExecutor is required for SingleAgentWorker")
        
        logger.info(f"[Worker] {self.agent.name} processing task: {task.id}")
        start_time = datetime.now()
        
        # 构建任务上下文
        if parent_task_content:
            task.context = task.context or {}
            task.context["parent_task"] = parent_task_content
        
        if dependency_results:
            task.context = task.context or {}
            task.context["dependency_results"] = dependency_results
        
        # 添加工作流记忆（如果启用）
        if self.enable_workflow_memory and self._conversation_accumulator is not None:
            task.context = task.context or {}
            task.context["workflow_memory"] = list(self._conversation_accumulator)
            logger.debug(
                f"[Worker] Injected {len(self._conversation_accumulator)} workflow memory messages"
            )
        
        # 执行任务
        try:
            result = self.executor.run(self.agent, task)
            
            # 提取结果
            if isinstance(result, dict):
                success = result.get("success", True)
                output = result.get("result", result.get("output", ""))
            else:
                success = True
                output = str(result)
            
            # 更新工作流记忆（如果启用）
            if self.enable_workflow_memory and self._conversation_accumulator is not None:
                self._conversation_accumulator.append({
                    "task_id": task.id,
                    "task_description": task.description,
                    "result": output,
                    "worker_id": self.id,
                    "timestamp": datetime.now(),
                })
                logger.debug("[Worker] Updated workflow memory with task result")
            
            # 记录尝试详情
            attempt = {
                "task_id": task.id,
                "success": success,
                "duration": (datetime.now() - start_time).total_seconds(),
                "timestamp": datetime.now(),
            }
            self.worker_attempts.append(attempt)
            
            return {
                "success": success,
                "content": output,
                "failed": not success,
                "task_id": task.id,
                "worker_id": self.id,
            }
        except Exception as e:
            logger.error(f"[Worker] Task {task.id} failed: {e}")
            
            # 记录失败尝试
            attempt = {
                "task_id": task.id,
                "success": False,
                "error": str(e),
                "duration": (datetime.now() - start_time).total_seconds(),
                "timestamp": datetime.now(),
            }
            self.worker_attempts.append(attempt)
            
            return {
                "success": False,
                "content": f"Task failed: {str(e)}",
                "failed": True,
                "task_id": task.id,
                "worker_id": self.id,
                "error": str(e),
            }
    
    def get_conversation_accumulator(self) -> Optional[List[Dict[str, Any]]]:
        """获取工作流记忆累积器
        
        Returns:
            记忆消息列表（如果启用）
        """
        if self._conversation_accumulator:
            return list(self._conversation_accumulator)
        return None
    
    def get_attempt_count(self) -> int:
        """获取尝试次数
        
        Returns:
            尝试次数
        """
        return len(self.worker_attempts)
    
    def get_attempt_history(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """获取尝试历史
        
        Args:
            limit: 限制返回数量
        
        Returns:
            尝试历史列表
        """
        if limit:
            return self.worker_attempts[-limit:]
        return self.worker_attempts.copy()
