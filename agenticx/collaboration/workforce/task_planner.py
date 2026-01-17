"""
Task Planner Agent 封装

负责任务分解和结果组合。
参考：camel/societies/workforce/workforce.py:Task Agent
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
from typing import List, Optional, Dict, Any
import re
import xml.etree.ElementTree as ET

from ...core.agent import Agent
from ...core.agent_executor import AgentExecutor
from ...core.task import Task
from .prompts import TASK_DECOMPOSE_PROMPT, TASK_AGENT_SYSTEM_MESSAGE

logger = logging.getLogger(__name__)


class TaskPlannerAgent:
    """Task Planner Agent 封装
    
    负责任务分解和结果组合。
    """
    
    def __init__(
        self,
        agent: Agent,
        executor: AgentExecutor,
    ):
        """
        初始化 Task Planner Agent
        
        Args:
            agent: Task Planner Agent 实例
            executor: AgentExecutor 实例
        """
        self.agent = agent
        self.executor = executor
    
    async def decompose_task(
        self,
        task: Task,
        available_workers: List[Any],  # List[Worker]
        additional_info: Optional[str] = None,
    ) -> List[Task]:
        """
        分解任务为子任务
        
        Args:
            task: 要分解的任务
            available_workers: 可用的 Worker 列表
            additional_info: 额外信息（可选）
            
        Returns:
            子任务列表
        """
        logger.info(f"[TaskPlanner] Decomposing task: {task.id}")
        
        # 构建 Worker 信息字符串
        child_nodes_info = "\n".join([
            f"{worker.id}: {worker.description}: {worker.agent.role}"
            for worker in available_workers
        ])
        
        # 构建 Prompt
        prompt = TASK_DECOMPOSE_PROMPT.format(
            content=task.description,
            additional_info=additional_info or "",
            child_nodes_info=child_nodes_info
        )
        
        # 调用 LLM
        task_obj = Task(
            description=prompt,
            expected_output="XML format with <tasks> root containing <task> elements"
        )
        
        result = self.executor.run(self.agent, task_obj)
        
        # 解析结果
        output = result.get("result", result.get("output", ""))
        if isinstance(output, dict):
            output = str(output.get("content", output))
        
        # 解析 XML 格式的子任务
        subtasks = self._parse_subtasks_xml(output, parent_task_id=task.id, task=task)
        
        logger.info(f"[TaskPlanner] Decomposed into {len(subtasks)} subtasks")
        return subtasks
    
    def _parse_subtasks_xml(
        self,
        xml_content: str,
        parent_task_id: str,
        task: Task,
    ) -> List[Task]:
        """解析 XML 格式的子任务"""
        subtasks = []
        
        try:
            # 尝试解析 XML
            root = ET.fromstring(f"<root>{xml_content}</root>")
            tasks_elem = root.find(".//tasks")
            
            if tasks_elem is not None:
                for i, task_elem in enumerate(tasks_elem.findall("task")):
                    task_text = task_elem.text or ""
                    if task_text.strip():
                        subtask = Task(
                            id=f"{parent_task_id}_subtask_{i+1}",
                            description=task_text.strip(),
                            expected_output="Task execution result",
                            dependencies=[],
                        )
                        subtasks.append(subtask)
            else:
                # 如果没有找到 <tasks>，尝试直接查找 <task>
                for i, task_elem in enumerate(root.findall(".//task")):
                    task_text = task_elem.text or ""
                    if task_text.strip():
                        subtask = Task(
                            id=f"{parent_task_id}_subtask_{i+1}",
                            description=task_text.strip(),
                            expected_output="Task execution result",
                            dependencies=[],
                        )
                        subtasks.append(subtask)
        except ET.ParseError:
            # XML 解析失败，尝试正则表达式提取
            logger.warning("[TaskPlanner] XML parsing failed, using regex fallback")
            pattern = r"<task>(.*?)</task>"
            matches = re.findall(pattern, xml_content, re.DOTALL)
            
            for i, match in enumerate(matches):
                task_text = match.strip()
                if task_text:
                    subtask = Task(
                        id=f"{parent_task_id}_subtask_{i+1}",
                        description=task_text,
                        expected_output="Task execution result",
                        dependencies=[],
                    )
                    subtasks.append(subtask)
        
        # 如果没有解析到任何子任务，创建一个包含原始任务的子任务
        if not subtasks:
            logger.warning("[TaskPlanner] No subtasks parsed, creating single subtask")
            subtasks.append(Task(
                id=f"{parent_task_id}_subtask_1",
                description=task.description,
                expected_output="Task execution result",
                dependencies=[],
            ))
        
        return subtasks
    
    async def compose_results(
        self,
        parent_task: Task,
        subtask_results: List[Dict[str, Any]],
    ) -> str:
        """
        组合子任务结果
        
        Args:
            parent_task: 父任务
            subtask_results: 子任务结果列表
            
        Returns:
            组合后的结果
        """
        logger.info(f"[TaskPlanner] Composing results for {len(subtask_results)} subtasks")
        
        # 简单的组合策略：拼接所有成功的结果
        successful_results = [
            result.get("content", "")
            for result in subtask_results
            if result.get("success", False)
        ]
        
        composed_result = "\n\n".join(successful_results)
        return composed_result
