"""
PlanNotebook 与 MiningPlannerAgent 集成测试

验证 AgentScope PlanNotebook 与 AgenticX MiningPlannerAgent 的集成：
1. MiningPlan 到 PlanNotebook 的同步
2. Plan-as-a-Tool 机制
3. 状态提示生成
4. 步骤状态更新
"""

import pytest
import asyncio
from typing import Dict, Any, List

from agenticx.core.plan_notebook import PlanNotebook
from agenticx.core.plan_storage import Plan, SubTask
from agenticx.protocols.mining_protocol import (
    MiningPlan, MiningStep, MiningStepType, MiningStepStatus,
    ExplorationStrategy, StopCondition
)
from agenticx.agents.mining_planner_agent import MiningPlannerAgent


# =============================================================================
# MiningStepStatus 兼容性测试
# =============================================================================

class TestMiningStepStatusCompatibility:
    """MiningStepStatus 与 AgentScope SubTask 状态兼容性测试"""
    
    def test_from_agentscope_conversion(self):
        """测试从 AgentScope 状态转换"""
        assert MiningStepStatus.from_agentscope("todo") == MiningStepStatus.PENDING
        assert MiningStepStatus.from_agentscope("in_progress") == MiningStepStatus.IN_PROGRESS
        assert MiningStepStatus.from_agentscope("done") == MiningStepStatus.COMPLETED
        assert MiningStepStatus.from_agentscope("abandoned") == MiningStepStatus.SKIPPED
        # 未知状态默认为 PENDING
        assert MiningStepStatus.from_agentscope("unknown") == MiningStepStatus.PENDING
    
    def test_to_agentscope_conversion(self):
        """测试转换为 AgentScope 状态"""
        assert MiningStepStatus.PENDING.to_agentscope() == "todo"
        assert MiningStepStatus.IN_PROGRESS.to_agentscope() == "in_progress"
        assert MiningStepStatus.COMPLETED.to_agentscope() == "done"
        assert MiningStepStatus.FAILED.to_agentscope() == "abandoned"
        assert MiningStepStatus.SKIPPED.to_agentscope() == "abandoned"


# =============================================================================
# MiningStep 增强测试
# =============================================================================

class TestMiningStepEnhancements:
    """MiningStep 增强功能测试（与 AgentScope SubTask 对齐）"""
    
    def test_finish_method(self):
        """测试 finish 方法"""
        step = MiningStep(
            step_type=MiningStepType.SEARCH,
            title="搜索代码库",
            description="搜索相关代码"
        )
        
        step.finish("找到 10 个相关文件")
        
        assert step.status == MiningStepStatus.COMPLETED
        assert step.outcome == "找到 10 个相关文件"
        assert step.execution_result == "找到 10 个相关文件"
        assert step.finished_at is not None
    
    def test_to_subtask_dict(self):
        """测试转换为 SubTask 字典"""
        step = MiningStep(
            step_type=MiningStepType.ANALYZE,
            title="分析结果",
            description="分析搜索结果并提取关键信息",
            expected_outcome="关键信息报告"
        )
        
        subtask_dict = step.to_subtask_dict()
        
        assert subtask_dict["name"] == "分析结果"
        assert subtask_dict["description"] == "分析搜索结果并提取关键信息"
        assert subtask_dict["expected_outcome"] == "关键信息报告"
        assert subtask_dict["state"] == "todo"
    
    def test_from_subtask(self):
        """测试从 SubTask 字典创建 MiningStep"""
        subtask_dict = {
            "name": "测试任务",
            "description": "测试描述",
            "expected_outcome": "测试成果",
            "state": "in_progress"
        }
        
        step = MiningStep.from_subtask(subtask_dict, MiningStepType.EXECUTE)
        
        assert step.title == "测试任务"
        assert step.description == "测试描述"
        assert step.expected_outcome == "测试成果"
        assert step.status == MiningStepStatus.IN_PROGRESS
        assert step.step_type == MiningStepType.EXECUTE
    
    def test_to_oneline_markdown(self):
        """测试单行 Markdown 输出"""
        step = MiningStep(
            step_type=MiningStepType.SEARCH,
            title="搜索任务",
            description="搜索相关信息"
        )
        
        # PENDING
        assert "- [ ]" in step.to_oneline_markdown()
        assert "搜索任务" in step.to_oneline_markdown()
        
        # IN_PROGRESS
        step.status = MiningStepStatus.IN_PROGRESS
        assert "[WIP]" in step.to_oneline_markdown()
        
        # COMPLETED
        step.status = MiningStepStatus.COMPLETED
        assert "- [x]" in step.to_oneline_markdown()


# =============================================================================
# MiningPlannerAgent + PlanNotebook 集成测试
# =============================================================================

