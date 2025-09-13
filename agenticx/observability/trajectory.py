"""
AgenticX M9: 执行轨迹收集 (Trajectory Collection)

本模块实现了执行轨迹的收集和管理功能，记录智能体的完整执行路径。
轨迹数据是分析和优化的重要基础，支持故障分析、性能评估和行为理解。
"""

import uuid
from typing import Dict, Any, List, Optional, Union
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import json
from collections import defaultdict

from .callbacks import BaseCallbackHandler, CallbackHandlerConfig
from ..core.event import (
    AnyEvent, TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent,
    ErrorEvent, LLMCallEvent, LLMResponseEvent, HumanRequestEvent,
    HumanResponseEvent, FinishTaskEvent, EventLog
)
from ..core.agent import Agent
from ..core.task import Task
from ..core.workflow import Workflow
from ..llms.response import LLMResponse


class StepType(Enum):
    """轨迹步骤类型"""
    TASK_START = "task_start"
    TASK_END = "task_end"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    LLM_CALL = "llm_call"
    LLM_RESPONSE = "llm_response"
    HUMAN_REQUEST = "human_request"
    HUMAN_RESPONSE = "human_response"
    ERROR = "error"
    FINISH_TASK = "finish_task"


class StepStatus(Enum):
    """步骤状态"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class TrajectoryStep:
    """
    轨迹步骤
    
    记录执行过程中的单个步骤，包含时间、类型、状态和详细数据。
    """
    step_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    step_type: StepType = StepType.TASK_START
    status: StepStatus = StepStatus.PENDING
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    duration: Optional[float] = None
    
    # 执行上下文
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    workflow_id: Optional[str] = None
    
    # 步骤数据
    input_data: Dict[str, Any] = field(default_factory=dict)
    output_data: Dict[str, Any] = field(default_factory=dict)
    error_data: Optional[Dict[str, Any]] = None
    
    # 元数据
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "step_id": self.step_id,
            "step_type": self.step_type.value,
            "status": self.status.value,
            "timestamp": self.timestamp.isoformat(),
            "duration": self.duration,
            "agent_id": self.agent_id,
            "task_id": self.task_id,
            "workflow_id": self.workflow_id,
            "input_data": self.input_data,
            "output_data": self.output_data,
            "error_data": self.error_data,
            "metadata": self.metadata
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TrajectoryStep':
        """从字典创建"""
        return cls(
            step_id=data["step_id"],
            step_type=StepType(data["step_type"]),
            status=StepStatus(data["status"]),
            timestamp=datetime.fromisoformat(data["timestamp"]),
            duration=data.get("duration"),
            agent_id=data.get("agent_id"),
            task_id=data.get("task_id"),
            workflow_id=data.get("workflow_id"),
            input_data=data.get("input_data", {}),
            output_data=data.get("output_data", {}),
            error_data=data.get("error_data"),
            metadata=data.get("metadata", {})
        )


@dataclass
class TrajectoryMetadata:
    """轨迹元数据"""
    trajectory_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    total_duration: Optional[float] = None
    
    # 执行上下文
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    workflow_id: Optional[str] = None
    
    # 统计信息
    total_steps: int = 0
    successful_steps: int = 0
    failed_steps: int = 0
    
    # 资源使用
    total_tokens: int = 0
    total_cost: float = 0.0
    
    # 执行结果
    final_status: Optional[StepStatus] = None
    final_result: Optional[Any] = None
    
    # 自定义标签
    tags: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "trajectory_id": self.trajectory_id,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "total_duration": self.total_duration,
            "agent_id": self.agent_id,
            "task_id": self.task_id,
            "workflow_id": self.workflow_id,
            "total_steps": self.total_steps,
            "successful_steps": self.successful_steps,
            "failed_steps": self.failed_steps,
            "total_tokens": self.total_tokens,
            "total_cost": self.total_cost,
            "final_status": self.final_status.value if self.final_status else None,
            "final_result": self.final_result,
            "tags": self.tags
        }


class ExecutionTrajectory:
    """
    执行轨迹
    
    记录完整的执行过程，包含所有步骤和元数据。
    """
    
    def __init__(self, 
                 trajectory_id: Optional[str] = None,
                 agent_id: Optional[str] = None,
                 task_id: Optional[str] = None,
                 workflow_id: Optional[str] = None):
        self.trajectory_id = trajectory_id or str(uuid.uuid4())
        self.metadata = TrajectoryMetadata(
            trajectory_id=self.trajectory_id,
            start_time=datetime.now(UTC),
            agent_id=agent_id,
            task_id=task_id,
            workflow_id=workflow_id
        )
        self.steps: List[TrajectoryStep] = []
        self.current_step: Optional[TrajectoryStep] = None
        
        # 索引用于快速查找
        self._step_index: Dict[str, TrajectoryStep] = {}
        self._steps_by_type: Dict[StepType, List[TrajectoryStep]] = defaultdict(list)
        
    def add_step(self, step: TrajectoryStep):
        """添加步骤"""
        self.steps.append(step)
        self._step_index[step.step_id] = step
        self._steps_by_type[step.step_type].append(step)
        
        # 更新元数据
        self.metadata.total_steps += 1
        if step.status == StepStatus.COMPLETED:
            self.metadata.successful_steps += 1
        elif step.status == StepStatus.FAILED:
            self.metadata.failed_steps += 1
    
    def update_step_status(self, step_id: str, new_status: StepStatus):
        """更新步骤状态并重新计算计数"""
        step = self.get_step_by_id(step_id)
        if step:
            old_status = step.status
            step.status = new_status
            
            # 更新计数
            if old_status == StepStatus.COMPLETED:
                self.metadata.successful_steps -= 1
            elif old_status == StepStatus.FAILED:
                self.metadata.failed_steps -= 1
            
            if new_status == StepStatus.COMPLETED:
                self.metadata.successful_steps += 1
            elif new_status == StepStatus.FAILED:
                self.metadata.failed_steps += 1
    
    def recalculate_step_counts(self):
        """重新计算步骤计数"""
        self.metadata.successful_steps = 0
        self.metadata.failed_steps = 0
        
        for step in self.steps:
            if step.status == StepStatus.COMPLETED:
                self.metadata.successful_steps += 1
            elif step.status == StepStatus.FAILED:
                self.metadata.failed_steps += 1
    
    def get_step_by_id(self, step_id: str) -> Optional[TrajectoryStep]:
        """根据ID获取步骤"""
        return self._step_index.get(step_id)
    
    def get_steps_by_type(self, step_type: StepType) -> List[TrajectoryStep]:
        """根据类型获取步骤"""
        return self._steps_by_type.get(step_type, [])
    
    def get_steps_by_status(self, status: StepStatus) -> List[TrajectoryStep]:
        """根据状态获取步骤"""
        return [step for step in self.steps if step.status == status]
    
    def get_failed_steps(self) -> List[TrajectoryStep]:
        """获取失败的步骤"""
        return self.get_steps_by_status(StepStatus.FAILED)
    
    def get_tool_calls(self) -> List[TrajectoryStep]:
        """获取所有工具调用"""
        return self.get_steps_by_type(StepType.TOOL_CALL)
    
    def get_llm_calls(self) -> List[TrajectoryStep]:
        """获取所有LLM调用"""
        return self.get_steps_by_type(StepType.LLM_CALL)
    
    def get_errors(self) -> List[TrajectoryStep]:
        """获取所有错误"""
        return self.get_steps_by_type(StepType.ERROR)
    
    def finalize(self, final_status: StepStatus, final_result: Optional[Any] = None):
        """完成轨迹记录"""
        self.metadata.end_time = datetime.now(UTC)
        self.metadata.total_duration = (
            self.metadata.end_time - self.metadata.start_time
        ).total_seconds()
        self.metadata.final_status = final_status
        self.metadata.final_result = final_result
        
        # 计算资源使用
        self._calculate_resource_usage()
    
    def _calculate_resource_usage(self):
        """计算资源使用情况"""
        total_tokens = 0
        total_cost = 0.0
        
        for step in self.steps:
            if step.step_type == StepType.LLM_RESPONSE:
                token_usage = step.output_data.get("token_usage", {})
                if isinstance(token_usage, dict):
                    total_tokens += token_usage.get("total_tokens", 0)
                
                cost = step.output_data.get("cost", 0.0)
                if isinstance(cost, (int, float)):
                    total_cost += cost
        
        self.metadata.total_tokens = total_tokens
        self.metadata.total_cost = total_cost
    
    def get_execution_timeline(self) -> List[Dict[str, Any]]:
        """获取执行时间线"""
        timeline = []
        for step in self.steps:
            timeline.append({
                "timestamp": step.timestamp.isoformat(),
                "step_type": step.step_type.value,
                "status": step.status.value,
                "description": self._get_step_description(step),
                "duration": step.duration
            })
        return timeline
    
    def _get_step_description(self, step: TrajectoryStep) -> str:
        """获取步骤描述"""
        if step.step_type == StepType.TASK_START:
            return f"开始任务: {step.input_data.get('task_description', 'Unknown')}"
        elif step.step_type == StepType.TASK_END:
            return f"结束任务: {'成功' if step.status == StepStatus.COMPLETED else '失败'}"
        elif step.step_type == StepType.TOOL_CALL:
            return f"调用工具: {step.input_data.get('tool_name', 'Unknown')}"
        elif step.step_type == StepType.LLM_CALL:
            return f"LLM调用: {step.input_data.get('model', 'Unknown')}"
        elif step.step_type == StepType.ERROR:
            # 修复：添加对error_data为None的检查
            if step.error_data:
                return f"错误: {step.error_data.get('error_message', 'Unknown error')}"
            else:
                return "错误: Unknown error"
        else:
            return f"{step.step_type.value}"
    
    def get_summary(self) -> Dict[str, Any]:
        """获取轨迹摘要"""
        return {
            "trajectory_id": self.trajectory_id,
            "metadata": self.metadata.to_dict(),
            "step_counts": {
                step_type.value: len(steps)
                for step_type, steps in self._steps_by_type.items()
            },
            "status_counts": {
                status.value: len(self.get_steps_by_status(status))
                for status in StepStatus
            },
            "execution_timeline": self.get_execution_timeline(),
            "resource_usage": {
                "total_tokens": self.metadata.total_tokens,
                "total_cost": self.metadata.total_cost
            },
            "errors": [
                {
                    "step_id": step.step_id,
                    "error_type": step.error_data.get("error_type") if step.error_data else None,
                    "error_message": step.error_data.get("error_message") if step.error_data else None
                }
                for step in self.get_errors()
            ]
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "trajectory_id": self.trajectory_id,
            "metadata": self.metadata.to_dict(),
            "steps": [step.to_dict() for step in self.steps]
        }
    
    def to_json(self) -> str:
        """转换为JSON字符串"""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ExecutionTrajectory':
        """从字典创建"""
        trajectory = cls(trajectory_id=data["trajectory_id"])
        
        # 设置元数据
        metadata_data = data["metadata"]
        trajectory.metadata = TrajectoryMetadata(
            trajectory_id=metadata_data["trajectory_id"],
            start_time=datetime.fromisoformat(metadata_data["start_time"]),
            end_time=datetime.fromisoformat(metadata_data["end_time"]) if metadata_data.get("end_time") else None,
            total_duration=metadata_data.get("total_duration"),
            agent_id=metadata_data.get("agent_id"),
            task_id=metadata_data.get("task_id"),
            workflow_id=metadata_data.get("workflow_id"),
            total_steps=metadata_data.get("total_steps", 0),
            successful_steps=metadata_data.get("successful_steps", 0),
            failed_steps=metadata_data.get("failed_steps", 0),
            total_tokens=metadata_data.get("total_tokens", 0),
            total_cost=metadata_data.get("total_cost", 0.0),
            final_status=StepStatus(metadata_data["final_status"]) if metadata_data.get("final_status") else None,
            final_result=metadata_data.get("final_result"),
            tags=metadata_data.get("tags", [])
        )
        
        # 添加步骤
        for step_data in data["steps"]:
            trajectory.add_step(TrajectoryStep.from_dict(step_data))
        
        return trajectory
    
    @classmethod
    def from_json(cls, json_str: str) -> 'ExecutionTrajectory':
        """从JSON字符串创建"""
        data = json.loads(json_str)
        return cls.from_dict(data)


class TrajectoryCollector(BaseCallbackHandler):
    """
    轨迹收集器
    
    收集执行过程中的所有事件，构建完整的执行轨迹。
    """
    
    def __init__(self, 
                 auto_finalize: bool = True,
                 store_trajectories: bool = True,
                 max_trajectories: int = 100,
                 config: Optional[CallbackHandlerConfig] = None):
        super().__init__(config)
        
        self.auto_finalize = auto_finalize
        self.store_trajectories = store_trajectories
        self.max_trajectories = max_trajectories
        
        # 活跃轨迹（正在记录中的轨迹）
        self.active_trajectories: Dict[str, ExecutionTrajectory] = {}
        
        # 已完成轨迹
        self.completed_trajectories: List[ExecutionTrajectory] = []
        
        # 当前步骤跟踪
        self.pending_steps: Dict[str, TrajectoryStep] = {}
    
    def _get_trajectory_key(self, agent_id: str, task_id: str) -> str:
        """获取轨迹键"""
        return f"{agent_id}:{task_id}"
    
    def _get_or_create_trajectory(self, agent_id: str, task_id: str, workflow_id: Optional[str] = None) -> ExecutionTrajectory:
        """获取或创建轨迹"""
        key = self._get_trajectory_key(agent_id, task_id)
        
        if key not in self.active_trajectories:
            self.active_trajectories[key] = ExecutionTrajectory(
                agent_id=agent_id,
                task_id=task_id,
                workflow_id=workflow_id
            )
        
        return self.active_trajectories[key]
    
    def _handle_task_start_event(self, event: TaskStartEvent):
        """处理任务开始事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        step = TrajectoryStep(
            step_type=StepType.TASK_START,
            status=StepStatus.IN_PROGRESS,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            input_data={
                "task_description": event.task_description,
                "event_data": event.data
            }
        )
        
        trajectory.add_step(step)
        trajectory.current_step = step
    
    def _handle_task_end_event(self, event: TaskEndEvent):
        """处理任务结束事件"""
        if not event.agent_id or not event.task_id:
            return
        
        key = self._get_trajectory_key(event.agent_id, event.task_id)
        if key not in self.active_trajectories:
            return
        
        trajectory = self.active_trajectories[key]
        
        # 查找并更新对应的 task_start 步骤状态
        task_start_step = None
        for step in trajectory.steps:
            if (step.step_type == StepType.TASK_START and 
                step.agent_id == event.agent_id and 
                step.task_id == event.task_id and
                step.status == StepStatus.IN_PROGRESS):
                task_start_step = step
                break
        
        if task_start_step:
            # 更新 task_start 步骤状态
            task_start_status = StepStatus.COMPLETED if event.success else StepStatus.FAILED
            trajectory.update_step_status(task_start_step.step_id, task_start_status)
            
            # 设置 task_start 步骤的持续时间
            task_start_step.duration = (event.timestamp - task_start_step.timestamp).total_seconds()
        
        step = TrajectoryStep(
            step_type=StepType.TASK_END,
            status=StepStatus.COMPLETED if event.success else StepStatus.FAILED,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            input_data={"success": event.success},
            output_data={"result": event.result}
        )
        
        trajectory.add_step(step)
        
        # 如果启用自动完成，则完成轨迹
        if self.auto_finalize:
            final_status = StepStatus.COMPLETED if event.success else StepStatus.FAILED
            trajectory.finalize(final_status, event.result)
            
            # 移动到已完成轨迹
            if self.store_trajectories:
                self.completed_trajectories.append(trajectory)
                
                # 限制存储数量
                if len(self.completed_trajectories) > self.max_trajectories:
                    self.completed_trajectories.pop(0)
            
            # 从活跃轨迹中移除
            del self.active_trajectories[key]
    
    def _handle_tool_call_event(self, event: ToolCallEvent):
        """处理工具调用事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        step = TrajectoryStep(
            step_type=StepType.TOOL_CALL,
            status=StepStatus.IN_PROGRESS,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            input_data={
                "tool_name": event.tool_name,
                "tool_args": event.tool_args,
                "intent": event.intent
            }
        )
        
        trajectory.add_step(step)
        self.pending_steps[event.id] = step
    
    def _handle_tool_result_event(self, event: ToolResultEvent):
        """处理工具结果事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        # 查找对应的工具调用步骤
        tool_call_step = None
        for step in reversed(trajectory.steps):
            if (step.step_type == StepType.TOOL_CALL and 
                step.input_data.get("tool_name") == event.tool_name and
                step.status == StepStatus.IN_PROGRESS):
                tool_call_step = step
                break
        
        if tool_call_step:
            # 更新工具调用步骤
            new_status = StepStatus.COMPLETED if event.success else StepStatus.FAILED
            trajectory.update_step_status(tool_call_step.step_id, new_status)
            tool_call_step.duration = (event.timestamp - tool_call_step.timestamp).total_seconds()
            tool_call_step.output_data = {
                "result": event.result,
                "success": event.success
            }
            if event.error:
                tool_call_step.error_data = {"error": event.error}
        
        # 创建工具结果步骤
        result_step = TrajectoryStep(
            step_type=StepType.TOOL_RESULT,
            status=StepStatus.COMPLETED if event.success else StepStatus.FAILED,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            input_data={"tool_name": event.tool_name},
            output_data={
                "result": event.result,
                "success": event.success
            }
        )
        
        if event.error:
            result_step.error_data = {"error": event.error}
        
        trajectory.add_step(result_step)
    
    def _handle_llm_call_event(self, event: LLMCallEvent):
        """处理LLM调用事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        step = TrajectoryStep(
            step_type=StepType.LLM_CALL,
            status=StepStatus.IN_PROGRESS,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            input_data={
                "model": event.model,
                "prompt": event.prompt,
                "metadata": event.data
            }
        )
        
        trajectory.add_step(step)
        self.pending_steps[event.id] = step
    
    def _handle_llm_response_event(self, event: LLMResponseEvent):
        """处理LLM响应事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        # 查找对应的LLM调用步骤
        llm_call_step = None
        for step in reversed(trajectory.steps):
            if (step.step_type == StepType.LLM_CALL and 
                step.input_data.get("model") == event.data.get("model") and
                step.status == StepStatus.IN_PROGRESS):
                llm_call_step = step
                break
        
        if llm_call_step:
            # 更新LLM调用步骤
            llm_call_step.status = StepStatus.COMPLETED
            llm_call_step.duration = (event.timestamp - llm_call_step.timestamp).total_seconds()
            llm_call_step.output_data = {
                "response": event.response,
                "token_usage": event.token_usage or {},
                "cost": event.cost or 0.0
            }
        
        # 创建LLM响应步骤
        response_step = TrajectoryStep(
            step_type=StepType.LLM_RESPONSE,
            status=StepStatus.COMPLETED,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            input_data={"model": event.data.get("model", "unknown")},
            output_data={
                "response": event.response,
                "token_usage": event.token_usage or {},
                "cost": event.cost or 0.0
            }
        )
        
        trajectory.add_step(response_step)
    
    def _handle_error_event(self, event: ErrorEvent):
        """处理错误事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        step = TrajectoryStep(
            step_type=StepType.ERROR,
            status=StepStatus.FAILED,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            error_data={
                "error_type": event.error_type,
                "error_message": event.error_message,
                "recoverable": event.recoverable,
                "event_data": event.data
            }
        )
        
        trajectory.add_step(step)
    
    def _handle_human_request_event(self, event: HumanRequestEvent):
        """处理人工请求事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        step = TrajectoryStep(
            step_type=StepType.HUMAN_REQUEST,
            status=StepStatus.IN_PROGRESS,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            input_data=event.data
        )
        
        trajectory.add_step(step)
    
    def _handle_human_response_event(self, event: HumanResponseEvent):
        """处理人工响应事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        # 查找对应的人工请求步骤
        request_step = None
        for step in reversed(trajectory.steps):
            if (step.step_type == StepType.HUMAN_REQUEST and 
                step.status == StepStatus.IN_PROGRESS):
                request_step = step
                break
        
        if request_step:
            # 更新人工请求步骤
            request_step.status = StepStatus.COMPLETED
            request_step.duration = (event.timestamp - request_step.timestamp).total_seconds()
            request_step.output_data = event.data
        
        # 创建人工响应步骤
        response_step = TrajectoryStep(
            step_type=StepType.HUMAN_RESPONSE,
            status=StepStatus.COMPLETED,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            input_data=event.data
        )
        
        trajectory.add_step(response_step)
    
    def _handle_finish_task_event(self, event: FinishTaskEvent):
        """处理任务完成事件"""
        if not event.agent_id or not event.task_id:
            return
        
        trajectory = self._get_or_create_trajectory(
            event.agent_id, event.task_id
        )
        
        step = TrajectoryStep(
            step_type=StepType.FINISH_TASK,
            status=StepStatus.COMPLETED,
            timestamp=event.timestamp,
            agent_id=event.agent_id,
            task_id=event.task_id,
            output_data={"final_result": event.final_result}
        )
        
        trajectory.add_step(step)
    
    def get_trajectory(self, agent_id: str, task_id: str) -> Optional[ExecutionTrajectory]:
        """获取轨迹"""
        key = self._get_trajectory_key(agent_id, task_id)
        return self.active_trajectories.get(key)
    
    def get_all_trajectories(self) -> List[ExecutionTrajectory]:
        """获取所有轨迹"""
        return list(self.active_trajectories.values()) + self.completed_trajectories
    
    def get_completed_trajectories(self) -> List[ExecutionTrajectory]:
        """获取已完成的轨迹"""
        return self.completed_trajectories
    
    def get_active_trajectories(self) -> List[ExecutionTrajectory]:
        """获取活跃的轨迹"""
        return list(self.active_trajectories.values())
    
    def finalize_trajectory(self, agent_id: str, task_id: str, final_status: StepStatus, final_result: Optional[Any] = None):
        """手动完成轨迹"""
        key = self._get_trajectory_key(agent_id, task_id)
        if key in self.active_trajectories:
            trajectory = self.active_trajectories[key]
            trajectory.finalize(final_status, final_result)
            
            if self.store_trajectories:
                self.completed_trajectories.append(trajectory)
                
                # 限制存储数量
                if len(self.completed_trajectories) > self.max_trajectories:
                    self.completed_trajectories.pop(0)
            
            del self.active_trajectories[key]
    
    def clear_trajectories(self):
        """清除所有轨迹"""
        self.active_trajectories.clear()
        self.completed_trajectories.clear()
        self.pending_steps.clear()
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        stats = super().get_stats()
        stats.update({
            "active_trajectories": len(self.active_trajectories),
            "completed_trajectories": len(self.completed_trajectories),
            "pending_steps": len(self.pending_steps),
            "auto_finalize": self.auto_finalize,
            "store_trajectories": self.store_trajectories,
            "max_trajectories": self.max_trajectories
        })
        return stats 