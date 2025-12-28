"""
Plan Notebook 冒烟测试

验证内化自 AgentScope 的 PlanNotebook 组件的基本功能。
"""

import pytest
import asyncio
from datetime import datetime

from agenticx.core import (
    Plan, SubTask,
    InMemoryPlanStorage,
    PlanNotebook, DefaultPlanToHint
)


# =============================================================================
# SubTask 测试
# =============================================================================

class TestSubTask:
    """SubTask 数据模型测试"""
    
    def test_create_subtask(self):
        """测试创建子任务"""
        subtask = SubTask(
            name="分析代码",
            description="分析目标仓库的代码结构",
            expected_outcome="输出代码结构分析报告"
        )
        
        assert subtask.name == "分析代码"
        assert subtask.state == "todo"
        assert subtask.outcome is None
        assert subtask.finished_at is None
    
    def test_finish_subtask(self):
        """测试完成子任务"""
        subtask = SubTask(
            name="分析代码",
            description="分析目标仓库的代码结构",
            expected_outcome="输出代码结构分析报告"
        )
        
        subtask.finish("代码结构分析完成，主要包含 3 个模块")
        
        assert subtask.state == "done"
        assert subtask.outcome == "代码结构分析完成，主要包含 3 个模块"
        assert subtask.finished_at is not None
    
    def test_subtask_to_markdown(self):
        """测试子任务转 Markdown"""
        subtask = SubTask(
            name="分析代码",
            description="分析目标仓库的代码结构",
            expected_outcome="输出代码结构分析报告"
        )
        
        # 简洁模式
        md = subtask.to_markdown()
        assert "- [ ]" in md
        assert "分析代码" in md
        
        # 详细模式
        md_detailed = subtask.to_markdown(detailed=True)
        assert "Description:" in md_detailed
        assert "Expected Outcome:" in md_detailed
    
    def test_subtask_states(self):
        """测试不同状态的 Markdown 输出"""
        subtask = SubTask(
            name="测试任务",
            description="测试",
            expected_outcome="测试结果"
        )
        
        # todo
        assert "- [ ]" in subtask.to_markdown()
        
        # in_progress
        subtask.state = "in_progress"
        assert "[WIP]" in subtask.to_markdown()
        
        # abandoned
        subtask.state = "abandoned"
        assert "[Abandoned]" in subtask.to_markdown()
        
        # done
        subtask.finish("完成")
        assert "- [x]" in subtask.to_markdown()


# =============================================================================
# Plan 测试
# =============================================================================

class TestPlan:
    """Plan 数据模型测试"""
    
    def test_create_plan(self):
        """测试创建计划"""
        plan = Plan(
            name="代码分析计划",
            description="分析 AgentScope 代码库",
            expected_outcome="完成代码分析报告",
            subtasks=[
                SubTask(
                    name="克隆仓库",
                    description="克隆目标仓库",
                    expected_outcome="仓库克隆成功"
                ),
                SubTask(
                    name="分析结构",
                    description="分析代码结构",
                    expected_outcome="结构分析报告"
                ),
            ]
        )
        
        assert plan.name == "代码分析计划"
        assert plan.state == "todo"
        assert len(plan.subtasks) == 2
        assert plan.id is not None
    
    def test_refresh_plan_state(self):
        """测试计划状态刷新"""
        plan = Plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                SubTask(name="任务1", description="", expected_outcome=""),
                SubTask(name="任务2", description="", expected_outcome=""),
            ]
        )
        
        assert plan.state == "todo"
        
        # 开始第一个任务
        plan.subtasks[0].state = "in_progress"
        plan.refresh_plan_state()
        assert plan.state == "in_progress"
        
        # 完成第一个任务
        plan.subtasks[0].state = "done"
        plan.refresh_plan_state()
        assert plan.state == "todo"  # 没有 in_progress 的任务
    
    def test_plan_to_markdown(self):
        """测试计划转 Markdown"""
        plan = Plan(
            name="测试计划",
            description="测试描述",
            expected_outcome="测试成果",
            subtasks=[
                SubTask(name="任务1", description="", expected_outcome=""),
            ]
        )
        
        md = plan.to_markdown()
        assert "# 测试计划" in md
        assert "测试描述" in md
        assert "任务1" in md


# =============================================================================
# InMemoryPlanStorage 测试
# =============================================================================

