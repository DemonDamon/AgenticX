"""
冒烟测试: ExecutionPlan 协议

测试基于 Refly 内化的 ExecutionPlan 相关功能：
- Subtask, ExecutionStage, ExecutionPlan 数据结构
- InterventionState 状态机 (pause/resume/reset_node)
- Mermaid 序列化

References:
    - Refly: apps/api/src/modules/pilot/pilot.types.ts
    - AgenticX proposal: research/codedeepresearch/refly/refly_proposal.md
"""

import json
import pytest
from datetime import datetime

from agenticx.flow.execution_plan import (
    Subtask,
    SubtaskStatus,
    ExecutionStage,
    StageStatus,
    ExecutionPlan,
    InterventionState,
)


class TestSubtask:
    """Subtask 子任务测试"""
    
    def test_subtask_creation_with_defaults(self):
        """测试子任务创建（使用默认值）"""
        subtask = Subtask(name="搜索报告", query="低空经济趋势")
        
        assert subtask.name == "搜索报告"
        assert subtask.query == "低空经济趋势"
        assert subtask.status == SubtaskStatus.PENDING
        assert subtask.id.startswith("subtask_")
        assert subtask.result is None
        assert subtask.error is None
    
    def test_subtask_state_transitions(self):
        """测试子任务状态转换"""
        subtask = Subtask(name="test", query="query")
        
        # pending -> executing
        subtask.mark_executing()
        assert subtask.status == SubtaskStatus.EXECUTING
        
        # executing -> completed
        subtask.mark_completed(result={"data": [1, 2, 3]})
        assert subtask.status == SubtaskStatus.COMPLETED
        assert subtask.result == {"data": [1, 2, 3]}
        assert subtask.completed_at is not None
    
    def test_subtask_failure(self):
        """测试子任务失败标记"""
        subtask = Subtask(name="test", query="query")
        subtask.mark_executing()
        subtask.mark_failed("Network timeout")
        
        assert subtask.status == SubtaskStatus.FAILED
        assert subtask.error == "Network timeout"
    
    def test_subtask_reset(self):
        """测试子任务重置"""
        subtask = Subtask(name="test", query="query")
        subtask.mark_completed(result="done")
        
        subtask.reset()
        
        assert subtask.status == SubtaskStatus.PENDING
        assert subtask.result is None
        assert subtask.completed_at is None


class TestExecutionStage:
    """ExecutionStage 阶段测试"""
    
    def test_stage_creation(self):
        """测试阶段创建"""
        stage = ExecutionStage(
            name="数据收集",
            description="收集行业数据",
            objectives=["获取报告", "整理数据"],
        )
        
        assert stage.name == "数据收集"
        assert stage.status == StageStatus.PENDING
        assert len(stage.objectives) == 2
        assert stage.subtasks == []
    
    def test_stage_with_subtasks(self):
        """测试带子任务的阶段"""
        stage = ExecutionStage(
            name="测试阶段",
            subtasks=[
                Subtask(name="任务1", query="查询1"),
                Subtask(name="任务2", query="查询2"),
            ]
        )
        
        assert len(stage.subtasks) == 2
        assert stage.progress == 0.0
    
    def test_stage_progress_calculation(self):
        """测试阶段进度计算"""
        stage = ExecutionStage(
            name="测试阶段",
            subtasks=[
                Subtask(name="任务1", query="q1"),
                Subtask(name="任务2", query="q2"),
                Subtask(name="任务3", query="q3"),
                Subtask(name="任务4", query="q4"),
            ]
        )
        
        # 完成 2/4 任务
        stage.subtasks[0].mark_completed()
        stage.subtasks[1].mark_completed()
        
        assert stage.progress == 50.0
    
    def test_stage_add_remove_subtask(self):
        """测试添加/删除子任务"""
        stage = ExecutionStage(name="测试")
        
        subtask = Subtask(id="sub_001", name="任务1", query="q1")
        stage.add_subtask(subtask)
        
        assert len(stage.subtasks) == 1
        assert stage.get_subtask("sub_001") is not None
        
        # 删除
        result = stage.remove_subtask("sub_001")
        assert result is True
        assert len(stage.subtasks) == 0
    
    def test_stage_lifecycle(self):
        """测试阶段生命周期"""
        stage = ExecutionStage(name="测试")
        
        # 激活
        stage.activate()
        assert stage.status == StageStatus.ACTIVE
        assert stage.started_at is not None
        
        # 完成
        stage.complete(summary="阶段执行成功")
        assert stage.status == StageStatus.DONE
        assert stage.summary == "阶段执行成功"
        assert stage.completed_at is not None


