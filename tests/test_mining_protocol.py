"""
Mining Protocol 冒烟测试

测试 DeerFlow 内化的挖掘协议数据模型。

测试覆盖：
1. MiningStepType 枚举
2. MiningStep 数据模型（创建、状态管理、重试）
3. MiningPlan 数据模型（创建、验证、约束自动修复）
4. 计划工厂函数（研究计划、探索计划、验证计划）
5. 边界条件和错误处理
"""

import pytest
from datetime import datetime, timezone
from typing import List

# 导入待测试的模块
from agenticx.protocols.mining_protocol import (
    MiningStepType,
    MiningStepStatus,
    MiningStep,
    ExplorationStrategy,
    StopCondition,
    MiningPlanStatus,
    MiningPlan,
    PlanValidationResult,
    validate_mining_plan,
    create_research_plan,
    create_exploration_plan,
    create_validation_plan,
)


# =============================================================================
# MiningStepType 测试
# =============================================================================

class TestMiningStepType:
    """MiningStepType 枚举测试"""
    
    def test_step_type_values(self):
        """测试步骤类型的值"""
        assert MiningStepType.SEARCH == "search"
        assert MiningStepType.ANALYZE == "analyze"
        assert MiningStepType.EXECUTE == "execute"
        assert MiningStepType.EXPLORE == "explore"
    
    def test_step_type_from_string(self):
        """测试从字符串创建枚举"""
        assert MiningStepType("search") == MiningStepType.SEARCH
        assert MiningStepType("analyze") == MiningStepType.ANALYZE
        assert MiningStepType("execute") == MiningStepType.EXECUTE
        assert MiningStepType("explore") == MiningStepType.EXPLORE
    
    def test_all_step_types_exist(self):
        """确保所有必需的步骤类型都存在"""
        required_types = {"search", "analyze", "execute", "explore"}
        actual_types = {t.value for t in MiningStepType}
        assert required_types == actual_types


# =============================================================================
# MiningStep 测试
# =============================================================================

class TestMiningStep:
    """MiningStep 数据模型测试"""
    
    def test_step_creation_minimal(self):
        """测试最小参数创建步骤"""
        step = MiningStep(
            step_type=MiningStepType.SEARCH,
            title="Search GitHub",
            description="Search for AI frameworks on GitHub"
        )
        
        assert step.step_type == MiningStepType.SEARCH
        assert step.title == "Search GitHub"
        assert step.description == "Search for AI frameworks on GitHub"
        assert step.need_external_info is False  # 默认值
        assert step.exploration_budget == 1  # 默认值
        assert step.status == MiningStepStatus.PENDING
        assert step.execution_result is None
        assert step.learned_insights == []
        assert step.id is not None  # 自动生成
    
    def test_step_creation_full(self):
        """测试完整参数创建步骤"""
        step = MiningStep(
            step_type=MiningStepType.EXPLORE,
            title="Explore API",
            description="Explore the REST API endpoints",
            need_external_info=True,
            exploration_budget=5,
        )
        
        assert step.step_type == MiningStepType.EXPLORE
        assert step.need_external_info is True
        assert step.exploration_budget == 5
    
    def test_step_mark_completed(self):
        """测试标记步骤完成"""
        step = MiningStep(
            step_type=MiningStepType.ANALYZE,
            title="Analyze Results",
            description="Analyze the search results"
        )
        
        step.mark_completed(
            result="Found 10 relevant frameworks",
            insights=["LangChain is popular", "DeerFlow uses LangGraph"]
        )
        
        assert step.status == MiningStepStatus.COMPLETED
        assert step.execution_result == "Found 10 relevant frameworks"
        assert len(step.learned_insights) == 2
        assert "LangChain is popular" in step.learned_insights
    
    def test_step_mark_failed(self):
        """测试标记步骤失败"""
        step = MiningStep(
            step_type=MiningStepType.EXECUTE,
            title="Run Code",
            description="Execute the test code"
        )
        
        step.mark_failed("Permission denied")
        
        assert step.status == MiningStepStatus.FAILED
        assert step.error == "Permission denied"
    
    def test_step_retry_mechanism(self):
        """测试步骤重试机制"""
        step = MiningStep(
            step_type=MiningStepType.EXPLORE,
            title="Explore",
            description="Exploration",
            exploration_budget=3
        )
        
        # 初始可以重试
        assert step.can_retry() is True
        
        # 消耗重试次数
        assert step.consume_retry() is True
        assert step.exploration_budget == 2
        
        assert step.consume_retry() is True
        assert step.exploration_budget == 1
        
        assert step.consume_retry() is True
        assert step.exploration_budget == 0
        
        # 无法再重试
        assert step.can_retry() is False
        assert step.consume_retry() is False
    
    def test_step_title_validation(self):
        """测试标题验证"""
        # 空标题应该失败
        with pytest.raises(Exception):
            MiningStep(
                step_type=MiningStepType.SEARCH,
                title="",
                description="Valid description"
            )
    
    def test_step_exploration_budget_bounds(self):
        """测试探索预算边界"""
        # 有效范围
        step = MiningStep(
            step_type=MiningStepType.EXPLORE,
            title="Test",
            description="Test",
            exploration_budget=10
        )
        assert step.exploration_budget == 10
        
        # 超出上限应该失败
        with pytest.raises(Exception):
            MiningStep(
                step_type=MiningStepType.EXPLORE,
                title="Test",
                description="Test",
                exploration_budget=11
            )


