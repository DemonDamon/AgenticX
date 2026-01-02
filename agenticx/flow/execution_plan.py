"""
ExecutionPlan 协议与可干预智能体支持

提供显式进度计划、动态重规划和人类干预能力。
借鉴自 Refly 的 ProgressPlan 机制。

Usage:
    from agenticx.flow.execution_plan import (
        ExecutionPlan, ExecutionStage, Subtask, InterventionState
    )
    
    # 创建执行计划
    plan = ExecutionPlan(
        session_id="session_001",
        goal="研究 2026 年低空经济发展趋势",
        stages=[
            ExecutionStage(
                name="数据收集",
                subtasks=[
                    Subtask(name="搜索行业报告", query="低空经济 2026 趋势"),
                    Subtask(name="获取政策信息", query="低空经济 政策法规"),
                ]
            )
        ]
    )
    
    # 干预操作
    plan.pause()  # 暂停执行
    plan.delete_subtask("subtask_001")  # 删除子任务
    plan.resume()  # 恢复执行

References:
    - Refly: apps/api/src/modules/pilot/pilot.types.ts
    - Refly: apps/api/src/modules/pilot/prompt/formatter.ts
"""

from __future__ import annotations

import logging
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


# ============================================================================
# Enums
# ============================================================================


class SubtaskStatus(str, Enum):
    """子任务状态"""
    PENDING = "pending"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"


class StageStatus(str, Enum):
    """阶段状态"""
    PENDING = "pending"
    ACTIVE = "active"
    DONE = "done"


class InterventionState(str, Enum):
    """干预状态
    
    用于控制执行流程的暂停、恢复和重置。
    
    Attributes:
        RUNNING: 正常执行中
        PAUSED: 当前子任务完成后挂起
        RESUMING: 正在从暂停状态恢复
        RESETTING: 正在重置某个节点
    """
    RUNNING = "running"
    PAUSED = "paused"
    RESUMING = "resuming"
    RESETTING = "resetting"


# ============================================================================
# Data Models
# ============================================================================


class Subtask(BaseModel):
    """子任务定义
    
    表示执行计划中的最小可执行单元。
    
    Attributes:
        id: 唯一标识符
        name: 任务名称
        query: 任务查询/描述
        status: 执行状态
        result: 执行结果（可选）
        error: 错误信息（可选）
        context: 上下文信息（可选）
        created_at: 创建时间
        completed_at: 完成时间（可选）
        
    Example:
        >>> subtask = Subtask(
        ...     name="搜索行业报告",
        ...     query="低空经济 2026 发展趋势"
        ... )
        >>> subtask.status
        <SubtaskStatus.PENDING: 'pending'>
    """
    id: str = Field(default_factory=lambda: f"subtask_{uuid4().hex[:8]}")
    name: str
    query: str
    status: SubtaskStatus = SubtaskStatus.PENDING
    result: Optional[Any] = None
    error: Optional[str] = None
    context: Optional[str] = None
    scope: Optional[str] = None
    output_requirements: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    
    def mark_executing(self) -> None:
        """标记为执行中"""
        self.status = SubtaskStatus.EXECUTING
    
    def mark_completed(self, result: Any = None) -> None:
        """标记为已完成"""
        self.status = SubtaskStatus.COMPLETED
        self.result = result
        self.completed_at = datetime.now()
    
    def mark_failed(self, error: str) -> None:
        """标记为失败"""
        self.status = SubtaskStatus.FAILED
        self.error = error
        self.completed_at = datetime.now()
    
    def reset(self) -> None:
        """重置状态"""
        self.status = SubtaskStatus.PENDING
        self.result = None
        self.error = None
        self.completed_at = None
    
    model_config = ConfigDict(use_enum_values=True)