class TestExecutionPlan:
    """ExecutionPlan 执行计划测试"""
    
    def test_plan_creation(self):
        """测试执行计划创建"""
        plan = ExecutionPlan(
            session_id="session_001",
            goal="研究低空经济",
        )
        
        assert plan.session_id == "session_001"
        assert plan.goal == "研究低空经济"
        assert plan.intervention_state == InterventionState.RUNNING
        assert plan.current_stage_index == 0
        assert plan.overall_progress == 0.0
    
    def test_plan_with_stages(self):
        """测试带阶段的执行计划"""
        plan = ExecutionPlan(
            goal="研究任务",
            stages=[
                ExecutionStage(
                    name="阶段1",
                    subtasks=[
                        Subtask(name="t1", query="q1"),
                        Subtask(name="t2", query="q2"),
                    ]
                ),
                ExecutionStage(
                    name="阶段2",
                    subtasks=[
                        Subtask(name="t3", query="q3"),
                    ]
                ),
            ]
        )
        
        assert len(plan.stages) == 2
        assert plan.current_stage is not None
        assert plan.current_stage.name == "阶段1"
    
    def test_plan_overall_progress(self):
        """测试整体进度计算"""
        plan = ExecutionPlan(
            goal="测试",
            stages=[
                ExecutionStage(
                    name="阶段1",
                    subtasks=[
                        Subtask(name="t1", query="q1"),
                        Subtask(name="t2", query="q2"),
                    ]
                ),
                ExecutionStage(
                    name="阶段2",
                    subtasks=[
                        Subtask(name="t3", query="q3"),
                        Subtask(name="t4", query="q4"),
                    ]
                ),
            ]
        )
        
        # 完成 2/4 任务
        plan.stages[0].subtasks[0].mark_completed()
        plan.stages[0].subtasks[1].mark_completed()
        
        assert plan.overall_progress == 50.0


class TestInterventionState:
    """InterventionState 干预状态测试"""
    
    def test_pause_resume_cycle(self):
        """测试暂停/恢复循环"""
        plan = ExecutionPlan(goal="测试")
        
        # 初始状态是 RUNNING
        assert plan.intervention_state == InterventionState.RUNNING
        assert not plan.is_paused
        
        # 暂停
        plan.pause()
        assert plan.intervention_state == InterventionState.PAUSED
        assert plan.is_paused
        
        # 重复暂停应该无操作
        plan.pause()
        assert plan.intervention_state == InterventionState.PAUSED
        
        # 恢复
        plan.resume()
        assert plan.intervention_state == InterventionState.RESUMING
        
        # 确认运行
        plan.confirm_running()
        assert plan.intervention_state == InterventionState.RUNNING
    
    def test_reset_node(self):
        """测试节点重置"""
        subtask = Subtask(id="target_001", name="目标任务", query="q")
        subtask.mark_completed(result="done")
        
        plan = ExecutionPlan(
            goal="测试",
            stages=[
                ExecutionStage(name="阶段", subtasks=[subtask])
            ]
        )
        
        # 重置节点
        result = plan.reset_node("target_001")
        
        assert result is True
        assert plan.intervention_state == InterventionState.RESETTING
        assert subtask.status == SubtaskStatus.PENDING
        assert subtask.result is None
    
    def test_reset_nonexistent_node(self):
        """测试重置不存在的节点"""
        plan = ExecutionPlan(goal="测试")
        
        result = plan.reset_node("nonexistent_id")
        
        assert result is False
        # 状态不应改变
        assert plan.intervention_state == InterventionState.RUNNING