class TestMiningPlannerAgentIntegration:
    """MiningPlannerAgent 与 PlanNotebook 集成测试"""
    
    @pytest.fixture
    def planner_with_notebook(self):
        """创建带 PlanNotebook 的 MiningPlannerAgent"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        return planner, notebook
    
    @pytest.fixture
    def planner_without_notebook(self):
        """创建不带 PlanNotebook 的 MiningPlannerAgent"""
        return MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True
        )
    
    def test_planner_initialization_with_notebook(self, planner_with_notebook):
        """测试带 PlanNotebook 的 Planner 初始化"""
        planner, notebook = planner_with_notebook
        
        assert planner.plan_notebook is not None
        assert planner.plan_notebook is notebook
    
    def test_planner_initialization_without_notebook(self, planner_without_notebook):
        """测试不带 PlanNotebook 的 Planner 初始化"""
        planner = planner_without_notebook
        
        assert planner.plan_notebook is None
    
    def test_get_stats_with_notebook(self, planner_with_notebook):
        """测试带 PlanNotebook 时的统计信息"""
        planner, _ = planner_with_notebook
        
        stats = planner.get_stats()
        
        assert stats["plan_notebook_enabled"] is True
        assert stats["has_current_plan"] is False
    
    def test_get_stats_without_notebook(self, planner_without_notebook):
        """测试不带 PlanNotebook 时的统计信息"""
        planner = planner_without_notebook
        
        stats = planner.get_stats()
        
        assert stats["plan_notebook_enabled"] is False
    
    def test_get_plan_tools(self, planner_with_notebook):
        """测试获取计划工具"""
        planner, _ = planner_with_notebook
        
        tools = planner.get_plan_tools()
        
        assert len(tools) == 8
        tool_names = [t.__name__ for t in tools]
        assert "create_plan" in tool_names
        assert "finish_subtask" in tool_names
    
    def test_get_plan_tools_without_notebook(self, planner_without_notebook):
        """测试不带 PlanNotebook 时获取计划工具"""
        planner = planner_without_notebook
        
        tools = planner.get_plan_tools()
        
        assert len(tools) == 0
    
    def test_get_plan_tool_schemas(self, planner_with_notebook):
        """测试获取计划工具 Schema"""
        planner, _ = planner_with_notebook
        
        schemas = planner.get_plan_tool_schemas()
        
        assert len(schemas) == 5
        schema_names = [s["function"]["name"] for s in schemas]
        assert "create_plan" in schema_names


# =============================================================================
# 计划同步测试
# =============================================================================

class TestPlanSynchronization:
    """MiningPlan 到 PlanNotebook 同步测试"""
    
    @pytest.mark.asyncio
    async def test_sync_plan_to_notebook(self):
        """测试将 MiningPlan 同步到 PlanNotebook"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 创建 MiningPlan
        mining_plan = MiningPlan(
            goal="分析 AgentScope 代码库",
            steps=[
                MiningStep(
                    step_type=MiningStepType.SEARCH,
                    title="克隆仓库",
                    description="克隆 AgentScope 仓库",
                    need_external_info=True,
                    expected_outcome="仓库克隆成功"
                ),
                MiningStep(
                    step_type=MiningStepType.ANALYZE,
                    title="分析代码结构",
                    description="分析主要模块和类",
                    expected_outcome="代码结构报告"
                ),
            ]
        )
        
        # 同步到 PlanNotebook
        await planner._sync_plan_to_notebook(mining_plan)
        
        # 验证同步结果
        assert notebook.current_plan is not None
        assert len(notebook.current_plan.subtasks) == 2
        assert notebook.current_plan.subtasks[0].name == "克隆仓库"
        assert notebook.current_plan.subtasks[1].name == "分析代码结构"
    
    @pytest.mark.asyncio
    async def test_plan_method_with_sync(self):
        """测试 plan() 方法自动同步到 PlanNotebook"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 生成计划（无 LLM，使用 fallback）
        plan = await planner.plan(
            goal="测试目标",
            sync_to_notebook=True
        )
        
        # 验证同步
        assert notebook.current_plan is not None
        assert len(notebook.current_plan.subtasks) == len(plan.steps)
    
    @pytest.mark.asyncio
    async def test_plan_method_without_sync(self):
        """测试 plan() 方法不同步到 PlanNotebook"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 生成计划但不同步
        await planner.plan(
            goal="测试目标",
            sync_to_notebook=False
        )
        
        # 验证未同步
        assert notebook.current_plan is None


# =============================================================================
# 步骤状态更新测试
# =============================================================================

