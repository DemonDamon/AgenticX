"""
冒烟测试: ExecutionPlanManager 和 AdaptivePlanner

测试基于 Refly 内化的计划管理和动态重规划功能。

References:
    - Refly: apps/api/src/modules/pilot/pilot-engine.service.ts
"""

import pytest
import tempfile
import os

from agenticx.flow.execution_plan import (
    ExecutionPlan,
    ExecutionStage,
    Subtask,
    SubtaskStatus,
    InterventionState,
)
from agenticx.flow.execution_plan_manager import (
    ExecutionPlanManager,
    InMemoryPlanStorage,
    FilePlanStorage,
    PlanEvent,
)
from agenticx.planner.adaptive_planner import (
    AdaptivePlanner,
    MockLLM,
    PlanPatch,
    PlanPatchOperation,
    SubtaskPatch,
    StagePatch,
)


class TestInMemoryPlanStorage:
    """InMemoryPlanStorage 测试"""
    
    def test_save_and_load(self):
        """测试保存和加载"""
        storage = InMemoryPlanStorage()
        
        plan_data = {"session_id": "test_001", "goal": "测试"}
        storage.save_plan("test_001", plan_data)
        
        loaded = storage.load_plan("test_001")
        assert loaded == plan_data
    
    def test_load_nonexistent(self):
        """测试加载不存在的计划"""
        storage = InMemoryPlanStorage()
        
        loaded = storage.load_plan("nonexistent")
        assert loaded is None
    
    def test_delete(self):
        """测试删除"""
        storage = InMemoryPlanStorage()
        
        storage.save_plan("test_001", {"goal": "测试"})
        result = storage.delete_plan("test_001")
        
        assert result is True
        assert storage.load_plan("test_001") is None
    
    def test_list_plans(self):
        """测试列出计划"""
        storage = InMemoryPlanStorage()
        
        storage.save_plan("plan_1", {})
        storage.save_plan("plan_2", {})
        
        plans = storage.list_plans()
        assert set(plans) == {"plan_1", "plan_2"}


