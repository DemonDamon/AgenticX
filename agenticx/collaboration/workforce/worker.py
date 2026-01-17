"""
Worker 基类和实现

内化自 CAMEL-AI 的 Worker 系统。
参考：camel/societies/workforce/worker.py, single_agent_worker.py
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from datetime import datetime

from ...core.agent import Agent
from ...core.task import Task
from ...core.agent_executor import AgentExecutor

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
    """
    
    def __init__(
        self,
        agent: Agent,
        executor: Optional[AgentExecutor] = None,
        description: Optional[str] = None,
    ):
        """
        初始化 SingleAgentWorker
        
        Args:
            agent: Worker 使用的 Agent
            executor: AgentExecutor 实例（可选）
            description: Worker 描述
        """
        super().__init__(agent, description)
        self.executor = executor
    
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
        
        # 构建任务上下文
        if parent_task_content:
            task.context = task.context or {}
            task.context["parent_task"] = parent_task_content
        
        if dependency_results:
            task.context = task.context or {}
            task.context["dependency_results"] = dependency_results
        
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
            
            return {
                "success": success,
                "content": output,
                "failed": not success,
                "task_id": task.id,
                "worker_id": self.id,
            }
        except Exception as e:
            logger.error(f"[Worker] Task {task.id} failed: {e}")
            return {
                "success": False,
                "content": f"Task failed: {str(e)}",
                "failed": True,
                "task_id": task.id,
                "worker_id": self.id,
                "error": str(e),
            }