# =============================================================================
# MiningPlan 测试
# =============================================================================

class TestMiningPlan:
    """MiningPlan 数据模型测试"""
    
    @pytest.fixture
    def sample_steps(self) -> List[MiningStep]:
        """创建示例步骤列表"""
        return [
            MiningStep(
                step_type=MiningStepType.SEARCH,
                title="Search",
                description="Search for info",
                need_external_info=True
            ),
            MiningStep(
                step_type=MiningStepType.ANALYZE,
                title="Analyze",
                description="Analyze results"
            ),
        ]
    
    def test_plan_creation_minimal(self, sample_steps):
        """测试最小参数创建计划"""
        plan = MiningPlan(
            goal="Find best AI framework",
            steps=sample_steps
        )
        
        assert plan.goal == "Find best AI framework"
        assert len(plan.steps) == 2
        assert plan.exploration_strategy == ExplorationStrategy.BREADTH_FIRST
        assert plan.stop_condition == StopCondition.MAX_STEPS
        assert plan.max_total_cost == 10.0
        assert plan.status == MiningPlanStatus.DRAFT
        assert plan.total_cost == 0.0
        assert plan.current_step_index == 0
    
    def test_plan_creation_full(self, sample_steps):
        """测试完整参数创建计划"""
        plan = MiningPlan(
            goal="Deep research",
            steps=sample_steps,
            exploration_strategy=ExplorationStrategy.DEPTH_FIRST,
            stop_condition=StopCondition.COST_LIMIT,
            max_total_cost=50.0,
            max_steps=20
        )
        
        assert plan.exploration_strategy == ExplorationStrategy.DEPTH_FIRST
        assert plan.stop_condition == StopCondition.COST_LIMIT
        assert plan.max_total_cost == 50.0
        assert plan.max_steps == 20
    
    def test_plan_validate_constraints_with_external_info(self, sample_steps):
        """测试有外部信息步骤时的约束验证"""
        plan = MiningPlan(
            goal="Test goal",
            steps=sample_steps  # 第一个步骤已有 need_external_info=True
        )
        
        result = plan.validate_constraints()
        
        assert result is True
        assert plan.status == MiningPlanStatus.VALIDATED
    
    def test_plan_validate_constraints_auto_repair_search_step(self):
        """测试自动修复：标记 SEARCH 步骤为需要外部信息"""
        steps = [
            MiningStep(
                step_type=MiningStepType.SEARCH,
                title="Search",
                description="Search",
                need_external_info=False  # 故意设为 False
            ),
            MiningStep(
                step_type=MiningStepType.ANALYZE,
                title="Analyze",
                description="Analyze"
            ),
        ]
        
        plan = MiningPlan(goal="Test", steps=steps)
        result = plan.validate_constraints()
        
        assert result is True
        assert plan.steps[0].need_external_info is True  # 被自动修复
    
    def test_plan_validate_constraints_auto_insert_search(self):
        """测试自动修复：插入 SEARCH 步骤"""
        steps = [
            MiningStep(
                step_type=MiningStepType.ANALYZE,
                title="Analyze",
                description="Analyze only",
                need_external_info=False
            ),
        ]
        
        plan = MiningPlan(goal="Test goal", steps=steps)
        original_count = len(plan.steps)
        
        result = plan.validate_constraints()
        
        assert result is True
        assert len(plan.steps) == original_count + 1
        assert plan.steps[0].step_type == MiningStepType.SEARCH
        assert plan.steps[0].need_external_info is True
        assert "Initial External Search" in plan.steps[0].title
    
    def test_plan_get_current_step(self, sample_steps):
        """测试获取当前步骤"""
        plan = MiningPlan(goal="Test", steps=sample_steps)
        
        current = plan.get_current_step()
        assert current is not None
        assert current.title == "Search"
    
    def test_plan_advance_to_next_step(self, sample_steps):
        """测试推进到下一步骤"""
        plan = MiningPlan(goal="Test", steps=sample_steps)
        
        next_step = plan.advance_to_next_step()
        assert next_step is not None
        assert next_step.title == "Analyze"
        assert plan.current_step_index == 1
        
        # 再推进一步（超出范围）
        beyond = plan.advance_to_next_step()
        assert beyond is None
    
    def test_plan_cost_tracking(self, sample_steps):
        """测试成本追踪"""
        plan = MiningPlan(goal="Test", steps=sample_steps, max_total_cost=1.0)
        
        # 在预算内
        assert plan.add_cost(0.5) is True
        assert plan.total_cost == 0.5
        
        # 仍在预算内
        assert plan.add_cost(0.5) is True
        assert plan.total_cost == 1.0
        
        # 超出预算
        assert plan.add_cost(0.1) is False
        assert plan.total_cost == 1.1
    
    def test_plan_is_complete(self, sample_steps):
        """测试计划完成判断"""
        plan = MiningPlan(goal="Test", steps=sample_steps)
        
        # 初始未完成
        assert plan.is_complete() is False
        
        # 标记所有步骤完成
        for step in plan.steps:
            step.mark_completed("Done")
        
        assert plan.is_complete() is True
    
    def test_plan_is_complete_by_status(self, sample_steps):
        """测试通过状态判断计划完成"""
        plan = MiningPlan(goal="Test", steps=sample_steps)
        
        plan.mark_completed()
        assert plan.is_complete() is True
        
        plan2 = MiningPlan(goal="Test2", steps=sample_steps.copy())
        plan2.mark_failed("Error")
        assert plan2.is_complete() is True
    
    def test_plan_get_progress(self, sample_steps):
        """测试进度计算"""
        plan = MiningPlan(goal="Test", steps=sample_steps)
        
        # 初始进度 0
        assert plan.get_progress() == 0.0
        
        # 完成一个步骤
        plan.steps[0].mark_completed("Done")
        assert plan.get_progress() == 0.5
        
        # 完成所有步骤
        plan.steps[1].mark_completed("Done")
        assert plan.get_progress() == 1.0
    
    def test_plan_get_insights(self, sample_steps):
        """测试收集洞察"""
        plan = MiningPlan(goal="Test", steps=sample_steps)
        
        plan.steps[0].mark_completed("Done", ["Insight 1", "Insight 2"])
        plan.steps[1].mark_completed("Done", ["Insight 3"])
        
        insights = plan.get_insights()
        assert len(insights) == 3
        assert "Insight 1" in insights
        assert "Insight 3" in insights
    
    def test_plan_to_summary(self, sample_steps):
        """测试生成计划摘要"""
        plan = MiningPlan(goal="Find AI frameworks", steps=sample_steps)
        plan.steps[0].mark_completed("Found 5 frameworks")
        
        summary = plan.to_summary()
        
        assert "Find AI frameworks" in summary
        assert "Progress:" in summary
        assert "Search" in summary
        assert "Analyze" in summary