class TestInMemoryPlanStorage:
    """内存计划存储测试"""
    
    @pytest.mark.asyncio
    async def test_add_and_get_plan(self):
        """测试添加和获取计划"""
        storage = InMemoryPlanStorage()
        
        plan = Plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[]
        )
        
        await storage.add_plan(plan)
        
        retrieved = await storage.get_plan(plan.id)
        assert retrieved is not None
        assert retrieved.name == "测试计划"
    
    @pytest.mark.asyncio
    async def test_get_all_plans(self):
        """测试获取所有计划"""
        storage = InMemoryPlanStorage()
        
        for i in range(3):
            plan = Plan(
                name=f"计划{i}",
                description="测试",
                expected_outcome="测试",
                subtasks=[]
            )
            await storage.add_plan(plan)
        
        plans = await storage.get_plans()
        assert len(plans) == 3
    
    @pytest.mark.asyncio
    async def test_delete_plan(self):
        """测试删除计划"""
        storage = InMemoryPlanStorage()
        
        plan = Plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[]
        )
        
        await storage.add_plan(plan)
        await storage.delete_plan(plan.id)
        
        retrieved = await storage.get_plan(plan.id)
        assert retrieved is None
    
    def test_state_dict(self):
        """测试状态序列化"""
        storage = InMemoryPlanStorage()
        
        # 同步创建计划
        plan = Plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[]
        )
        storage.plans[plan.id] = plan
        
        state = storage.state_dict()
        assert "plans" in state
        assert len(state["plans"]) == 1
        
        # 加载状态
        new_storage = InMemoryPlanStorage()
        new_storage.load_state_dict(state)
        assert len(new_storage.plans) == 1


# =============================================================================
# DefaultPlanToHint 测试
# =============================================================================

class TestDefaultPlanToHint:
    """默认提示生成器测试"""
    
    def test_no_plan_hint(self):
        """测试无计划时的提示"""
        hint_gen = DefaultPlanToHint()
        
        hint = hint_gen(None)
        assert hint is not None
        assert "create_plan" in hint
    
    def test_at_beginning_hint(self):
        """测试计划开始时的提示"""
        hint_gen = DefaultPlanToHint()
        
        plan = Plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                SubTask(name="任务1", description="", expected_outcome=""),
            ]
        )
        
        hint = hint_gen(plan)
        assert hint is not None
        assert "update_subtask_state" in hint
    
    def test_in_progress_hint(self):
        """测试任务进行中的提示"""
        hint_gen = DefaultPlanToHint()
        
        plan = Plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                SubTask(name="任务1", description="", expected_outcome="", state="in_progress"),
                SubTask(name="任务2", description="", expected_outcome=""),
            ]
        )
        
        hint = hint_gen(plan)
        assert hint is not None
        assert "in_progress" in hint
        assert "finish_subtask" in hint
    
    def test_at_end_hint(self):
        """测试所有任务完成时的提示"""
        hint_gen = DefaultPlanToHint()
        
        plan = Plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                SubTask(name="任务1", description="", expected_outcome="", state="done"),
            ]
        )
        
        hint = hint_gen(plan)
        assert hint is not None
        assert "finish_plan" in hint


# =============================================================================
# PlanNotebook 核心测试
# =============================================================================

