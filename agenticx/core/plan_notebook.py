"""
Plan Notebook - 计划笔记本组件

参考自 AgentScope 的 plan/_plan_notebook.py

提供"计划即工具"的核心能力：
- 将计划状态管理封装为 Agent 可调用的工具
- 提供状态感知的提示生成
- 支持计划的历史记录和恢复

设计原则（来自 AgentScope）：
- Plan-as-a-Tool: 计划管理操作暴露为标准工具
- State-Driven Hints: 根据计划状态自动生成下一步提示
- Hooks: 支持计划变更时的回调
"""

from collections import OrderedDict
from typing import Callable, Literal, Coroutine, Any, Awaitable, Optional, List, Dict
from datetime import datetime, timezone
import asyncio
import logging

from .plan_storage import (
    Plan, SubTask, 
    PlanStorageBase, InMemoryPlanStorage
)
from .message import Message

logger = logging.getLogger(__name__)


# =============================================================================
# 工具响应类型
# =============================================================================

class ToolResult:
    """
    工具执行结果。
    
    适配 AgentScope 的 ToolResponse，简化为 AgenticX 风格。
    """
    
    def __init__(
        self,
        content: str,
        success: bool = True,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.content = content
        self.success = success
        self.metadata = metadata or {}
    
    def __repr__(self) -> str:
        return f"ToolResult(success={self.success}, content={self.content[:50]}...)"


# =============================================================================
# 默认提示生成器
# =============================================================================

class DefaultPlanToHint:
    """
    默认的计划提示生成器。
    
    参考自 AgentScope 的 plan/_plan_notebook.py::DefaultPlanToHint
    
    根据当前计划状态生成引导提示，帮助 Agent 理解下一步应该做什么。
    """
    
    hint_prefix: str = "<system-hint>"
    hint_suffix: str = "</system-hint>"
    
    no_plan: str = (
        "如果用户的查询比较复杂（如编写网站、游戏或应用），或者需要多个步骤才能完成"
        "（如从不同来源研究某个主题），你需要先调用 'create_plan' 创建计划。"
        "否则，可以直接执行用户的查询，无需规划。"
    )
    
    at_the_beginning: str = (
        "当前计划:\n"
        "```\n"
        "{plan}\n"
        "```\n"
        "你的选项包括:\n"
        "- 调用 'update_subtask_state' 将第一个子任务标记为 'in_progress'（subtask_idx=0, state='in_progress'），然后开始执行。\n"
        "- 如果第一个子任务不可执行，分析原因并决定如何推进计划，例如向用户询问更多信息，或调用 'revise_current_plan' 修改计划。\n"
        "- 如果用户要求做与计划无关的事情，优先完成用户的请求，然后返回计划。\n"
        "- 如果用户不再想执行当前计划，确认后调用 'finish_plan' 函数。\n"
    )
    
    when_a_subtask_in_progress: str = (
        "当前计划:\n"
        "```\n"
        "{plan}\n"
        "```\n"
        "当前正在执行索引为 {subtask_idx} 的子任务 '{subtask_name}'，状态为 'in_progress'。详情:\n"
        "```\n"
        "{subtask}\n"
        "```\n"
        "你的选项包括:\n"
        "- 继续执行子任务并获取结果。\n"
        "- 如果子任务完成，调用 'finish_subtask' 并提供具体成果。\n"
        "- 如果需要更多信息，向用户询问。\n"
        "- 如果需要修改计划，调用 'revise_current_plan'。\n"
        "- 如果用户要求做与计划无关的事情，优先完成用户的请求，然后返回计划。"
    )
    
    when_no_subtask_in_progress: str = (
        "当前计划:\n"
        "```\n"
        "{plan}\n"
        "```\n"
        "前 {index} 个子任务已完成，目前没有子任务处于 'in_progress' 状态。你的选项包括:\n"
        "- 调用 'update_subtask_state' 将下一个子任务标记为 'in_progress'，然后开始执行。\n"
        "- 如果需要更多信息，向用户询问。\n"
        "- 如果需要修改计划，调用 'revise_current_plan'。\n"
        "- 如果用户要求做与计划无关的事情，优先完成用户的请求，然后返回计划。"
    )
    
    at_the_end: str = (
        "当前计划:\n"
        "```\n"
        "{plan}\n"
        "```\n"
        "所有子任务已完成。你的选项包括:\n"
        "- 调用 'finish_plan' 完成计划，并向用户总结整个过程和成果。\n"
        "- 如果需要修改计划，调用 'revise_current_plan'。\n"
        "- 如果用户要求做与计划无关的事情，优先完成用户的请求，然后返回计划。"
    )
    
    def __call__(self, plan: Optional[Plan]) -> Optional[str]:
        """
        根据计划状态生成提示信息。
        
        Args:
            plan: 当前计划，可能为 None
            
        Returns:
            生成的提示信息，或 None
        """
        if plan is None:
            hint = self.no_plan
        else:
            # 统计各状态的子任务数量
            n_todo, n_in_progress, n_done, n_abandoned = 0, 0, 0, 0
            in_progress_subtask_idx = None
            
            for idx, subtask in enumerate(plan.subtasks):
                if subtask.state == "todo":
                    n_todo += 1
                elif subtask.state == "in_progress":
                    n_in_progress += 1
                    in_progress_subtask_idx = idx
                elif subtask.state == "done":
                    n_done += 1
                elif subtask.state == "abandoned":
                    n_abandoned += 1
            
            hint = None
            if n_in_progress == 0 and n_done == 0:
                # 所有子任务都是 todo
                hint = self.at_the_beginning.format(
                    plan=plan.to_markdown(),
                )
            elif n_in_progress > 0 and in_progress_subtask_idx is not None:
                # 有一个子任务正在进行中
                hint = self.when_a_subtask_in_progress.format(
                    plan=plan.to_markdown(),
                    subtask_idx=in_progress_subtask_idx,
                    subtask_name=plan.subtasks[in_progress_subtask_idx].name,
                    subtask=plan.subtasks[in_progress_subtask_idx].to_markdown(
                        detailed=True,
                    ),
                )
            elif n_in_progress == 0 and n_done > 0 and n_todo > 0:
                # 没有子任务正在进行中，但有一些已完成
                hint = self.when_no_subtask_in_progress.format(
                    plan=plan.to_markdown(),
                    index=n_done,
                )
            elif n_done + n_abandoned == len(plan.subtasks):
                # 所有子任务都已完成或放弃
                hint = self.at_the_end.format(
                    plan=plan.to_markdown(),
                )
        
        if hint:
            return f"{self.hint_prefix}{hint}{self.hint_suffix}"
        
        return hint


# =============================================================================
# PlanNotebook 核心组件
# =============================================================================

class PlanNotebook:
    """
    计划笔记本 - 将计划管理封装为 Agent 可调用的工具。
    
    参考自 AgentScope 的 plan/_plan_notebook.py::PlanNotebook
    
    核心功能:
    - 创建和管理计划
    - 提供计划管理工具（create_plan, finish_subtask 等）
    - 根据计划状态生成提示
    - 支持计划历史记录和恢复
    
    使用示例:
    ```python
    notebook = PlanNotebook()
    
    # 获取计划管理工具列表
    tools = notebook.list_tools()
    
    # 获取当前提示
    hint = await notebook.get_current_hint()
    ```
    """
    
    description: str = (
        "计划相关工具。当需要执行复杂任务（如构建网站或游戏）时激活此工具。"
        "激活后，你将进入计划模式，通过创建和执行计划来完成任务。"
        "<system-hint></system-hint> 包裹的提示信息会引导你完成任务。"
        "如果用户不再想执行当前任务，需要确认后调用 'finish_plan' 函数。"
    )
    
    def __init__(
        self,
        max_subtasks: Optional[int] = None,
        plan_to_hint: Optional[Callable[[Optional[Plan]], Optional[str]]] = None,
        storage: Optional[PlanStorageBase] = None,
    ) -> None:
        """
        初始化计划笔记本。
        
        Args:
            max_subtasks: 计划中最大子任务数量
            plan_to_hint: 根据计划生成提示的函数，默认使用 DefaultPlanToHint
            storage: 计划存储后端，默认使用内存存储
        """
        self.max_subtasks = max_subtasks
        self.plan_to_hint = plan_to_hint or DefaultPlanToHint()
        self.storage = storage or InMemoryPlanStorage()
        
        self.current_plan: Optional[Plan] = None
        
        # 计划变更钩子
        self._plan_change_hooks: OrderedDict[
            str,
            Callable[["PlanNotebook", Optional[Plan]], None] |
            Callable[["PlanNotebook", Optional[Plan]], Awaitable[None]]
        ] = OrderedDict()
    
    # =========================================================================
    # 核心工具方法
    # =========================================================================
    
    async def create_plan(
        self,
        name: str,
        description: str,
        expected_outcome: str,
        subtasks: List[Dict[str, Any]],
    ) -> ToolResult:
        """
        创建计划。
        
        Args:
            name: 计划名称，应简洁描述性强
            description: 计划描述，包含约束、目标和预期成果
            expected_outcome: 预期成果，应具体可衡量
            subtasks: 子任务列表，每个子任务是一个字典
            
        Returns:
            工具执行结果
        """
        # 转换子任务
        subtask_objs = [SubTask.model_validate(st) for st in subtasks]
        
        plan = Plan(
            name=name,
            description=description,
            expected_outcome=expected_outcome,
            subtasks=subtask_objs,
        )
        
        if self.current_plan is None:
            result = ToolResult(
                content=f"计划 '{name}' 创建成功。",
                success=True
            )
        else:
            result = ToolResult(
                content=f"当前计划 '{self.current_plan.name}' 已被新计划 '{name}' 替换。",
                success=True
            )
        
        self.current_plan = plan
        await self._trigger_plan_change_hooks()
        return result
    
    def _validate_current_plan(self) -> None:
        """验证当前计划是否存在"""
        if self.current_plan is None:
            raise ValueError(
                "当前计划为空，需要先调用 create_plan() 创建计划。"
            )
    
    async def revise_current_plan(
        self,
        subtask_idx: int,
        action: Literal["add", "revise", "delete"],
        subtask: Optional[Dict[str, Any]] = None,
    ) -> ToolResult:
        """
        修改当前计划的子任务。
        
        Args:
            subtask_idx: 子任务索引，从 0 开始
            action: 操作类型: add/revise/delete
            subtask: 要添加或修改的子任务（add/revise 时必填）
            
        Returns:
            工具执行结果
        """
        # 参数验证
        errors: List[str] = []
        
        if isinstance(subtask_idx, str):
            try:
                subtask_idx = int(subtask_idx)
            except ValueError:
                pass
        
        if not isinstance(subtask_idx, int):
            errors.append(
                f"参数 'subtask_idx' 类型无效。期望 'int'，但得到 '{type(subtask_idx)}'。"
            )
        
        if action not in ["add", "revise", "delete"]:
            errors.append(
                f"无效操作 '{action}'。必须是 'add', 'revise', 'delete' 之一。"
            )
        
        if action in ["add", "revise"] and subtask is None:
            errors.append(
                f"操作为 '{action}' 时必须提供 subtask 参数。"
            )
        
        try:
            self._validate_current_plan()
        except ValueError as e:
            errors.append(str(e))
        
        if errors:
            return ToolResult(
                content=f"错误: {errors[0]}",
                success=False
            )
        
        # 验证索引范围
        if action != "add" and subtask_idx >= len(self.current_plan.subtasks):
            return ToolResult(
                content=f"无效的 subtask_idx '{subtask_idx}'。必须在 0 到 {len(self.current_plan.subtasks) - 1} 之间。",
                success=False
            )
        
        if action == "add" and not (0 <= subtask_idx <= len(self.current_plan.subtasks)):
            return ToolResult(
                content=f"无效的 subtask_idx '{subtask_idx}'。添加操作的索引必须在 0 到 {len(self.current_plan.subtasks)} 之间。",
                success=False
            )
        
        # 执行操作
        if subtask is not None:
            subtask_obj = SubTask.model_validate(subtask)
        
        if action == "delete":
            deleted = self.current_plan.subtasks.pop(subtask_idx)
            await self._trigger_plan_change_hooks()
            return ToolResult(
                content=f"索引 {subtask_idx} 的子任务 '{deleted.name}' 删除成功。",
                success=True
            )
        
        if action == "add":
            self.current_plan.subtasks.insert(subtask_idx, subtask_obj)
            await self._trigger_plan_change_hooks()
            return ToolResult(
                content=f"新子任务已成功添加到索引 {subtask_idx}。",
                success=True
            )
        
        # revise
        self.current_plan.subtasks[subtask_idx] = subtask_obj
        await self._trigger_plan_change_hooks()
        return ToolResult(
            content=f"索引 {subtask_idx} 的子任务修改成功。",
            success=True
        )
    
    async def update_subtask_state(
        self,
        subtask_idx: int,
        state: Literal["todo", "in_progress", "abandoned"],
    ) -> ToolResult:
        """
        更新子任务状态。
        
        注意：如果要将子任务标记为 done，应该调用 finish_subtask 并提供具体成果。
        
        Args:
            subtask_idx: 子任务索引
            state: 新状态: todo/in_progress/abandoned
            
        Returns:
            工具执行结果
        """
        try:
            self._validate_current_plan()
        except ValueError as e:
            return ToolResult(content=str(e), success=False)
        
        if isinstance(subtask_idx, str):
            try:
                subtask_idx = int(subtask_idx)
            except ValueError:
                pass
        
        if not isinstance(subtask_idx, int):
            return ToolResult(
                content=f"参数 'subtask_idx' 类型无效。期望 'int'，但得到 '{type(subtask_idx)}'。",
                success=False
            )
        
        if not 0 <= subtask_idx < len(self.current_plan.subtasks):
            return ToolResult(
                content=f"无效的 subtask_idx '{subtask_idx}'。必须在 0 到 {len(self.current_plan.subtasks) - 1} 之间。",
                success=False
            )
        
        if state not in ["todo", "in_progress", "abandoned"]:
            return ToolResult(
                content=f"无效状态 '{state}'。必须是 'todo', 'in_progress', 'abandoned' 之一。",
                success=False
            )
        
        # 检查约束：同时只能有一个子任务处于 in_progress 状态
        if state == "in_progress":
            for idx, st in enumerate(self.current_plan.subtasks):
                # 检查前面的子任务是否都已完成
                if idx < subtask_idx and st.state not in ["done", "abandoned"]:
                    return ToolResult(
                        content=f"子任务 (索引 {idx}) '{st.name}' 尚未完成。应先完成前面的子任务。",
                        success=False
                    )
                # 检查是否已有其他子任务正在进行中
                if st.state == "in_progress":
                    return ToolResult(
                        content=f"子任务 (索引 {idx}) '{st.name}' 已经处于 'in_progress' 状态。应先完成它再开始另一个子任务。",
                        success=False
                    )
        
        self.current_plan.subtasks[subtask_idx].state = state
        
        # 更新计划状态
        suffix = self.current_plan.refresh_plan_state()
        
        await self._trigger_plan_change_hooks()
        return ToolResult(
            content=f"索引 {subtask_idx} 的子任务 '{self.current_plan.subtasks[subtask_idx].name}' 已标记为 '{state}'。{suffix}",
            success=True
        )
    
    async def finish_subtask(
        self,
        subtask_idx: int,
        subtask_outcome: str,
    ) -> ToolResult:
        """
        将子任务标记为完成并提供成果。
        
        Args:
            subtask_idx: 子任务索引
            subtask_outcome: 子任务的具体成果，应与预期成果匹配
            
        Returns:
            工具执行结果
        """
        try:
            self._validate_current_plan()
        except ValueError as e:
            return ToolResult(content=str(e), success=False)
        
        if isinstance(subtask_idx, str):
            try:
                subtask_idx = int(subtask_idx)
            except ValueError:
                pass
        
        if not isinstance(subtask_idx, int):
            return ToolResult(
                content=f"参数 'subtask_idx' 类型无效。期望 'int'，但得到 '{type(subtask_idx)}'。",
                success=False
            )
        
        if not 0 <= subtask_idx < len(self.current_plan.subtasks):
            return ToolResult(
                content=f"无效的 subtask_idx '{subtask_idx}'。必须在 0 到 {len(self.current_plan.subtasks) - 1} 之间。",
                success=False
            )
        
        # 检查前面的子任务是否都已完成
        for idx, subtask in enumerate(self.current_plan.subtasks[:subtask_idx]):
            if subtask.state not in ["done", "abandoned"]:
                return ToolResult(
                    content=f"无法完成索引 {subtask_idx} 的子任务，因为前面的子任务 (索引 {idx}) '{subtask.name}' 尚未完成。",
                    success=False
                )
        
        # 标记完成
        self.current_plan.subtasks[subtask_idx].finish(subtask_outcome)
        
        # 自动激活下一个子任务
        if subtask_idx + 1 < len(self.current_plan.subtasks):
            self.current_plan.subtasks[subtask_idx + 1].state = "in_progress"
            next_subtask = self.current_plan.subtasks[subtask_idx + 1]
            await self._trigger_plan_change_hooks()
            return ToolResult(
                content=f"子任务 (索引 {subtask_idx}) '{self.current_plan.subtasks[subtask_idx].name}' 已标记为完成。下一个子任务 '{next_subtask.name}' 已激活。",
                success=True
            )
        
        await self._trigger_plan_change_hooks()
        return ToolResult(
            content=f"子任务 (索引 {subtask_idx}) '{self.current_plan.subtasks[subtask_idx].name}' 已标记为完成。",
            success=True
        )
    
    async def view_subtasks(self, subtask_idx: List[int]) -> ToolResult:
        """
        查看子任务详情。
        
        Args:
            subtask_idx: 要查看的子任务索引列表
            
        Returns:
            工具执行结果
        """
        try:
            self._validate_current_plan()
        except ValueError as e:
            return ToolResult(content=str(e), success=False)
        
        gathered_strs = []
        invalid_idx = []
        
        for idx in subtask_idx:
            if not 0 <= idx < len(self.current_plan.subtasks):
                invalid_idx.append(idx)
                continue
            
            subtask_markdown = self.current_plan.subtasks[idx].to_markdown(detailed=True)
            gathered_strs.append(
                f"索引 {idx} 的子任务:\n```\n{subtask_markdown}\n```\n"
            )
        
        if invalid_idx:
            gathered_strs.append(
                f"无效的索引: {invalid_idx}。必须在 0 到 {len(self.current_plan.subtasks) - 1} 之间。"
            )
        
        return ToolResult(
            content="\n".join(gathered_strs),
            success=True
        )
    
    async def finish_plan(
        self,
        state: Literal["done", "abandoned"],
        outcome: str,
    ) -> ToolResult:
        """
        完成或放弃当前计划。
        
        Args:
            state: 完成状态: done/abandoned
            outcome: 成果或放弃原因
            
        Returns:
            工具执行结果
        """
        if self.current_plan is None:
            return ToolResult(
                content="没有可完成的计划。",
                success=False
            )
        
        self.current_plan.finish(state, outcome)
        
        # 存储到历史记录
        await self.storage.add_plan(self.current_plan)
        
        self.current_plan = None
        await self._trigger_plan_change_hooks()
        
        return ToolResult(
            content=f"当前计划已成功完成，状态为 '{state}'。",
            success=True
        )
    
    async def view_historical_plans(self) -> ToolResult:
        """
        查看历史计划。
        
        Returns:
            工具执行结果
        """
        historical_plans = await self.storage.get_plans()
        
        if not historical_plans:
            return ToolResult(
                content="没有历史计划。",
                success=True
            )
        
        plans_str = [
            f"计划 '{p.name}':\n"
            f"- ID: {p.id}\n"
            f"- 创建时间: {p.created_at}\n"
            f"- 描述: {p.description}\n"
            f"- 状态: {p.state}\n"
            for p in historical_plans
        ]
        
        return ToolResult(
            content="\n".join(plans_str),
            success=True
        )
    
    async def recover_historical_plan(self, plan_id: str) -> ToolResult:
        """
        恢复历史计划。
        
        Args:
            plan_id: 要恢复的计划 ID
            
        Returns:
            工具执行结果
        """
        historical_plan = await self.storage.get_plan(plan_id)
        
        if historical_plan is None:
            return ToolResult(
                content=f"找不到 ID 为 '{plan_id}' 的计划。",
                success=False
            )
        
        # 存储当前计划到历史记录（如果存在）
        if self.current_plan:
            if self.current_plan.state != "done":
                self.current_plan.finish(
                    "abandoned",
                    f"被历史计划 '{historical_plan.id}' 中断。"
                )
            await self.storage.add_plan(self.current_plan)
            result = ToolResult(
                content=f"当前计划 '{self.current_plan.name}' 已被历史计划 '{historical_plan.name}' (ID: {historical_plan.id}) 替换。",
                success=True
            )
        else:
            result = ToolResult(
                content=f"历史计划 '{historical_plan.name}' (ID: {historical_plan.id}) 恢复成功。",
                success=True
            )
        
        self.current_plan = historical_plan
        return result
    
    # =========================================================================
    # 工具列表和提示
    # =========================================================================
    
    def list_tools(self) -> List[Callable[..., Coroutine[Any, Any, ToolResult]]]:
        """
        列出所有计划管理工具。
        
        Returns:
            工具方法列表
        """
        return [
            # 子任务相关
            self.view_subtasks,
            self.update_subtask_state,
            self.finish_subtask,
            # 计划相关
            self.create_plan,
            self.revise_current_plan,
            self.finish_plan,
            # 历史计划相关
            self.view_historical_plans,
            self.recover_historical_plan,
        ]
    
    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """
        获取工具的 JSON Schema（用于 LLM function calling）。
        
        Returns:
            工具 Schema 列表
        """
        return [
            {
                "type": "function",
                "function": {
                    "name": "create_plan",
                    "description": "创建一个结构化计划，包含多个顺序执行的子任务",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "计划名称"},
                            "description": {"type": "string", "description": "计划描述"},
                            "expected_outcome": {"type": "string", "description": "预期成果"},
                            "subtasks": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "description": {"type": "string"},
                                        "expected_outcome": {"type": "string"},
                                    },
                                    "required": ["name", "description", "expected_outcome"]
                                }
                            }
                        },
                        "required": ["name", "description", "expected_outcome", "subtasks"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "update_subtask_state",
                    "description": "更新子任务状态。注意：如果要标记为 done，应调用 finish_subtask",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "subtask_idx": {"type": "integer", "description": "子任务索引，从 0 开始"},
                            "state": {"type": "string", "enum": ["todo", "in_progress", "abandoned"]}
                        },
                        "required": ["subtask_idx", "state"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "finish_subtask",
                    "description": "完成子任务并提供具体成果",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "subtask_idx": {"type": "integer", "description": "子任务索引"},
                            "subtask_outcome": {"type": "string", "description": "具体成果，应与预期成果匹配"}
                        },
                        "required": ["subtask_idx", "subtask_outcome"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "finish_plan",
                    "description": "完成或放弃当前计划",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "state": {"type": "string", "enum": ["done", "abandoned"]},
                            "outcome": {"type": "string", "description": "成果或放弃原因"}
                        },
                        "required": ["state", "outcome"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "revise_current_plan",
                    "description": "修改当前计划的子任务",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "subtask_idx": {"type": "integer", "description": "子任务索引"},
                            "action": {"type": "string", "enum": ["add", "revise", "delete"]},
                            "subtask": {
                                "type": "object",
                                "description": "add/revise 时必填"
                            }
                        },
                        "required": ["subtask_idx", "action"]
                    }
                }
            },
        ]
    
    async def get_current_hint(self) -> Optional[Message]:
        """
        获取当前计划状态的提示信息。
        
        Returns:
            包含提示的 Message 对象，或 None
        """
        hint_content = self.plan_to_hint(self.current_plan)
        
        if hint_content:
            return Message(
                sender_id="system",
                recipient_id="agent",
                content=hint_content,
                metadata={"type": "plan_hint"}
            )
        
        return None
    
    # =========================================================================
    # 钩子管理
    # =========================================================================
    
    def register_plan_change_hook(
        self,
        hook_name: str,
        hook: Callable[["PlanNotebook", Optional[Plan]], None] |
              Callable[["PlanNotebook", Optional[Plan]], Awaitable[None]],
    ) -> None:
        """
        注册计划变更钩子。
        
        Args:
            hook_name: 钩子名称（唯一）
            hook: 钩子函数
        """
        self._plan_change_hooks[hook_name] = hook
    
    def remove_plan_change_hook(self, hook_name: str) -> None:
        """
        移除计划变更钩子。
        
        Args:
            hook_name: 钩子名称
        """
        if hook_name in self._plan_change_hooks:
            self._plan_change_hooks.pop(hook_name)
        else:
            raise ValueError(f"钩子 '{hook_name}' 不存在。")
    
    async def _trigger_plan_change_hooks(self) -> None:
        """触发所有计划变更钩子"""
        for hook in self._plan_change_hooks.values():
            if asyncio.iscoroutinefunction(hook):
                await hook(self, self.current_plan)
            else:
                hook(self, self.current_plan)
    
    # =========================================================================
    # 状态序列化
    # =========================================================================
    
    def state_dict(self) -> Dict[str, Any]:
        """获取状态字典（用于序列化）"""
        return {
            "current_plan": self.current_plan.model_dump() if self.current_plan else None,
        }
    
    def load_state_dict(self, state_dict: Dict[str, Any]) -> None:
        """从状态字典加载（用于反序列化）"""
        plan_data = state_dict.get("current_plan")
        if plan_data:
            self.current_plan = Plan.model_validate(plan_data)
        else:
            self.current_plan = None