# =============================================================================
# validate_mining_plan 函数测试
# =============================================================================

class TestValidateMiningPlan:
    """validate_mining_plan 函数测试"""
    
    def test_validate_valid_plan(self):
        """测试验证有效计划"""
        steps = [
            MiningStep(
                step_type=MiningStepType.SEARCH,
                title="Search",
                description="Search",
                need_external_info=True
            ),
        ]
        plan = MiningPlan(goal="Test", steps=steps)
        
        result = validate_mining_plan(plan)
        
        assert result.valid is True
        assert result.auto_repaired is False
        assert len(result.repairs) == 0
    
    def test_validate_with_auto_repair(self):
        """测试带自动修复的验证"""
        steps = [
            MiningStep(
                step_type=MiningStepType.ANALYZE,
                title="Analyze",
                description="Analyze only"
            ),
        ]
        plan = MiningPlan(goal="Test", steps=steps)
        
        result = validate_mining_plan(plan)
        
        assert result.valid is True
        assert result.auto_repaired is True
        assert len(result.repairs) > 0
    
    def test_validate_with_warnings(self):
        """测试带警告的验证"""
        steps = [
            MiningStep(
                step_type=MiningStepType.EXPLORE,
                title="Explore",
                description="Explore",
                need_external_info=True,
                exploration_budget=8  # 高预算会触发警告
            ),
        ]
        plan = MiningPlan(goal="Test", steps=steps, max_total_cost=100.0)  # 高成本会触发警告
        
        result = validate_mining_plan(plan)
        
        assert result.valid is True
        assert len(result.warnings) >= 2  # 高预算和高成本警告


# =============================================================================
# 计划工厂函数测试
# =============================================================================

