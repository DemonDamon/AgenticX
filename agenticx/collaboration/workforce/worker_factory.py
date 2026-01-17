"""
WorkerFactory - 动态 Worker 创建工厂

根据任务需求动态创建新的 Worker。
参考：camel/societies/workforce/workforce.py:_create_worker_for_task()
License: Apache 2.0 (CAMEL-AI.org)
"""

import logging
from typing import List, Optional, Dict, Any

from ...core.agent import Agent
from ...core.task import Task
from ...core.agent_executor import AgentExecutor
from ...core.discovery import DiscoveryBus, Discovery, DiscoveryType, DiscoveryPriority
from .worker import Worker, SingleAgentWorker
from .prompts import CREATE_NODE_PROMPT

logger = logging.getLogger(__name__)


class WorkerFactory:
    """Worker 工厂
    
    根据任务需求动态创建新的 Worker。
    """
    
    def __init__(
        self,
        coordinator_agent: Agent,
        executor: AgentExecutor,
        discovery_bus: Optional[DiscoveryBus] = None,
        organization_id: str = "default",
    ):
        """
        初始化 WorkerFactory
        
        Args:
            coordinator_agent: Coordinator Agent 实例（用于生成 Worker 配置）
            executor: AgentExecutor 实例
            discovery_bus: DiscoveryBus 实例（可选，用于发布 Worker 发现事件）
            organization_id: 组织 ID
        """
        self.coordinator_agent = coordinator_agent
        self.executor = executor
        self.discovery_bus = discovery_bus
        self.organization_id = organization_id
    
    async def create_worker_for_task(
        self,
        task: Task,
        existing_workers: List[Worker],
        additional_info: Optional[str] = None,
    ) -> Worker:
        """
        为任务创建新的 Worker
        
        Args:
            task: 需要新 Worker 的任务
            existing_workers: 现有的 Worker 列表
            additional_info: 额外信息（可选）
            
        Returns:
            新创建的 Worker 实例
        """
        logger.info(f"[WorkerFactory] Creating new worker for task: {task.id}")
        
        # 构建现有 Worker 信息字符串
        child_nodes_info = "\n".join([
            f"{worker.id}: {worker.description}: {worker.agent.role}"
            for worker in existing_workers
        ])
        
        # 构建 Prompt
        prompt = CREATE_NODE_PROMPT.format(
            content=task.description,
            additional_info=additional_info or "",
            child_nodes_info=child_nodes_info or "No existing workers",
        )
        
        # 调用 LLM 生成 Worker 配置
        task_obj = Task(
            description=prompt,
            expected_output="Worker configuration: role, system_message, description"
        )
        
        result = self.executor.run(self.coordinator_agent, task_obj)
        
        # 解析结果（简化版，实际应该解析结构化输出）
        output = result.get("result", result.get("output", ""))
        if isinstance(output, dict):
            output = str(output.get("content", output))
        
        # 解析 LLM 输出（简化版，实际应该使用结构化输出）
        worker_config = self._parse_worker_config(output, task)
        
        # 创建 Agent
        agent = Agent.fast_construct(
            name=worker_config["name"],
            role=worker_config["role"],
            goal=worker_config["goal"],
            organization_id=self.organization_id,
            backstory=worker_config.get("backstory"),
        )
        
        # 创建 Worker
        worker = SingleAgentWorker(
            agent=agent,
            executor=self.executor,
            description=worker_config["description"],
        )
        
        # 发布 Worker 发现事件
        if self.discovery_bus:
            await self._publish_worker_discovery(worker, task)
        
        logger.info(f"[WorkerFactory] Created worker: {worker.id} ({worker.description})")
        return worker
    
    def _parse_worker_config(
        self,
        llm_output: str,
        task: Task,
    ) -> Dict[str, Any]:
        """解析 LLM 输出，提取 Worker 配置"""
        # 简化版解析（实际应该使用结构化输出或更智能的解析）
        # 这里假设 LLM 输出包含 role、system_message、description
        
        # 尝试提取关键信息
        lines = llm_output.split('\n')
        config = {
            "name": f"Worker for {task.id}",
            "role": "worker",
            "goal": task.description[:100],  # 使用任务描述的前100字符
            "description": task.description[:200],  # 使用任务描述的前200字符
            "backstory": None,
        }
        
        # 尝试从输出中提取 role
        for line in lines:
            line_lower = line.lower()
            if "role" in line_lower or "角色" in line_lower:
                # 简单提取（实际应该更智能）
                parts = line.split(':')
                if len(parts) > 1:
                    config["role"] = parts[1].strip()
            elif "description" in line_lower or "描述" in line_lower:
                parts = line.split(':')
                if len(parts) > 1:
                    config["description"] = parts[1].strip()
        
        return config
    
    async def _publish_worker_discovery(
        self,
        worker: Worker,
        task: Task,
    ):
        """发布 Worker 发现事件"""
        if not self.discovery_bus:
            return
        
        discovery = Discovery(
            type=DiscoveryType.CAPABILITY,
            name=f"New Worker: {worker.description}",
            description=f"Created new worker {worker.id} for task {task.id}",
            source_worker_id=self.coordinator_agent.id,
            priority=DiscoveryPriority.MEDIUM,
            metadata={
                "worker_id": worker.id,
                "worker_role": worker.agent.role,
                "task_id": task.id,
                "created_for_task": task.description,
            },
        )
        
        await self.discovery_bus.publish(discovery)
        logger.info(f"[WorkerFactory] Published worker discovery: {worker.id}")