class TestPlanModification:
    """ExecutionPlan 修改操作测试"""
    
    def test_add_subtask(self):
        """测试添加子任务"""
        plan = ExecutionPlan(
            goal="测试",
            stages=[ExecutionStage(name="阶段1")]
        )
        
        subtask = plan.add_subtask(
            name="新任务",
            query="新查询",
            context="测试上下文"
        )
        
        assert subtask.name == "新任务"
        assert len(plan.stages[0].subtasks) == 1
        assert plan.stages[0].subtasks[0] is subtask
    
    def test_delete_subtask(self):
        """测试删除子任务"""
        subtask = Subtask(id="to_delete", name="待删除", query="q")
        plan = ExecutionPlan(
            goal="测试",
            stages=[
                ExecutionStage(name="阶段", subtasks=[subtask])
            ]
        )
        
        result = plan.delete_subtask("to_delete")
        
        assert result is True
        assert len(plan.stages[0].subtasks) == 0
    
    def test_advance_stage(self):
        """测试推进阶段"""
        plan = ExecutionPlan(
            goal="测试",
            stages=[
                ExecutionStage(name="阶段1"),
                ExecutionStage(name="阶段2"),
                ExecutionStage(name="阶段3"),
            ]
        )
        
        assert plan.current_stage_index == 0
        
        # 推进到阶段2
        result = plan.advance_stage()
        assert result is True
        assert plan.current_stage_index == 1
        assert plan.stages[0].status == StageStatus.DONE
        assert plan.stages[1].status == StageStatus.ACTIVE
    
    def test_advance_stage_at_end(self):
        """测试在最后阶段推进"""
        plan = ExecutionPlan(
            goal="测试",
            stages=[ExecutionStage(name="唯一阶段")]
        )
        
        result = plan.advance_stage()
        
        assert result is False
        assert plan.current_stage_index == 0
    
    def test_advance_epoch(self):
        """测试推进纪元"""
        plan = ExecutionPlan(goal="测试", max_epochs=3)
        
        assert plan.current_epoch == 0
        
        # 推进3次应该成功
        for i in range(1, 4):
            result = plan.advance_epoch()
            assert result is True
            assert plan.current_epoch == i
        
        # 第4次应该失败（已达到 max_epochs）
        result = plan.advance_epoch()
        assert result is False


class TestMermaidSerialization:
    """Mermaid 序列化测试"""
    
    def test_empty_plan_mermaid(self):
        """测试空计划的 Mermaid 输出"""
        plan = ExecutionPlan(goal="空计划")
        
        mermaid = plan.to_mermaid()
        
        assert "```mermaid" in mermaid
        assert "EmptyPlan" in mermaid
    
    def test_plan_with_stages_mermaid(self):
        """测试带阶段的 Mermaid 输出"""
        plan = ExecutionPlan(
            goal="测试",
            stages=[
                ExecutionStage(
                    name="数据收集",
                    subtasks=[
                        Subtask(name="搜索报告", query="q1"),
                        Subtask(name="获取数据", query="q2"),
                    ]
                ),
                ExecutionStage(
                    name="数据分析",
                    subtasks=[
                        Subtask(name="统计分析", query="q3"),
                    ]
                ),
            ]
        )
        
        mermaid = plan.to_mermaid()
        
        assert "```mermaid" in mermaid
        assert "graph TD" in mermaid
        assert "数据收集" in mermaid
        assert "数据分析" in mermaid
        assert "搜索报告" in mermaid
        assert "Legend" in mermaid
    
    def test_mermaid_reflects_status(self):
        """测试 Mermaid 反映状态"""
        subtask = Subtask(name="已完成任务", query="q")
        subtask.mark_completed()
        
        plan = ExecutionPlan(
            goal="测试",
            stages=[
                ExecutionStage(name="阶段", subtasks=[subtask])
            ]
        )
        
        mermaid = plan.to_mermaid()
        
        # 应该包含完成状态的样式（绿色）
        assert "fill:#90EE90" in mermaid