class TestPlanFactories:
    """计划工厂函数测试"""
    
    def test_create_research_plan(self):
        """测试创建研究计划"""
        plan = create_research_plan(
            goal="Research AI frameworks",
            topics=["LangChain", "DeerFlow"],
            max_cost=5.0
        )
        
        assert "Research AI frameworks" in plan.goal
        # 每个主题有 SEARCH + ANALYZE = 2 步骤，共 4 步
        assert len(plan.steps) == 4
        assert plan.max_total_cost == 5.0
        assert plan.exploration_strategy == ExplorationStrategy.BREADTH_FIRST
        
        # 验证有 SEARCH 步骤需要外部信息
        search_steps = [s for s in plan.steps if s.step_type == MiningStepType.SEARCH]
        assert len(search_steps) == 2
        assert all(s.need_external_info for s in search_steps)
    
    def test_create_exploration_plan(self):
        """测试创建探索计划"""
        plan = create_exploration_plan(
            goal="Explore new APIs",
            initial_directions=["REST API", "GraphQL"],
            depth=3,
            max_cost=10.0
        )
        
        assert "Explore new APIs" in plan.goal
        # 1 初始搜索 + 2 探索方向 + 1 合成 = 4 步骤
        assert len(plan.steps) == 4
        assert plan.exploration_strategy == ExplorationStrategy.ADAPTIVE
        assert plan.stop_condition == StopCondition.COST_LIMIT
        
        # 验证初始搜索
        assert plan.steps[0].step_type == MiningStepType.SEARCH
        assert plan.steps[0].need_external_info is True
        
        # 验证探索步骤有正确的预算
        explore_steps = [s for s in plan.steps if s.step_type == MiningStepType.EXPLORE]
        assert len(explore_steps) == 2
        assert all(s.exploration_budget == 3 for s in explore_steps)
    
    def test_create_validation_plan(self):
        """测试创建验证计划"""
        plan = create_validation_plan(
            hypothesis="LLMs can reduce token cost by 50%",
            validation_approaches=["A/B testing", "Benchmark"],
            max_cost=5.0
        )
        
        assert "Validate" in plan.goal
        # 1 搜索 + 2 执行 + 1 分析 = 4 步骤
        assert len(plan.steps) == 4
        assert plan.exploration_strategy == ExplorationStrategy.DEPTH_FIRST
        assert plan.stop_condition == StopCondition.CONFIDENCE_THRESHOLD
        assert plan.confidence_threshold == 0.85
        
        # 验证有 EXECUTE 步骤
        execute_steps = [s for s in plan.steps if s.step_type == MiningStepType.EXECUTE]
        assert len(execute_steps) == 2


# =============================================================================
# 集成测试
# =============================================================================

class TestMiningProtocolIntegration:
    """Mining Protocol 集成测试"""
    
    def test_full_plan_lifecycle(self):
        """测试完整的计划生命周期"""
        # 1. 创建计划
        plan = create_research_plan(
            goal="Find the best vector database",
            topics=["Qdrant", "Milvus"]
        )
        
        # 2. 验证计划
        result = validate_mining_plan(plan)
        assert result.valid is True
        assert plan.status == MiningPlanStatus.VALIDATED
        
        # 3. 开始执行
        plan.status = MiningPlanStatus.IN_PROGRESS
        
        # 4. 执行步骤
        for step in plan.steps:
            step.mark_completed(
                f"Completed: {step.title}",
                [f"Learned from {step.title}"]
            )
            plan.add_cost(0.5)
        
        # 5. 完成计划
        assert plan.is_complete() is True
        plan.mark_completed()
        
        # 6. 收集结果
        insights = plan.get_insights()
        assert len(insights) == 4  # 每个步骤一个洞察
        
        summary = plan.to_summary()
        assert "100.0%" in summary  # 完成进度
    
    def test_plan_with_failures_and_retries(self):
        """测试带失败和重试的计划"""
        steps = [
            MiningStep(
                step_type=MiningStepType.EXPLORE,
                title="Risky Exploration",
                description="May fail",
                need_external_info=True,
                exploration_budget=3
            ),
        ]
        plan = MiningPlan(goal="Test retries", steps=steps)
        
        # 模拟失败和重试
        step = plan.get_current_step()
        
        # 第一次失败
        step.mark_failed("Network error")
        assert step.can_retry() is True
        
        # 重试
        step.consume_retry()
        step.status = MiningStepStatus.PENDING  # 重置状态
        
        # 第二次失败
        step.mark_failed("Timeout")
        step.consume_retry()
        step.status = MiningStepStatus.PENDING
        
        # 第三次成功
        step.consume_retry()
        step.mark_completed("Finally succeeded!")
        
        assert step.status == MiningStepStatus.COMPLETED
        assert step.exploration_budget == 0
    
    def test_module_imports(self):
        """测试模块导入"""
        from agenticx.protocols import (
            MiningStepType,
            MiningStep,
            MiningPlan,
            validate_mining_plan,
            create_research_plan,
        )
        
        # 验证导入成功
        assert MiningStepType.SEARCH == "search"
        assert MiningStep is not None
        assert MiningPlan is not None


# =============================================================================
# 运行测试
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])

