"""
TaskDecomposer - 智能任务分解器

使用 LLM 动态分解复杂任务为自包含的子任务，结构化输出（Pydantic 模型）。
参考：camel/societies/workforce/workforce.py:_decompose_task()
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
import re
import xml.etree.ElementTree as ET
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field  # type: ignore

from ...core.agent import Agent
from ...core.task import Task
from ...core.agent_executor import AgentExecutor
from ...planner import AdaptivePlanner
from .prompts import TASK_DECOMPOSE_PROMPT

logger = logging.getLogger(__name__)


class SubtaskDefinition(BaseModel):
    """子任务定义（结构化输出）"""
    description: str = Field(description="子任务描述，必须是自包含的")
    expected_output: str = Field(description="期望的输出格式或内容")
    dependencies: List[str] = Field(default_factory=list, description="依赖的其他子任务ID列表")
    priority: int = Field(default=1, description="优先级（1-10，数字越大优先级越高）")
    estimated_time: Optional[float] = Field(default=None, description="预估执行时间（秒）")


class TaskDecompositionResult(BaseModel):
    """任务分解结果（结构化输出）"""
    subtasks: List[SubtaskDefinition] = Field(description="子任务列表")
    reasoning: str = Field(description="分解理由")
    can_parallelize: bool = Field(default=True, description="是否可以并行执行")


class TaskDecomposer:
    """任务分解器
    
    使用 LLM 动态分解复杂任务为自包含的子任务，结构化输出。
    """
    
    def __init__(
        self,
        task_agent: Agent,
        llm_provider,
        planner: Optional[AdaptivePlanner] = None,
    ):
        """
        初始化 TaskDecomposer
        
        Args:
            task_agent: Task Agent 实例（负责任务分解）
            llm_provider: LLM 提供者
            planner: AdaptivePlanner 实例（可选，用于任务分解优化）
        """
        self.task_agent = task_agent
        self.llm_provider = llm_provider
        self.planner = planner
        
        # 创建 AgentExecutor（启用上下文编译）
        self.executor = AgentExecutor(
            llm_provider=llm_provider,
            enable_context_compilation=True
        )
    
    async def decompose_task(
        self,
        task: Task,
        available_workers: List[Any],  # List[Worker]
        additional_info: Optional[str] = None,
    ) -> List[Task]:
        """
        分解任务为子任务（结构化输出）
        
        Args:
            task: 要分解的任务
            available_workers: 可用的 Worker 列表
            additional_info: 额外信息（可选）
            
        Returns:
            子任务列表（Task 对象）
        """
        logger.info(f"[TaskDecomposer] Decomposing task: {task.id}")
        
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
        
        result = self.executor.run(self.task_agent, task_obj)
        
        # 解析结果
        output = result.get("result", result.get("output", ""))
        if isinstance(output, dict):
            output = str(output.get("content", output))
        
        # 解析 XML 格式的子任务
        subtasks = self._parse_subtasks_xml(output, parent_task_id=task.id, fallback_description=task.description)
        
        # 如果使用 AdaptivePlanner，可以进行优化
        if self.planner and subtasks:
            subtasks = await self._optimize_with_planner(task, subtasks)
        
        logger.info(f"[TaskDecomposer] Decomposed into {len(subtasks)} subtasks")
        return subtasks
    
    def _parse_subtasks_xml(
        self,
        xml_content: str,
        parent_task_id: str,
        fallback_description: Optional[str] = None,
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
            logger.warning("[TaskDecomposer] XML parsing failed, using regex fallback")
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
            logger.warning("[TaskDecomposer] No subtasks parsed, creating single subtask")
            subtasks.append(Task(
                id=f"{parent_task_id}_subtask_1",
                description=fallback_description or "Task execution",
                expected_output="Task execution result",
                dependencies=[],
            ))
        
        return subtasks
    
    async def _optimize_with_planner(
        self,
        parent_task: Task,
        subtasks: List[Task],
    ) -> List[Task]:
        """使用 AdaptivePlanner 优化子任务列表"""
        if not self.planner:
            return subtasks
        
        try:
            # 这里可以调用 AdaptivePlanner 进行优化
            # 例如：检查依赖关系、合并相似任务、调整优先级等
            # 目前先返回原始列表，后续可以扩展
            logger.debug("[TaskDecomposer] Using AdaptivePlanner for optimization")
            return subtasks
        except Exception as e:
            logger.warning(f"[TaskDecomposer] Planner optimization failed: {e}")
            return subtasks
    
    async def decompose_task_structured(
        self,
        task: Task,
        available_workers: List[Any],
        additional_info: Optional[str] = None,
    ) -> TaskDecompositionResult:
        """
        分解任务为结构化结果（使用 Pydantic 模型）
        
        Args:
            task: 要分解的任务
            available_workers: 可用的 Worker 列表
            additional_info: 额外信息（可选）
            
        Returns:
            TaskDecompositionResult: 结构化分解结果
        """
        # 先使用 XML 格式分解
        subtask_tasks = await self.decompose_task(
            task=task,
            available_workers=available_workers,
            additional_info=additional_info,
        )
        
        # 转换为结构化格式
        subtask_definitions = []
        for i, subtask_task in enumerate(subtask_tasks):
            # 提取依赖关系
            dependencies = subtask_task.dependencies or []
            
            subtask_def = SubtaskDefinition(
                description=subtask_task.description,
                expected_output=subtask_task.expected_output or "Task execution result",
                dependencies=dependencies,
                priority=1,  # 默认优先级
            )
            subtask_definitions.append(subtask_def)
        
        # 分析是否可以并行执行
        can_parallelize = all(
            len(subtask_def.dependencies) == 0
            for subtask_def in subtask_definitions
        )
        
        return TaskDecompositionResult(
            subtasks=subtask_definitions,
            reasoning=f"Decomposed task '{task.id}' into {len(subtask_definitions)} subtasks",
            can_parallelize=can_parallelize,
        )
