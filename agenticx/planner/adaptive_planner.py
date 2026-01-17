"""
AdaptivePlanner - 动态重规划器

基于执行快照和上下文进行智能重规划，支持：
- 状态快照序列化（Mermaid 格式）
- 执行摘要注入
- LLM 调用进行重规划
- 计划 Patch 生成与应用

借鉴自 Refly 的 IntentAnalysisService 和 PilotEngineService。

Usage:
    from agenticx.planner import AdaptivePlanner
    from agenticx.flow import ExecutionPlan
    
    planner = AdaptivePlanner(llm=my_llm)
    
    # 对现有计划进行重规划
    patch = await planner.replan(
        plan=current_plan,
        user_feedback="需要增加对竞品的分析"
    )
    
    # 应用 Patch
    updated_plan = planner.apply_patch(current_plan, patch)

References:
    - Refly: apps/api/src/modules/pilot/intent-analysis.service.ts
    - Refly: apps/api/src/modules/pilot/prompt/formatter.ts
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Protocol, Union

from pydantic import BaseModel, Field  # type: ignore

# 延迟导入以避免循环依赖
from agenticx.flow.execution_plan import (
    ExecutionPlan,
    ExecutionStage,
    InterventionState,
    StageStatus,
    Subtask,
    SubtaskStatus,
)

logger = logging.getLogger(__name__)


# ============================================================================
# LLM Protocol
# ============================================================================


class LLMProtocol(Protocol):
    """LLM 协议
    
    定义 AdaptivePlanner 所需的 LLM 接口。
    """
    
    async def generate(self, prompt: str, **kwargs: Any) -> str:
        """生成文本
        
        Args:
            prompt: 输入提示
            **kwargs: 其他参数
            
        Returns:
            生成的文本
        """
        ...


class MockLLM:
    """模拟 LLM（用于测试）"""
    
    def __init__(self, response: Optional[str] = None):
        self._response = response
    
    async def generate(self, prompt: str, **kwargs: Any) -> str:
        if self._response:
            return self._response
        # 返回一个简单的默认 Patch
        return json.dumps({
            "operations": [],
            "reasoning": "No changes needed based on current status."
        })


# ============================================================================
# Plan Patch Types
# ============================================================================


class PlanPatchOperation(str, Enum):
    """Patch 操作类型"""
    ADD_SUBTASK = "add_subtask"
    DELETE_SUBTASK = "delete_subtask"
    MODIFY_SUBTASK = "modify_subtask"
    ADD_STAGE = "add_stage"
    DELETE_STAGE = "delete_stage"
    MODIFY_STAGE = "modify_stage"
    REORDER_SUBTASKS = "reorder_subtasks"


class SubtaskPatch(BaseModel):
    """子任务 Patch"""
    operation: PlanPatchOperation
    subtask_id: Optional[str] = None
    stage_index: Optional[int] = None
    data: Optional[Dict[str, Any]] = None


class StagePatch(BaseModel):
    """阶段 Patch"""
    operation: PlanPatchOperation
    stage_index: Optional[int] = None
    data: Optional[Dict[str, Any]] = None


class PlanPatch(BaseModel):
    """计划 Patch
    
    表示对 ExecutionPlan 的一系列修改操作。
    
    Attributes:
        operations: 操作列表
        reasoning: 修改原因说明
        confidence: 置信度（0-1）
    """
    operations: List[Union[SubtaskPatch, StagePatch]] = Field(default_factory=list)
    reasoning: str = ""
    confidence: float = 1.0
    
    @property
    def is_empty(self) -> bool:
        """检查是否为空 Patch"""
        return len(self.operations) == 0


# ============================================================================
# Replanning Context
# ============================================================================


class ReplanningContext(BaseModel):
    """重规划上下文
    
    封装重规划所需的所有上下文信息。
    """
    user_question: str = ""
    user_feedback: Optional[str] = None
    mermaid_diagram: str = ""
    execution_summary: str = ""
    completed_findings: List[str] = Field(default_factory=list)
    current_epoch: int = 0
    max_epochs: int = 5
    available_tools: List[str] = Field(default_factory=list)


# ============================================================================
# Prompt Templates
# ============================================================================


REPLANNING_PROMPT_TEMPLATE = """You are an AI assistant that helps dynamically replan execution plans based on current progress and user feedback.