class TestStepStatusUpdate:
    """步骤状态更新测试"""
    
    @pytest.mark.asyncio
    async def test_update_step_status(self):
        """测试更新步骤状态"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 先创建计划
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        # 更新第一个步骤状态
        success = await planner.update_step_status(0, MiningStepStatus.IN_PROGRESS)
        
        assert success is True
        assert notebook.current_plan.subtasks[0].state == "in_progress"
    
    @pytest.mark.asyncio
    async def test_update_step_status_with_outcome(self):
        """测试更新步骤状态并提供成果"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 创建计划
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        # 先标记为进行中
        await planner.update_step_status(0, MiningStepStatus.IN_PROGRESS)
        
        # 完成步骤
        success = await planner.update_step_status(
            0, 
            MiningStepStatus.COMPLETED,
            outcome="步骤完成，发现 5 个重要信息"
        )
        
        assert success is True
        assert notebook.current_plan.subtasks[0].state == "done"
        assert notebook.current_plan.subtasks[0].outcome == "步骤完成，发现 5 个重要信息"
    
    @pytest.mark.asyncio
    async def test_update_step_status_without_notebook(self):
        """测试不带 PlanNotebook 时更新步骤状态"""
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True
        )
        
        success = await planner.update_step_status(0, MiningStepStatus.IN_PROGRESS)
        
        assert success is False


# =============================================================================
# 状态提示测试
# =============================================================================

class TestPlanHint:
    """计划状态提示测试"""
    
    @pytest.mark.asyncio
    async def test_get_current_plan_hint_no_plan(self):
        """测试无计划时的提示"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        hint = await planner.get_current_plan_hint()
        
        assert hint is not None
        assert "create_plan" in hint
    
    @pytest.mark.asyncio
    async def test_get_current_plan_hint_with_plan(self):
        """测试有计划时的提示"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 创建计划
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        hint = await planner.get_current_plan_hint()
        
        assert hint is not None
        assert "update_subtask_state" in hint or "测试目标" in hint
    
    @pytest.mark.asyncio
    async def test_get_current_plan_hint_without_notebook(self):
        """测试不带 PlanNotebook 时的提示"""
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True
        )
        
        hint = await planner.get_current_plan_hint()
        
        assert hint is None


# =============================================================================
# 计划变更钩子测试
# =============================================================================

class TestPlanChangeHook:
    """计划变更钩子测试"""
    
    @pytest.mark.asyncio
    async def test_plan_change_hook_registered(self):
        """测试计划变更钩子是否注册"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 检查钩子是否注册
        hook_name = f"{planner.name}_sync_hook"
        assert hook_name in notebook._plan_change_hooks
    
    @pytest.mark.asyncio
    async def test_plan_change_hook_called(self):
        """测试计划变更时钩子被调用"""
        notebook = PlanNotebook()
        
        # 追踪钩子调用
        hook_calls = []
        
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 替换钩子以追踪调用
        original_hook = planner._on_plan_change
        def tracking_hook(nb, plan):
            hook_calls.append({"plan": plan})
            original_hook(nb, plan)
        
        notebook._plan_change_hooks[f"{planner.name}_sync_hook"] = tracking_hook
        
        # 创建计划触发钩子
        await planner.plan(goal="测试目标", sync_to_notebook=True)
        
        # 验证钩子被调用
        assert len(hook_calls) >= 1


# =============================================================================
# 完整工作流测试
# =============================================================================

class TestFullWorkflow:
    """完整工作流集成测试"""
    
    @pytest.mark.asyncio
    async def test_complete_mining_workflow(self):
        """测试完整的挖掘工作流"""
        notebook = PlanNotebook()
        planner = MiningPlannerAgent(
            name="TestPlanner",
            enable_clarification=False,
            auto_accept=True,
            plan_notebook=notebook
        )
        
        # 1. 生成挖掘计划
        plan = await planner.plan(
            goal="分析代码库结构",
            sync_to_notebook=True
        )
        
        assert plan is not None
        assert len(plan.steps) >= 1
        assert notebook.current_plan is not None
        
        # 2. 获取初始提示
        hint = await planner.get_current_plan_hint()
        assert hint is not None
        
        # 3. 开始第一个步骤
        await planner.update_step_status(0, MiningStepStatus.IN_PROGRESS)
        assert notebook.current_plan.subtasks[0].state == "in_progress"
        
        # 4. 完成第一个步骤
        await planner.update_step_status(
            0,
            MiningStepStatus.COMPLETED,
            outcome="第一步完成"
        )
        assert notebook.current_plan.subtasks[0].state == "done"
        
        # 5. 如果有更多步骤，验证下一个步骤已激活
        if len(notebook.current_plan.subtasks) > 1:
            assert notebook.current_plan.subtasks[1].state == "in_progress"
        
        # 6. 检查统计信息
        stats = planner.get_stats()
        assert stats["plans_generated"] >= 1
        assert stats["plan_notebook_enabled"] is True
        assert stats["has_current_plan"] is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

