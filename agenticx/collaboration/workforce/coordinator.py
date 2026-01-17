"""
Coordinator Agent 封装

负责任务分配和 Worker 创建。
参考：camel/societies/workforce/workforce.py:Coordinator Agent
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
from typing import List, Optional, Dict, Any
import json

from ...core.agent import Agent
from ...core.agent_executor import AgentExecutor
from ...core.task import Task
from .prompts import ASSIGN_TASK_PROMPT, COORDINATOR_AGENT_SYSTEM_MESSAGE

logger = logging.getLogger(__name__)


class CoordinatorAgent:
    """Coordinator Agent 封装
    
    负责任务分配和 Worker 创建决策。
    """
    
    def __init__(
        self,
        agent: Agent,
        executor: AgentExecutor,
    ):
        """
        初始化 Coordinator Agent
        
        Args:
            agent: Coordinator Agent 实例
            executor: AgentExecutor 实例
        """
        self.agent = agent
        self.executor = executor
        
        # 设置系统消息（如果未设置）
        if not hasattr(self.agent, 'system_message') or not self.agent.system_message:
            # 注意：Agent 模型可能没有 system_message 字段，这里只是示例
            pass
    
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
        logger.info(f"[Coordinator] Assigning {len(tasks)} tasks to {len(workers)} workers")
        
        # 构建任务信息字符串
        tasks_info = "\n".join([
            f"- Task ID: {task.id}\n  Description: {task.description}\n  Dependencies: {task.dependencies or []}"
            for task in tasks
        ])
        
        # 构建 Worker 信息字符串
        child_nodes_info = "\n".join([
            f"{worker.id}: {worker.description}: {worker.agent.role}"
            for worker in workers
        ])
        
        # 构建 Prompt
        prompt = ASSIGN_TASK_PROMPT.format(
            tasks_info=tasks_info,
            child_nodes_info=child_nodes_info
        )
        
        # 调用 LLM
        task_obj = Task(
            description=prompt,
            expected_output="JSON object with 'assignments' field"
        )
        
        result = self.executor.run(self.agent, task_obj)
        
        # 解析结果
        output = result.get("result", result.get("output", ""))
        if isinstance(output, dict):
            assignments_data = output
        else:
            # 尝试解析 JSON
            try:
                assignments_data = json.loads(output)
            except json.JSONDecodeError:
                logger.error(f"[Coordinator] Failed to parse assignment result: {output}")
                # 回退到简单分配
                return self._fallback_assign(tasks, workers)
        
        # 提取分配结果
        assignments = assignments_data.get("assignments", [])
        assignment_map = {}
        
        for assignment in assignments:
            task_id = assignment.get("task_id")
            assignee_id = assignment.get("assignee_id")
            dependencies = assignment.get("dependencies", [])
            
            if task_id and assignee_id:
                assignment_map[task_id] = assignee_id
                # 更新任务的依赖关系
                for task in tasks:
                    if task.id == task_id:
                        task.dependencies = dependencies
                        break
        
        logger.info(f"[Coordinator] Assigned {len(assignment_map)} tasks")
        return assignment_map
    
    def _fallback_assign(
        self,
        tasks: List[Task],
        workers: List[Any],
    ) -> Dict[str, str]:
        """回退分配策略（轮询）"""
        assignment_map = {}
        worker_index = 0
        
        for task in tasks:
            if workers:
                worker = workers[worker_index % len(workers)]
                assignment_map[task.id] = worker.id
                worker_index += 1
        
        return assignment_map