class TestPlanNotebook:
    """PlanNotebook 核心功能测试"""
    
    @pytest.mark.asyncio
    async def test_create_plan(self):
        """测试创建计划"""
        notebook = PlanNotebook()
        
        result = await notebook.create_plan(
            name="代码分析",
            description="分析代码结构",
            expected_outcome="分析报告",
            subtasks=[
                {
                    "name": "克隆仓库",
                    "description": "克隆目标仓库",
                    "expected_outcome": "仓库克隆成功"
                },
                {
                    "name": "分析结构",
                    "description": "分析代码结构",
                    "expected_outcome": "结构报告"
                }
            ]
        )
        
        assert result.success
        assert notebook.current_plan is not None
        assert notebook.current_plan.name == "代码分析"
        assert len(notebook.current_plan.subtasks) == 2
    
    @pytest.mark.asyncio
    async def test_update_subtask_state(self):
        """测试更新子任务状态"""
        notebook = PlanNotebook()
        
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                {"name": "任务1", "description": "", "expected_outcome": ""},
                {"name": "任务2", "description": "", "expected_outcome": ""},
            ]
        )
        
        # 将第一个任务标记为进行中
        result = await notebook.update_subtask_state(0, "in_progress")
        assert result.success
        assert notebook.current_plan.subtasks[0].state == "in_progress"
    
    @pytest.mark.asyncio
    async def test_update_subtask_state_validation(self):
        """测试更新子任务状态的验证"""
        notebook = PlanNotebook()
        
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                {"name": "任务1", "description": "", "expected_outcome": ""},
                {"name": "任务2", "description": "", "expected_outcome": ""},
            ]
        )
        
        # 不能跳过第一个任务直接开始第二个
        result = await notebook.update_subtask_state(1, "in_progress")
        assert not result.success
        assert "尚未完成" in result.content
    
    @pytest.mark.asyncio
    async def test_finish_subtask(self):
        """测试完成子任务"""
        notebook = PlanNotebook()
        
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                {"name": "任务1", "description": "", "expected_outcome": ""},
                {"name": "任务2", "description": "", "expected_outcome": ""},
            ]
        )
        
        await notebook.update_subtask_state(0, "in_progress")
        result = await notebook.finish_subtask(0, "任务1完成了")
        
        assert result.success
        assert notebook.current_plan.subtasks[0].state == "done"
        assert notebook.current_plan.subtasks[0].outcome == "任务1完成了"
        # 下一个任务自动激活
        assert notebook.current_plan.subtasks[1].state == "in_progress"
    
    @pytest.mark.asyncio
    async def test_revise_current_plan_add(self):
        """测试修改计划 - 添加子任务"""
        notebook = PlanNotebook()
        
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                {"name": "任务1", "description": "", "expected_outcome": ""},
            ]
        )
        
        result = await notebook.revise_current_plan(
            subtask_idx=1,
            action="add",
            subtask={"name": "任务2", "description": "", "expected_outcome": ""}
        )
        
        assert result.success
        assert len(notebook.current_plan.subtasks) == 2
        assert notebook.current_plan.subtasks[1].name == "任务2"
    
    @pytest.mark.asyncio
    async def test_revise_current_plan_delete(self):
        """测试修改计划 - 删除子任务"""
        notebook = PlanNotebook()
        
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                {"name": "任务1", "description": "", "expected_outcome": ""},
                {"name": "任务2", "description": "", "expected_outcome": ""},
            ]
        )
        
        result = await notebook.revise_current_plan(
            subtask_idx=1,
            action="delete"
        )
        
        assert result.success
        assert len(notebook.current_plan.subtasks) == 1
    
    @pytest.mark.asyncio
    async def test_finish_plan(self):
        """测试完成计划"""
        notebook = PlanNotebook()
        
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                {"name": "任务1", "description": "", "expected_outcome": ""},
            ]
        )
        
        result = await notebook.finish_plan("done", "计划完成")
        
        assert result.success
        assert notebook.current_plan is None
        
        # 检查历史记录
        historical = await notebook.storage.get_plans()
        assert len(historical) == 1
        assert historical[0].state == "done"
    
    @pytest.mark.asyncio
    async def test_view_historical_plans(self):
        """测试查看历史计划"""
        notebook = PlanNotebook()
        
        # 创建并完成一个计划
        await notebook.create_plan(
            name="计划1",
            description="测试",
            expected_outcome="测试",
            subtasks=[]
        )
        await notebook.finish_plan("done", "完成")
        
        # 查看历史
        result = await notebook.view_historical_plans()
        assert result.success
        assert "计划1" in result.content
    
    @pytest.mark.asyncio
    async def test_get_current_hint(self):
        """测试获取当前提示"""
        notebook = PlanNotebook()
        
        # 无计划时
        hint = await notebook.get_current_hint()
        assert hint is not None
        assert "create_plan" in hint.content
        
        # 有计划时
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[
                {"name": "任务1", "description": "", "expected_outcome": ""},
            ]
        )
        
        hint = await notebook.get_current_hint()
        assert hint is not None
        assert "测试计划" in hint.content
    
    @pytest.mark.asyncio
    async def test_list_tools(self):
        """测试获取工具列表"""
        notebook = PlanNotebook()
        
        tools = notebook.list_tools()
        
        assert len(tools) == 8
        tool_names = [t.__name__ for t in tools]
        assert "create_plan" in tool_names
        assert "finish_subtask" in tool_names
        assert "finish_plan" in tool_names
    
    @pytest.mark.asyncio
    async def test_get_tool_schemas(self):
        """测试获取工具 Schema"""
        notebook = PlanNotebook()
        
        schemas = notebook.get_tool_schemas()
        
        assert len(schemas) == 5
        schema_names = [s["function"]["name"] for s in schemas]
        assert "create_plan" in schema_names
        assert "finish_subtask" in schema_names
    
    @pytest.mark.asyncio
    async def test_plan_change_hooks(self):
        """测试计划变更钩子"""
        notebook = PlanNotebook()
        
        hook_called = {"count": 0}
        
        def my_hook(nb, plan):
            hook_called["count"] += 1
        
        notebook.register_plan_change_hook("test_hook", my_hook)
        
        # 创建计划会触发钩子
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[{"name": "任务1", "description": "", "expected_outcome": ""}]
        )
        
        assert hook_called["count"] == 1
        
        # 更新状态会触发钩子
        await notebook.update_subtask_state(0, "in_progress")
        assert hook_called["count"] == 2
        
        # 移除钩子
        notebook.remove_plan_change_hook("test_hook")
        await notebook.finish_subtask(0, "完成")
        assert hook_called["count"] == 2  # 钩子已移除，不再触发
    
    @pytest.mark.asyncio
    async def test_async_plan_change_hooks(self):
        """测试异步计划变更钩子"""
        notebook = PlanNotebook()
        
        hook_called = {"count": 0}
        
        async def my_async_hook(nb, plan):
            await asyncio.sleep(0.01)  # 模拟异步操作
            hook_called["count"] += 1
        
        notebook.register_plan_change_hook("async_hook", my_async_hook)
        
        await notebook.create_plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[]
        )
        
        assert hook_called["count"] == 1
    
    def test_state_dict(self):
        """测试状态序列化"""
        notebook = PlanNotebook()
        
        # 没有计划时
        state = notebook.state_dict()
        assert state["current_plan"] is None
        
        # 有计划时 (同步设置)
        notebook.current_plan = Plan(
            name="测试计划",
            description="测试",
            expected_outcome="测试",
            subtasks=[]
        )
        
        state = notebook.state_dict()
        assert state["current_plan"] is not None
        assert state["current_plan"]["name"] == "测试计划"
        
        # 加载状态
        new_notebook = PlanNotebook()
        new_notebook.load_state_dict(state)
        assert new_notebook.current_plan is not None
        assert new_notebook.current_plan.name == "测试计划"