## Current Execution Plan State

{mermaid_diagram}

## Execution Summary

{execution_summary}

## User's Original Goal

{user_question}

{user_feedback_section}

## Current Progress

- Current Epoch: {current_epoch}/{max_epochs}
- Completed Findings:
{completed_findings}

## Available Tools

{available_tools}

## Your Task

Based on the current execution state and user feedback (if any), determine if the plan needs to be modified.

Output a JSON object with the following structure:
```json
{{
    "operations": [
        {{
            "operation": "add_subtask|delete_subtask|modify_subtask|add_stage|delete_stage|modify_stage",
            "subtask_id": "optional - id of subtask to modify/delete",
            "stage_index": "optional - index of stage",
            "data": {{
                "name": "subtask/stage name",
                "query": "subtask query (for subtasks)",
                "description": "stage description (for stages)"
            }}
        }}
    ],
    "reasoning": "Explanation of why these changes are needed",
    "confidence": 0.0-1.0
}}
```

If no changes are needed, return an empty operations array.

Output ONLY the JSON object, no additional text.
"""


# ============================================================================
# AdaptivePlanner
# ============================================================================


class AdaptivePlanner:
    """动态重规划器
    
    基于执行快照和上下文进行智能重规划。
    
    Attributes:
        llm: LLM 实例
        
    Example:
        >>> planner = AdaptivePlanner(llm=my_llm)
        >>> patch = await planner.replan(plan, user_feedback="增加竞品分析")
        >>> updated_plan = planner.apply_patch(plan, patch)
    """
    
    def __init__(
        self,
        llm: Optional[LLMProtocol] = None,
        prompt_template: Optional[str] = None,
    ):
        """初始化 AdaptivePlanner
        
        Args:
            llm: LLM 实例（可选，用于测试时可以传入 MockLLM）
            prompt_template: 自定义 Prompt 模板
        """
        self._llm = llm or MockLLM()
        self._prompt_template = prompt_template or REPLANNING_PROMPT_TEMPLATE
    
    # ========================================================================
    # Main Interface
    # ========================================================================
    
    async def replan(
        self,
        plan: ExecutionPlan,
        user_feedback: Optional[str] = None,
        available_tools: Optional[List[str]] = None,
    ) -> PlanPatch:
        """对计划进行重规划
        
        Args:
            plan: 当前执行计划
            user_feedback: 用户反馈（可选）
            available_tools: 可用工具列表
            
        Returns:
            PlanPatch 包含修改操作
        """
        # 构建重规划上下文
        context = self._build_replanning_context(
            plan=plan,
            user_feedback=user_feedback,
            available_tools=available_tools or [],
        )
        
        # 生成 Prompt
        prompt = self._build_prompt(context)
        
        # 调用 LLM
        try:
            response = await self._llm.generate(prompt)
            patch = self._parse_response(response)
            logger.info(
                f"Replanning completed: {len(patch.operations)} operations, "
                f"confidence={patch.confidence}"
            )
            return patch
        except Exception as e:
            logger.error(f"Replanning failed: {e}")
            return PlanPatch(
                operations=[],
                reasoning=f"Replanning failed: {str(e)}",
                confidence=0.0,
            )
    
    def apply_patch(
        self,
        plan: ExecutionPlan,
        patch: PlanPatch,
    ) -> ExecutionPlan:
        """应用 Patch 到计划
        
        Args:
            plan: 原始计划
            patch: 要应用的 Patch
            
        Returns:
            更新后的计划
        """
        if patch.is_empty:
            return plan
        
        for op in patch.operations:
            try:
                self._apply_operation(plan, op)
            except Exception as e:
                logger.error(f"Failed to apply operation {op}: {e}")
        
        # 更新计划时间戳
        plan._touch()
        
        return plan
    
    # ========================================================================
    # Context Building
    # ========================================================================
    
    def _build_replanning_context(
        self,
        plan: ExecutionPlan,
        user_feedback: Optional[str],
        available_tools: List[str],
    ) -> ReplanningContext:
        """构建重规划上下文
        
        Args:
            plan: 执行计划
            user_feedback: 用户反馈
            available_tools: 可用工具
            
        Returns:
            ReplanningContext
        """
        # 收集已完成的发现
        findings = []
        for stage in plan.completed_stages:
            if stage.summary:
                findings.append(f"- [{stage.name}] {stage.summary}")
        
        return ReplanningContext(
            user_question=plan.goal,
            user_feedback=user_feedback,
            mermaid_diagram=plan.to_mermaid(),
            execution_summary=plan.to_execution_summary(),
            completed_findings=findings,
            current_epoch=plan.current_epoch,
            max_epochs=plan.max_epochs,
            available_tools=available_tools,
        )
    
    def _build_prompt(self, context: ReplanningContext) -> str:
        """构建 LLM Prompt
        
        Args:
            context: 重规划上下文
            
        Returns:
            Prompt 字符串
        """
        # 用户反馈部分
        feedback_section = ""
        if context.user_feedback:
            feedback_section = f"\n## User Feedback\n\n{context.user_feedback}\n"
        
        # 已完成发现
        findings_str = "\n".join(context.completed_findings) if context.completed_findings else "None yet"
        
        # 可用工具
        tools_str = "\n".join(f"- {tool}" for tool in context.available_tools) if context.available_tools else "No specific tools available"
        
        return self._prompt_template.format(
            mermaid_diagram=context.mermaid_diagram,
            execution_summary=context.execution_summary,
            user_question=context.user_question,
            user_feedback_section=feedback_section,
            current_epoch=context.current_epoch,
            max_epochs=context.max_epochs,
            completed_findings=findings_str,
            available_tools=tools_str,
        )
    
    # ========================================================================
    # Response Parsing
    # ========================================================================
    
    def _parse_response(self, response: str) -> PlanPatch:
        """解析 LLM 响应
        
        Args:
            response: LLM 响应文本
            
        Returns:
            PlanPatch
        """
        # 尝试提取 JSON
        try:
            # 处理可能包含 markdown 代码块的响应
            json_str = response
            if "```json" in response:
                start = response.find("```json") + 7
                end = response.find("```", start)
                json_str = response[start:end].strip()
            elif "```" in response:
                start = response.find("```") + 3
                end = response.find("```", start)
                json_str = response[start:end].strip()
            
            data = json.loads(json_str)
            
            operations = []
            for op_data in data.get("operations", []):
                op_type = op_data.get("operation", "")
                
                if op_type in ("add_subtask", "delete_subtask", "modify_subtask", "reorder_subtasks"):
                    operations.append(SubtaskPatch(
                        operation=PlanPatchOperation(op_type),
                        subtask_id=op_data.get("subtask_id"),
                        stage_index=op_data.get("stage_index"),
                        data=op_data.get("data"),
                    ))
                elif op_type in ("add_stage", "delete_stage", "modify_stage"):
                    operations.append(StagePatch(
                        operation=PlanPatchOperation(op_type),
                        stage_index=op_data.get("stage_index"),
                        data=op_data.get("data"),
                    ))
            
            return PlanPatch(
                operations=operations,
                reasoning=data.get("reasoning", ""),
                confidence=data.get("confidence", 1.0),
            )
            
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse LLM response as JSON: {e}")
            return PlanPatch(
                operations=[],
                reasoning=f"Failed to parse response: {str(e)}",
                confidence=0.0,
            )
    
    # ========================================================================
    # Operation Application
    # ========================================================================
    
    def _apply_operation(
        self,
        plan: ExecutionPlan,
        operation: Union[SubtaskPatch, StagePatch],
    ) -> None:
        """应用单个操作
        
        Args:
            plan: 执行计划
            operation: 操作
        """
        if isinstance(operation, SubtaskPatch):
            self._apply_subtask_operation(plan, operation)
        elif isinstance(operation, StagePatch):
            self._apply_stage_operation(plan, operation)
    
    def _apply_subtask_operation(
        self,
        plan: ExecutionPlan,
        op: SubtaskPatch,
    ) -> None:
        """应用子任务操作
        
        Args:
            plan: 执行计划
            op: 子任务操作
        """
        if op.operation == PlanPatchOperation.ADD_SUBTASK:
            if op.data:
                stage_idx = op.stage_index if op.stage_index is not None else plan.current_stage_index
                plan.add_subtask(
                    name=op.data.get("name", "New Subtask"),
                    query=op.data.get("query", ""),
                    stage_index=stage_idx,
                    context=op.data.get("context"),
                )
                logger.debug(f"Added subtask to stage {stage_idx}")
        
        elif op.operation == PlanPatchOperation.DELETE_SUBTASK:
            if op.subtask_id:
                plan.delete_subtask(op.subtask_id)
                logger.debug(f"Deleted subtask {op.subtask_id}")
        
        elif op.operation == PlanPatchOperation.MODIFY_SUBTASK:
            if op.subtask_id and op.data:
                subtask = plan.get_subtask(op.subtask_id)
                if subtask:
                    if "name" in op.data:
                        subtask.name = op.data["name"]
                    if "query" in op.data:
                        subtask.query = op.data["query"]
                    if "context" in op.data:
                        subtask.context = op.data["context"]
                    logger.debug(f"Modified subtask {op.subtask_id}")
    
    def _apply_stage_operation(
        self,
        plan: ExecutionPlan,
        op: StagePatch,
    ) -> None:
        """应用阶段操作
        
        Args:
            plan: 执行计划
            op: 阶段操作
        """
        if op.operation == PlanPatchOperation.ADD_STAGE:
            if op.data:
                stage = ExecutionStage(
                    name=op.data.get("name", "New Stage"),
                    description=op.data.get("description", ""),
                    objectives=op.data.get("objectives", []),
                )
                plan.add_stage(stage)
                logger.debug(f"Added stage: {stage.name}")
        
        elif op.operation == PlanPatchOperation.DELETE_STAGE:
            if op.stage_index is not None and 0 <= op.stage_index < len(plan.stages):
                deleted_stage = plan.stages.pop(op.stage_index)
                # 调整 current_stage_index
                if plan.current_stage_index >= op.stage_index:
                    plan.current_stage_index = max(0, plan.current_stage_index - 1)
                logger.debug(f"Deleted stage at index {op.stage_index}")
        
        elif op.operation == PlanPatchOperation.MODIFY_STAGE:
            if op.stage_index is not None and op.data:
                if 0 <= op.stage_index < len(plan.stages):
                    stage = plan.stages[op.stage_index]
                    if "name" in op.data:
                        stage.name = op.data["name"]
                    if "description" in op.data:
                        stage.description = op.data["description"]
                    if "objectives" in op.data:
                        stage.objectives = op.data["objectives"]
                    logger.debug(f"Modified stage at index {op.stage_index}")


# ============================================================================
# Exports
# ============================================================================


__all__ = [
    "LLMProtocol",
    "MockLLM",
    "PlanPatchOperation",
    "SubtaskPatch",
    "StagePatch",
    "PlanPatch",
    "ReplanningContext",
    "AdaptivePlanner",
]