class TestFilePlanStorage:
    """FilePlanStorage 测试"""
    
    def test_save_and_load(self):
        """测试文件存储保存和加载"""
        with tempfile.TemporaryDirectory() as tmpdir:
            storage = FilePlanStorage(storage_dir=tmpdir)
            
            plan_data = {"session_id": "file_test", "goal": "文件测试"}
            storage.save_plan("file_test", plan_data)
            
            loaded = storage.load_plan("file_test")
            assert loaded["goal"] == "文件测试"
    
    def test_persistence(self):
        """测试持久化"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 第一个存储实例保存
            storage1 = FilePlanStorage(storage_dir=tmpdir)
            storage1.save_plan("persist_test", {"goal": "持久化测试"})
            
            # 第二个存储实例加载
            storage2 = FilePlanStorage(storage_dir=tmpdir)
            loaded = storage2.load_plan("persist_test")
            
            assert loaded["goal"] == "持久化测试"


class TestExecutionPlanManager:
    """ExecutionPlanManager 测试"""
    
    def test_register_and_get(self):
        """测试注册和获取计划"""
        manager = ExecutionPlanManager()
        
        plan = ExecutionPlan(session_id="mgr_test_001", goal="管理器测试")
        manager.register(plan)
        
        retrieved = manager.get("mgr_test_001")
        assert retrieved is not None
        assert retrieved.goal == "管理器测试"
    
    def test_get_nonexistent(self):
        """测试获取不存在的计划"""
        manager = ExecutionPlanManager()
        
        result = manager.get("nonexistent")
        assert result is None
    
    def test_get_or_create(self):
        """测试获取或创建"""
        manager = ExecutionPlanManager()
        
        # 创建新计划
        plan1 = manager.get_or_create("new_session", goal="新任务")
        assert plan1.goal == "新任务"
        
        # 获取已存在的计划
        plan2 = manager.get_or_create("new_session", goal="不同目标")
        assert plan2.session_id == plan1.session_id
        assert plan2.goal == "新任务"  # 保持原目标
    
    def test_update(self):
        """测试更新计划"""
        manager = ExecutionPlanManager()
        
        plan = ExecutionPlan(session_id="update_test", goal="原始目标")
        manager.register(plan)
        
        plan.goal = "更新后的目标"
        manager.update(plan)
        
        retrieved = manager.get("update_test")
        assert retrieved.goal == "更新后的目标"
    
    def test_delete(self):
        """测试删除计划"""
        manager = ExecutionPlanManager()
        
        plan = ExecutionPlan(session_id="delete_test", goal="待删除")
        manager.register(plan)
        
        result = manager.delete("delete_test")
        assert result is True
        assert manager.get("delete_test") is None
    
    def test_list_sessions(self):
        """测试列出会话"""
        manager = ExecutionPlanManager()
        
        manager.register(ExecutionPlan(session_id="session_a", goal="A"))
        manager.register(ExecutionPlan(session_id="session_b", goal="B"))
        
        sessions = manager.list_sessions()
        assert "session_a" in sessions
        assert "session_b" in sessions


class TestExecutionPlanManagerOperations:
    """ExecutionPlanManager 操作方法测试"""
    
    def test_add_subtask_to_plan(self):
        """测试向计划添加子任务"""
        manager = ExecutionPlanManager()
        
        plan = ExecutionPlan(
            session_id="op_test",
            goal="操作测试",
            stages=[ExecutionStage(name="阶段1")]
        )
        manager.register(plan)
        
        subtask = manager.add_subtask_to_plan(
            "op_test",
            name="新子任务",
            query="查询内容"
        )
        
        assert subtask is not None
        assert subtask.name == "新子任务"
        
        # 验证计划已更新
        updated_plan = manager.get("op_test")
        assert len(updated_plan.stages[0].subtasks) == 1
    
    def test_delete_subtask_from_plan(self):
        """测试从计划删除子任务"""
        manager = ExecutionPlanManager()
        
        subtask = Subtask(id="to_delete", name="待删除", query="q")
        plan = ExecutionPlan(
            session_id="del_test",
            goal="删除测试",
            stages=[ExecutionStage(name="阶段", subtasks=[subtask])]
        )
        manager.register(plan)
        
        result = manager.delete_subtask_from_plan("del_test", "to_delete")
        
        assert result is True
        updated_plan = manager.get("del_test")
        assert len(updated_plan.stages[0].subtasks) == 0
    
    def test_update_subtask_status(self):
        """测试更新子任务状态"""
        manager = ExecutionPlanManager()
        
        subtask = Subtask(id="status_test", name="状态测试", query="q")
        plan = ExecutionPlan(
            session_id="status_plan",
            goal="状态测试",
            stages=[ExecutionStage(name="阶段", subtasks=[subtask])]
        )
        manager.register(plan)
        
        # 更新为完成
        result = manager.update_subtask_status(
            "status_plan",
            "status_test",
            SubtaskStatus.COMPLETED,
            result={"data": "success"}
        )
        
        assert result is True
        updated = manager.get("status_plan")
        updated_subtask = updated.stages[0].subtasks[0]
        assert updated_subtask.status == SubtaskStatus.COMPLETED
        assert updated_subtask.result == {"data": "success"}


class TestExecutionPlanManagerIntervention:
    """ExecutionPlanManager 干预操作测试"""
    
    def test_pause_plan(self):
        """测试暂停计划"""
        manager = ExecutionPlanManager()
        
        plan = ExecutionPlan(session_id="pause_test", goal="暂停测试")
        manager.register(plan)
        
        result = manager.pause_plan("pause_test")
        
        assert result is True
        updated = manager.get("pause_test")
        assert updated.intervention_state == InterventionState.PAUSED
    
    def test_resume_plan(self):
        """测试恢复计划"""
        manager = ExecutionPlanManager()
        
        plan = ExecutionPlan(session_id="resume_test", goal="恢复测试")
        plan.pause()  # 先暂停
        manager.register(plan)
        
        result = manager.resume_plan("resume_test")
        
        assert result is True
        updated = manager.get("resume_test")
        assert updated.intervention_state == InterventionState.RESUMING
    
    def test_reset_subtask(self):
        """测试重置子任务"""
        manager = ExecutionPlanManager()
        
        subtask = Subtask(id="reset_me", name="重置测试", query="q")
        subtask.mark_completed(result="done")
        
        plan = ExecutionPlan(
            session_id="reset_test",
            goal="重置测试",
            stages=[ExecutionStage(name="阶段", subtasks=[subtask])]
        )
        manager.register(plan)
        
        result = manager.reset_subtask("reset_test", "reset_me")
        
        assert result is True
        updated = manager.get("reset_test")
        assert updated.stages[0].subtasks[0].status == SubtaskStatus.PENDING


class TestExecutionPlanManagerEvents:
    """ExecutionPlanManager 事件系统测试"""
    
    def test_event_callback(self):
        """测试事件回调"""
        manager = ExecutionPlanManager()
        events_received = []
        
        def handler(event: PlanEvent):
            events_received.append(event)
        
        manager.on("plan_registered", handler)
        
        plan = ExecutionPlan(session_id="event_test", goal="事件测试")
        manager.register(plan)
        
        assert len(events_received) == 1
        assert events_received[0].event_type == "plan_registered"
        assert events_received[0].session_id == "event_test"
    
    def test_decorator_callback(self):
        """测试装饰器风格回调"""
        manager = ExecutionPlanManager()
        updates = []
        
        @manager.on_plan_updated
        def on_update(event):
            updates.append(event.session_id)
        
        plan = ExecutionPlan(session_id="decorator_test", goal="装饰器测试")
        manager.register(plan)
        
        plan.goal = "更新目标"
        manager.update(plan)
        
        assert "decorator_test" in updates


class TestAdaptivePlannerBasic:
    """AdaptivePlanner 基本测试"""
    
    def test_create_planner(self):
        """测试创建规划器"""
        planner = AdaptivePlanner()
        assert planner is not None
    
    def test_create_with_mock_llm(self):
        """测试使用 MockLLM 创建"""
        mock = MockLLM(response='{"operations": [], "reasoning": "test"}')
        planner = AdaptivePlanner(llm=mock)
        assert planner is not None


class TestAdaptivePlannerReplan:
    """AdaptivePlanner 重规划测试"""
    
    @pytest.mark.asyncio
    async def test_replan_empty_result(self):
        """测试重规划返回空结果"""
        mock = MockLLM(response='{"operations": [], "reasoning": "No changes needed"}')
        planner = AdaptivePlanner(llm=mock)
        
        plan = ExecutionPlan(goal="测试目标")
        patch = await planner.replan(plan)
        
        assert patch.is_empty
        assert "No changes" in patch.reasoning
    
    @pytest.mark.asyncio
    async def test_replan_with_feedback(self):
        """测试带用户反馈的重规划"""
        mock = MockLLM(response='''
        {
            "operations": [
                {
                    "operation": "add_subtask",
                    "stage_index": 0,
                    "data": {"name": "新任务", "query": "基于反馈"}
                }
            ],
            "reasoning": "Added task based on user feedback",
            "confidence": 0.9
        }
        ''')
        planner = AdaptivePlanner(llm=mock)
        
        plan = ExecutionPlan(
            goal="测试",
            stages=[ExecutionStage(name="阶段1")]
        )
        
        patch = await planner.replan(plan, user_feedback="需要增加新任务")
        
        assert not patch.is_empty
        assert len(patch.operations) == 1
        assert patch.confidence == 0.9


class TestAdaptivePlannerApplyPatch:
    """AdaptivePlanner Patch 应用测试"""
    
    def test_apply_empty_patch(self):
        """测试应用空 Patch"""
        planner = AdaptivePlanner()
        
        plan = ExecutionPlan(goal="测试")
        patch = PlanPatch(operations=[], reasoning="空操作")
        
        result = planner.apply_patch(plan, patch)
        
        assert result is plan  # 返回原计划
    
    def test_apply_add_subtask_patch(self):
        """测试应用添加子任务 Patch"""
        planner = AdaptivePlanner()
        
        plan = ExecutionPlan(
            goal="测试",
            stages=[ExecutionStage(name="阶段1")]
        )
        
        patch = PlanPatch(
            operations=[
                SubtaskPatch(
                    operation=PlanPatchOperation.ADD_SUBTASK,
                    stage_index=0,
                    data={"name": "新子任务", "query": "新查询"}
                )
            ],
            reasoning="添加子任务"
        )
        
        result = planner.apply_patch(plan, patch)
        
        assert len(result.stages[0].subtasks) == 1
        assert result.stages[0].subtasks[0].name == "新子任务"
    
    def test_apply_delete_subtask_patch(self):
        """测试应用删除子任务 Patch"""
        planner = AdaptivePlanner()
        
        subtask = Subtask(id="to_delete", name="待删", query="q")
        plan = ExecutionPlan(
            goal="测试",
            stages=[ExecutionStage(name="阶段", subtasks=[subtask])]
        )
        
        patch = PlanPatch(
            operations=[
                SubtaskPatch(
                    operation=PlanPatchOperation.DELETE_SUBTASK,
                    subtask_id="to_delete"
                )
            ],
            reasoning="删除子任务"
        )
        
        result = planner.apply_patch(plan, patch)
        
        assert len(result.stages[0].subtasks) == 0
    
    def test_apply_add_stage_patch(self):
        """测试应用添加阶段 Patch"""
        planner = AdaptivePlanner()
        
        plan = ExecutionPlan(goal="测试", stages=[])
        
        patch = PlanPatch(
            operations=[
                StagePatch(
                    operation=PlanPatchOperation.ADD_STAGE,
                    data={"name": "新阶段", "description": "描述"}
                )
            ],
            reasoning="添加阶段"
        )
        
        result = planner.apply_patch(plan, patch)
        
        assert len(result.stages) == 1
        assert result.stages[0].name == "新阶段"


class TestPlanPatch:
    """PlanPatch 测试"""
    
    def test_patch_is_empty(self):
        """测试空 Patch 检测"""
        empty_patch = PlanPatch(operations=[])
        assert empty_patch.is_empty
        
        non_empty_patch = PlanPatch(
            operations=[SubtaskPatch(operation=PlanPatchOperation.ADD_SUBTASK)]
        )
        assert not non_empty_patch.is_empty


class TestResponseParsing:
    """LLM 响应解析测试"""
    
    @pytest.mark.asyncio
    async def test_parse_json_with_markdown(self):
        """测试解析带 markdown 代码块的响应"""
        mock = MockLLM(response='''
Here is my analysis:

```json
{
    "operations": [
        {"operation": "add_subtask", "data": {"name": "task1", "query": "q1"}}
    ],
    "reasoning": "Added based on analysis",
    "confidence": 0.8
}
```
        ''')
        planner = AdaptivePlanner(llm=mock)
        
        plan = ExecutionPlan(goal="测试", stages=[ExecutionStage(name="s1")])
        patch = await planner.replan(plan)
        
        assert len(patch.operations) == 1
        assert patch.confidence == 0.8
    
    @pytest.mark.asyncio
    async def test_parse_invalid_json(self):
        """测试解析无效 JSON"""
        mock = MockLLM(response="This is not JSON at all")
        planner = AdaptivePlanner(llm=mock)
        
        plan = ExecutionPlan(goal="测试")
        patch = await planner.replan(plan)
        
        # 应该返回空 Patch 而不是崩溃
        assert patch.is_empty
        assert patch.confidence == 0.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