class ExecutionStage(BaseModel):
    """执行阶段定义
    
    表示执行计划中的一个阶段，包含多个子任务。
    
    Attributes:
        id: 唯一标识符
        name: 阶段名称
        description: 阶段描述
        objectives: 目标列表
        subtasks: 子任务列表
        status: 阶段状态
        priority: 优先级（1 最高）
        tool_categories: 推荐的工具类别
        summary: 阶段执行摘要
        created_at: 创建时间
        started_at: 开始时间
        completed_at: 完成时间
        
    Example:
        >>> stage = ExecutionStage(
        ...     name="数据收集阶段",
        ...     subtasks=[
        ...         Subtask(name="搜索报告", query="..."),
        ...         Subtask(name="获取数据", query="..."),
        ...     ]
        ... )
    """
    id: str = Field(default_factory=lambda: f"stage_{uuid4().hex[:8]}")
    name: str
    description: str = ""
    objectives: List[str] = Field(default_factory=list)
    subtasks: List[Subtask] = Field(default_factory=list)
    status: StageStatus = StageStatus.PENDING
    priority: int = 1
    tool_categories: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    @property
    def progress(self) -> float:
        """计算阶段进度百分比"""
        if not self.subtasks:
            return 0.0
        completed = sum(
            1 for t in self.subtasks 
            if t.status == SubtaskStatus.COMPLETED
        )
        return (completed / len(self.subtasks)) * 100
    
    def activate(self) -> None:
        """激活阶段"""
        self.status = StageStatus.ACTIVE
        self.started_at = datetime.now()
    
    def complete(self, summary: Optional[str] = None) -> None:
        """完成阶段"""
        self.status = StageStatus.DONE
        self.summary = summary
        self.completed_at = datetime.now()
    
    def add_subtask(self, subtask: Subtask) -> None:
        """添加子任务"""
        self.subtasks.append(subtask)
    
    def remove_subtask(self, subtask_id: str) -> bool:
        """移除子任务
        
        Returns:
            True 如果成功移除
        """
        original_len = len(self.subtasks)
        self.subtasks = [t for t in self.subtasks if t.id != subtask_id]
        return len(self.subtasks) < original_len
    
    def get_subtask(self, subtask_id: str) -> Optional[Subtask]:
        """获取子任务"""
        for subtask in self.subtasks:
            if subtask.id == subtask_id:
                return subtask
        return None
    
    def get_pending_subtasks(self) -> List[Subtask]:
        """获取待执行的子任务"""
        return [t for t in self.subtasks if t.status == SubtaskStatus.PENDING]
    
    model_config = ConfigDict(use_enum_values=True)