# =============================================================================
# 集成场景测试
# =============================================================================

class TestPlanNotebookIntegration:
    """PlanNotebook 集成场景测试"""
    
    @pytest.mark.asyncio
    async def test_full_workflow(self):
        """测试完整的计划执行流程"""
        notebook = PlanNotebook()
        
        # 1. 创建计划
        result = await notebook.create_plan(
            name="代码分析计划",
            description="深度分析 AgentScope 代码库并内化关键能力",
            expected_outcome="完成 PlanNotebook 组件的内化",
            subtasks=[
                {
                    "name": "克隆仓库",
                    "description": "克隆 AgentScope 仓库到本地",
                    "expected_outcome": "仓库克隆成功"
                },
                {
                    "name": "分析源码",
                    "description": "分析 PlanNotebook 相关源码",
                    "expected_outcome": "源码分析笔记"
                },
                {
                    "name": "实现组件",
                    "description": "将 PlanNotebook 内化到 AgenticX",
                    "expected_outcome": "组件实现并测试通过"
                }
            ]
        )
        assert result.success
        
        # 2. 检查初始提示
        hint = await notebook.get_current_hint()
        assert "update_subtask_state" in hint.content
        
        # 3. 开始第一个任务
        result = await notebook.update_subtask_state(0, "in_progress")
        assert result.success
        assert notebook.current_plan.state == "in_progress"
        
        # 4. 完成第一个任务
        result = await notebook.finish_subtask(0, "仓库已克隆到 research/codedeepresearch/agentscope/upstream")
        assert result.success
        assert notebook.current_plan.subtasks[1].state == "in_progress"
        
        # 5. 完成第二个任务
        result = await notebook.finish_subtask(1, "源码分析完成，关键类：PlanNotebook, SubTask, Plan")
        assert result.success
        
        # 6. 完成第三个任务
        result = await notebook.finish_subtask(2, "组件已实现并通过测试")
        assert result.success
        
        # 7. 检查最终提示
        hint = await notebook.get_current_hint()
        assert "finish_plan" in hint.content
        
        # 8. 完成计划
        result = await notebook.finish_plan("done", "PlanNotebook 内化完成，所有测试通过")
        assert result.success
        assert notebook.current_plan is None
        
        # 9. 检查历史记录
        historical = await notebook.storage.get_plans()
        assert len(historical) == 1
        assert historical[0].name == "代码分析计划"
        assert historical[0].state == "done"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