class TestSerialization:
    """序列化/反序列化测试"""
    
    def test_to_dict_and_back(self):
        """测试字典序列化往返"""
        original = ExecutionPlan(
            session_id="session_123",
            goal="测试目标",
            stages=[
                ExecutionStage(
                    name="阶段1",
                    subtasks=[
                        Subtask(name="任务1", query="查询1"),
                    ]
                )
            ],
            max_epochs=10,
        )
        
        # 转为字典
        data = original.to_dict()
        
        # 从字典恢复
        restored = ExecutionPlan.from_dict(data)
        
        assert restored.session_id == original.session_id
        assert restored.goal == original.goal
        assert len(restored.stages) == 1
        assert restored.stages[0].name == "阶段1"
        assert len(restored.stages[0].subtasks) == 1
    
    def test_json_serialization(self):
        """测试 JSON 序列化"""
        plan = ExecutionPlan(
            goal="JSON测试",
            stages=[
                ExecutionStage(
                    name="阶段",
                    subtasks=[Subtask(name="任务", query="查询")]
                )
            ]
        )
        
        # 转为 JSON
        json_str = plan.model_dump_json()
        
        # 从 JSON 恢复
        restored = ExecutionPlan.model_validate_json(json_str)
        
        assert restored.goal == plan.goal
        assert len(restored.stages) == 1


class TestExecutionSummary:
    """执行摘要测试"""
    
    def test_execution_summary_generation(self):
        """测试执行摘要生成"""
        plan = ExecutionPlan(
            goal="研究任务",
            max_epochs=5,
            stages=[
                ExecutionStage(
                    name="已完成阶段",
                    status=StageStatus.DONE,
                    summary="成功获取数据"
                ),
                ExecutionStage(
                    name="进行中阶段",
                    status=StageStatus.ACTIVE,
                    subtasks=[
                        Subtask(name="任务1", query="q1"),
                        Subtask(name="任务2", query="q2"),
                    ]
                ),
            ],
            current_stage_index=1,
            current_epoch=2,
        )
        
        summary = plan.to_execution_summary()
        
        assert "研究任务" in summary
        assert "已完成阶段" in summary
        assert "成功获取数据" in summary
        assert "进行中阶段" in summary
        assert "2/5" in summary  # current_epoch/max_epochs


# Edge Cases
class TestEdgeCases:
    """边界情况测试"""
    
    def test_add_subtask_to_invalid_stage(self):
        """测试向无效阶段添加子任务"""
        plan = ExecutionPlan(goal="测试", stages=[])
        
        with pytest.raises(IndexError):
            plan.add_subtask(name="任务", query="查询", stage_index=0)
    
    def test_empty_stage_progress(self):
        """测试空阶段的进度"""
        stage = ExecutionStage(name="空阶段")
        
        assert stage.progress == 0.0
    
    def test_empty_plan_progress(self):
        """测试空计划的进度"""
        plan = ExecutionPlan(goal="空计划")
        
        assert plan.overall_progress == 0.0
    
    def test_plan_is_completed(self):
        """测试计划完成状态"""
        plan = ExecutionPlan(
            goal="测试",
            stages=[
                ExecutionStage(name="阶段1", status=StageStatus.DONE),
                ExecutionStage(name="阶段2", status=StageStatus.DONE),
            ]
        )
        
        assert plan.is_completed is True
    
    def test_subtask_name_with_special_chars(self):
        """测试包含特殊字符的任务名"""
        subtask = Subtask(name='任务"名称', query="查询'内容")
        plan = ExecutionPlan(
            goal="测试",
            stages=[ExecutionStage(name="阶段", subtasks=[subtask])]
        )
        
        # 应该能正常生成 Mermaid（特殊字符被转义）
        mermaid = plan.to_mermaid()
        assert "任务'名称" in mermaid  # " 被替换为 '


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