class ExecutionPlan(BaseModel):
    """执行计划
    
    表示一个完整的可干预执行计划，支持动态重规划和人类干预。
    
    Attributes:
        session_id: 会话 ID
        goal: 任务目标
        stages: 阶段列表
        current_stage_index: 当前阶段索引
        intervention_state: 干预状态
        user_intent: 用户意图分析
        planning_logic: 规划逻辑说明
        max_epochs: 最大纪元数
        current_epoch: 当前纪元
        created_at: 创建时间
        updated_at: 更新时间
        
    Example:
        >>> plan = ExecutionPlan(
        ...     session_id="session_001",
        ...     goal="研究低空经济趋势",
        ...     stages=[
        ...         ExecutionStage(name="收集阶段", subtasks=[...]),
        ...         ExecutionStage(name="分析阶段", subtasks=[...]),
        ...     ]
        ... )
        >>> plan.overall_progress
        0.0
        >>> plan.pause()
        >>> plan.intervention_state
        <InterventionState.PAUSED: 'paused'>
    """
    session_id: str = Field(default_factory=lambda: f"session_{uuid4().hex[:8]}")
    goal: str = ""
    stages: List[ExecutionStage] = Field(default_factory=list)
    current_stage_index: int = 0
    intervention_state: InterventionState = InterventionState.RUNNING
    user_intent: str = ""
    planning_logic: str = ""
    max_epochs: int = 5
    current_epoch: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    # ========================================================================
    # Properties
    # ========================================================================
    
    @property
    def overall_progress(self) -> float:
        """计算总体进度百分比"""
        if not self.stages:
            return 0.0
        
        total_subtasks = sum(len(s.subtasks) for s in self.stages)
        if total_subtasks == 0:
            return 0.0
        
        completed = sum(
            1 for s in self.stages 
            for t in s.subtasks 
            if t.status == SubtaskStatus.COMPLETED
        )
        return (completed / total_subtasks) * 100
    
    @property
    def current_stage(self) -> Optional[ExecutionStage]:
        """获取当前阶段"""
        if 0 <= self.current_stage_index < len(self.stages):
            return self.stages[self.current_stage_index]
        return None
    
    @property
    def is_paused(self) -> bool:
        """检查是否已暂停"""
        return self.intervention_state == InterventionState.PAUSED
    
    @property
    def is_completed(self) -> bool:
        """检查是否已完成"""
        return all(s.status == StageStatus.DONE for s in self.stages)
    
    @property
    def completed_stages(self) -> List[ExecutionStage]:
        """获取已完成的阶段"""
        return [s for s in self.stages if s.status == StageStatus.DONE]
    
    @property
    def pending_stages(self) -> List[ExecutionStage]:
        """获取待执行的阶段"""
        return [s for s in self.stages if s.status == StageStatus.PENDING]
    
    # ========================================================================
    # Intervention Methods
    # ========================================================================
    
    def pause(self) -> None:
        """暂停执行
        
        将干预状态设置为 PAUSED，执行器会在当前子任务完成后挂起。
        """
        if self.intervention_state == InterventionState.RUNNING:
            self.intervention_state = InterventionState.PAUSED
            self._touch()
            logger.info(f"ExecutionPlan {self.session_id} paused")
    
    def resume(self) -> None:
        """恢复执行
        
        将干预状态设置为 RESUMING，执行器会重新进入规划-执行循环。
        """
        if self.intervention_state == InterventionState.PAUSED:
            self.intervention_state = InterventionState.RESUMING
            self._touch()
            logger.info(f"ExecutionPlan {self.session_id} resuming")
    
    def reset_node(self, subtask_id: str) -> bool:
        """重置指定节点及其依赖
        
        Args:
            subtask_id: 要重置的子任务 ID
            
        Returns:
            True 如果成功重置
        """
        for stage in self.stages:
            subtask = stage.get_subtask(subtask_id)
            if subtask:
                subtask.reset()
                self.intervention_state = InterventionState.RESETTING
                self._touch()
                logger.info(f"Subtask {subtask_id} reset in plan {self.session_id}")
                return True
        return False
    
    def confirm_running(self) -> None:
        """确认进入运行状态（从 RESUMING 或 RESETTING 转换）"""
        if self.intervention_state in (
            InterventionState.RESUMING, 
            InterventionState.RESETTING
        ):
            self.intervention_state = InterventionState.RUNNING
            self._touch()
    
    # ========================================================================
    # Plan Modification Methods
    # ========================================================================
    
    def add_stage(self, stage: ExecutionStage) -> None:
        """添加阶段"""
        self.stages.append(stage)
        self._touch()
    
    def add_subtask(
        self, 
        name: str, 
        query: str, 
        stage_index: Optional[int] = None,
        **kwargs: Any,
    ) -> Subtask:
        """添加子任务到指定阶段
        
        Args:
            name: 子任务名称
            query: 子任务查询
            stage_index: 阶段索引（默认为当前阶段）
            **kwargs: 其他 Subtask 参数
            
        Returns:
            新创建的子任务
        """
        idx = stage_index if stage_index is not None else self.current_stage_index
        if 0 <= idx < len(self.stages):
            subtask = Subtask(name=name, query=query, **kwargs)
            self.stages[idx].add_subtask(subtask)
            self._touch()
            logger.info(f"Added subtask {subtask.id} to stage {idx}")
            return subtask
        raise IndexError(f"Invalid stage index: {idx}")
    
    def delete_subtask(self, subtask_id: str) -> bool:
        """删除子任务
        
        Args:
            subtask_id: 子任务 ID
            
        Returns:
            True 如果成功删除
        """
        for stage in self.stages:
            if stage.remove_subtask(subtask_id):
                self._touch()
                logger.info(f"Deleted subtask {subtask_id}")
                return True
        return False
    
    def get_subtask(self, subtask_id: str) -> Optional[Subtask]:
        """获取子任务"""
        for stage in self.stages:
            subtask = stage.get_subtask(subtask_id)
            if subtask:
                return subtask
        return None
    
    def advance_stage(self) -> bool:
        """推进到下一阶段
        
        Returns:
            True 如果成功推进
        """
        if self.current_stage_index < len(self.stages) - 1:
            # 完成当前阶段
            if self.current_stage:
                self.current_stage.complete()
            
            self.current_stage_index += 1
            
            # 激活下一阶段
            if self.current_stage:
                self.current_stage.activate()
            
            self._touch()
            return True
        return False
    
    def advance_epoch(self) -> bool:
        """推进到下一纪元
        
        Returns:
            True 如果未超过最大纪元数
        """
        if self.current_epoch < self.max_epochs:
            self.current_epoch += 1
            self._touch()
            return True
        return False
    
    # ========================================================================
    # Serialization Methods
    # ========================================================================
    
    def to_mermaid(self) -> str:
        """将执行计划转换为 Mermaid 流程图
        
        生成一个展示阶段和子任务状态的流程图。
        
        Returns:
            Mermaid 格式的字符串
            
        Example:
            >>> plan = ExecutionPlan(stages=[...])
            >>> print(plan.to_mermaid())
            ```mermaid
            graph TD
                stage_1["阶段1"] style stage_1 fill:#90EE90
                ...
            ```
        """
        if not self.stages:
            return "```mermaid\ngraph TD\n    EmptyPlan[Plan is empty]\n```"
        
        lines = ["```mermaid", "graph TD"]
        
        # 状态对应的样式
        status_styles = {
            SubtaskStatus.PENDING: "fill:#E8E8E8,stroke:#666",  # 灰色
            SubtaskStatus.EXECUTING: "fill:#87CEEB,stroke:#4682B4",  # 蓝色
            SubtaskStatus.COMPLETED: "fill:#90EE90,stroke:#228B22",  # 绿色
            SubtaskStatus.FAILED: "fill:#FFB6C1,stroke:#DC143C",  # 红色
        }
        
        stage_styles = {
            StageStatus.PENDING: "fill:#E8E8E8,stroke:#666",
            StageStatus.ACTIVE: "fill:#87CEEB,stroke:#4682B4",
            StageStatus.DONE: "fill:#90EE90,stroke:#228B22",
        }
        
        prev_stage_id = None
        
        for i, stage in enumerate(self.stages):
            safe_stage_id = f"stage_{i}"
            stage_title = stage.name.replace('"', "'")[:30]
            stage_style = stage_styles.get(stage.status, "")
            
            lines.append(f'    {safe_stage_id}["{stage_title}"]')
            if stage_style:
                lines.append(f'    style {safe_stage_id} {stage_style}')
            
            # 连接前一个阶段
            if prev_stage_id:
                lines.append(f'    {prev_stage_id} --> {safe_stage_id}')
            
            # 添加子任务
            for j, subtask in enumerate(stage.subtasks):
                safe_subtask_id = f"subtask_{i}_{j}"
                subtask_title = subtask.name.replace('"', "'")[:25]
                subtask_style = status_styles.get(subtask.status, "")
                
                lines.append(f'    {safe_subtask_id}("{subtask_title}")')
                if subtask_style:
                    lines.append(f'    style {safe_subtask_id} {subtask_style}')
                lines.append(f'    {safe_stage_id} --> {safe_subtask_id}')
            
            prev_stage_id = safe_stage_id
        
        # 添加图例
        lines.extend([
            '    subgraph Legend',
            '    L1["⬜ Pending"]',
            '    L2["🔵 Executing"]',
            '    L3["✅ Completed"]',
            '    L4["❌ Failed"]',
            '    end',
        ])
        
        lines.append("```")
        return "\n".join(lines)
    
    def to_execution_summary(self) -> str:
        """生成执行摘要
        
        用于动态重规划时提供给 LLM 的上下文。
        
        Returns:
            执行摘要字符串
        """
        lines = [
            f"## Execution Summary",
            f"**Goal**: {self.goal}",
            f"**Progress**: {self.overall_progress:.1f}%",
            f"**Current Epoch**: {self.current_epoch}/{self.max_epochs}",
            f"**Intervention State**: {self.intervention_state.value}",
            "",
            "### Completed Stages:",
        ]
        
        for stage in self.completed_stages:
            lines.append(f"- **{stage.name}**: {stage.summary or 'No summary'}")
        
        if self.current_stage:
            lines.extend([
                "",
                f"### Current Stage: {self.current_stage.name}",
                f"- Progress: {self.current_stage.progress:.1f}%",
                f"- Pending subtasks: {len(self.current_stage.get_pending_subtasks())}",
            ])
        
        lines.extend([
            "",
            "### Pending Stages:",
        ])
        for stage in self.pending_stages:
            lines.append(f"- {stage.name}")
        
        return "\n".join(lines)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典（用于序列化）"""
        return self.model_dump()
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionPlan":
        """从字典创建（用于反序列化）"""
        return cls.model_validate(data)
    
    # ========================================================================
    # Private Methods
    # ========================================================================
    
    def _touch(self) -> None:
        """更新 updated_at 时间戳"""
        self.updated_at = datetime.now()
    
    model_config = ConfigDict(use_enum_values=True)


# ============================================================================
# Exports
# ============================================================================


__all__ = [
    # Enums
    "SubtaskStatus",
    "StageStatus",
    "InterventionState",
    # Models
    "Subtask",
    "ExecutionStage",
    "ExecutionPlan",
]

