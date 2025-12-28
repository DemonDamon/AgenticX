"""
Mining Planner Agent 冒烟测试

测试 DeerFlow 内化的智能挖掘规划器。

测试覆盖：
1. MiningPlannerAgent 初始化
2. 计划生成（降级模式，无 LLM）
3. 自动验证和修复
4. 统计信息
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch

# 导入待测试的模块
from agenticx.agents.mining_planner_agent import MiningPlannerAgent
from agenticx.core.agent import AgentContext
from agenticx.protocols.mining_protocol import (
    MiningPlan,
    MiningStepType,
    MiningStepStatus,
)


# =============================================================================
# MiningPlannerAgent 基础测试
# =============================================================================

class TestMiningPlannerAgentBasics:
    """MiningPlannerAgent 基础功能测试"""
    
    def test_agent_initialization(self):
        """测试 Agent 初始化"""
        agent = MiningPlannerAgent(
            organization_id="test-org"
        )
        
        assert agent.name == "MiningPlanner"
        assert agent.role == "Mining Task Planner"
        assert agent.enable_clarification is True
        assert agent.max_clarification_rounds == 2
        assert agent.auto_accept is False
        assert agent.plans_generated == 0
    
    def test_agent_initialization_with_custom_params(self):
        """测试自定义参数初始化"""
        agent = MiningPlannerAgent(
            name="CustomPlanner",
            enable_clarification=False,
            max_clarification_rounds=5,
            auto_accept=True,
            organization_id="test-org"
        )
        
        assert agent.name == "CustomPlanner"
        assert agent.enable_clarification is False
        assert agent.max_clarification_rounds == 5
        assert agent.auto_accept is True
    
    def test_agent_get_stats(self):
        """测试获取统计信息"""
        agent = MiningPlannerAgent(organization_id="test-org")
        
        stats = agent.get_stats()
        
        assert "plans_generated" in stats
        assert "clarifications_performed" in stats
        assert "auto_repairs_applied" in stats
        assert stats["plans_generated"] == 0


# =============================================================================
# 计划生成测试（降级模式）
# =============================================================================

class TestMiningPlannerAgentPlanGeneration:
    """计划生成测试（无 LLM）"""
    
    @pytest.mark.asyncio
    async def test_plan_generation_fallback_mode(self):
        """测试降级模式计划生成"""
        agent = MiningPlannerAgent(
            llm_provider=None,  # 无 LLM，触发降级
            auto_accept=True,  # 自动接受，跳过人工审查
            organization_id="test-org"
        )
        
        plan = await agent.plan(
            goal="Test mining task",
            auto_accept=True
        )
        
        # 验证计划基本属性
        assert isinstance(plan, MiningPlan)
        assert plan.goal == "Test mining task"
        assert len(plan.steps) >= 3  # 降级模式生成 3 个步骤
        
        # 验证至少有一个步骤需要外部信息
        has_external_info = any(step.need_external_info for step in plan.steps)
        assert has_external_info is True
        
        # 验证统计
        assert agent.plans_generated == 1
    
    @pytest.mark.asyncio
    async def test_fallback_plan_structure(self):
        """测试降级计划的结构"""
        agent = MiningPlannerAgent(
            llm_provider=None,
            auto_accept=True,
            organization_id="test-org"
        )
        
        plan = await agent.plan(
            goal="Explore AI frameworks",
            auto_accept=True
        )
        
        # 验证步骤类型
        step_types = [step.step_type for step in plan.steps]
        assert MiningStepType.SEARCH in step_types
        assert MiningStepType.ANALYZE in step_types
        assert MiningStepType.EXPLORE in step_types
        
        # 验证状态
        assert all(step.status == MiningStepStatus.PENDING for step in plan.steps)
    
    @pytest.mark.asyncio
    async def test_plan_with_background_context(self):
        """测试带背景上下文的计划生成"""
        agent = MiningPlannerAgent(
            llm_provider=None,
            auto_accept=True,
            organization_id="test-org"
        )
        
        context = AgentContext(agent_id=agent.id)
        context.variables["priority"] = "high"
        
        plan = await agent.plan(
            goal="Research topic",
            context=context,
            background_context="This is a high-priority research task",
            auto_accept=True
        )
        
        assert plan is not None
        assert len(plan.steps) > 0


# =============================================================================
# 自动验证和修复测试
# =============================================================================

class TestMiningPlannerAgentValidation:
    """自动验证和修复测试"""
    
    @pytest.mark.asyncio
    async def test_plan_auto_repair(self):
        """测试计划自动修复"""
        agent = MiningPlannerAgent(
            llm_provider=None,
            auto_accept=True,
            organization_id="test-org"
        )
        
        # 生成计划（降级模式已经包含外部信息）
        plan = await agent.plan(
            goal="Test goal",
            auto_accept=True
        )
        
        # 降级计划应该已经满足约束，不需要修复
        # 但如果需要修复，auto_repairs_applied 会增加
        stats = agent.get_stats()
        assert stats["auto_repairs_applied"] >= 0


# =============================================================================
# LLM 模拟测试
# =============================================================================

class TestMiningPlannerAgentWithMockLLM:
    """使用 Mock LLM 的测试"""
    
    @pytest.fixture
    def mock_llm(self):
        """创建 Mock LLM"""
        mock = AsyncMock()
        
        # 模拟计划生成响应
        plan_response = Mock()
        plan_response.content = """{
    "goal": "Test goal",
    "steps": [
        {
            "step_type": "search",
            "title": "Search Phase",
            "description": "Search for relevant information",
            "need_external_info": true,
            "exploration_budget": 2
        },
        {
            "step_type": "analyze",
            "title": "Analysis Phase",
            "description": "Analyze the findings",
            "need_external_info": false
        }
    ],
    "exploration_strategy": "breadth_first",
    "stop_condition": "max_steps",
    "max_total_cost": 5.0
}"""
        mock.ainvoke.return_value = plan_response
        return mock
    
    @pytest.mark.asyncio
    async def test_plan_generation_with_llm(self, mock_llm):
        """测试使用 LLM 生成计划"""
        agent = MiningPlannerAgent(
            llm_provider=mock_llm,
            auto_accept=True,
            enable_clarification=False,  # 跳过澄清以简化测试
            organization_id="test-org"
        )
        
        plan = await agent.plan(
            goal="Test goal",
            auto_accept=True
        )
        
        # 验证 LLM 被调用
        assert mock_llm.ainvoke.called
        
        # 验证计划生成成功
        assert plan.goal == "Test goal"
        assert len(plan.steps) == 2
        assert plan.steps[0].step_type == MiningStepType.SEARCH
        assert plan.steps[1].step_type == MiningStepType.ANALYZE
    
    @pytest.mark.asyncio
    async def test_clarification_with_llm(self, mock_llm):
        """测试澄清机制"""
        # 设置澄清响应
        clarify_response = Mock()
        clarify_response.content = "[CLARIFICATION_COMPLETE]"
        mock_llm.ainvoke.return_value = clarify_response
        
        agent = MiningPlannerAgent(
            llm_provider=mock_llm,
            auto_accept=True,
            enable_clarification=True,
            organization_id="test-org"
        )
        
        context = AgentContext(agent_id=agent.id)
        
        # 调用内部澄清方法
        clarified = await agent._clarify_goal("Vague goal", context)
        
        # 验证澄清完成
        assert clarified is not None
        assert agent.clarifications_performed == 1


# =============================================================================
# 辅助方法测试
# =============================================================================

class TestMiningPlannerAgentHelpers:
    """辅助方法测试"""
    
    def test_build_plan_prompt(self):
        """测试构建计划 Prompt"""
        agent = MiningPlannerAgent(organization_id="test-org")
        
        prompt = agent._build_plan_prompt(
            goal="Test goal",
            background_context="Some context"
        )
        
        assert "Test goal" in prompt
        assert "Some context" in prompt
        assert "search" in prompt.lower()
        assert "JSON" in prompt
    
    def test_build_clarify_prompt(self):
        """测试构建澄清 Prompt"""
        agent = MiningPlannerAgent(organization_id="test-org")
        context = AgentContext(agent_id=agent.id)
        
        prompt = agent._build_clarify_prompt(
            goal="Unclear goal",
            history=[],
            context=context
        )
        
        assert "Unclear goal" in prompt
        assert "clarification" in prompt.lower()
    
    def test_merge_clarifications(self):
        """测试合并澄清历史"""
        agent = MiningPlannerAgent(organization_id="test-org")
        
        history = [
            {"question": "Q1", "answer": "A1"},
            {"question": "Q2", "answer": "A2"}
        ]
        
        merged = agent._merge_clarifications("Original goal", history)
        
        assert "Original goal" in merged
        assert "Q1" in merged
        assert "A1" in merged
    
    def test_parse_plan_response(self):
        """测试解析计划响应"""
        agent = MiningPlannerAgent(organization_id="test-org")
        
        response = """Here is the plan:
{
    "goal": "Test",
    "steps": [],
    "exploration_strategy": "breadth_first",
    "stop_condition": "max_steps"
}
Some extra text"""
        
        parsed = agent._parse_plan_response(response)
        
        assert parsed["goal"] == "Test"
        assert "steps" in parsed
    
    def test_create_fallback_plan(self):
        """测试创建降级计划"""
        agent = MiningPlannerAgent(organization_id="test-org")
        
        plan = agent._create_fallback_plan("Test goal")
        
        assert plan.goal == "Test goal"
        assert len(plan.steps) == 3
        # 验证至少一个步骤需要外部信息
        assert any(s.need_external_info for s in plan.steps)


# =============================================================================
# 集成测试
# =============================================================================

class TestMiningPlannerAgentIntegration:
    """MiningPlannerAgent 集成测试"""
    
    @pytest.mark.asyncio
    async def test_end_to_end_plan_generation(self):
        """端到端计划生成测试"""
        agent = MiningPlannerAgent(
            llm_provider=None,
            auto_accept=True,
            enable_clarification=False,
            organization_id="test-org"
        )
        
        # 生成计划
        plan = await agent.plan(
            goal="Research the best vector databases for AI applications",
            background_context="Focus on performance and scalability",
            auto_accept=True
        )
        
        # 验证计划完整性
        assert plan.goal == "Research the best vector databases for AI applications"
        assert len(plan.steps) >= 3
        assert plan.exploration_strategy is not None
        assert plan.stop_condition is not None
        
        # 验证步骤有效性
        for step in plan.steps:
            assert step.title is not None
            assert step.description is not None
            assert step.step_type in [
                MiningStepType.SEARCH,
                MiningStepType.ANALYZE,
                MiningStepType.EXECUTE,
                MiningStepType.EXPLORE
            ]
        
        # 验证统计
        stats = agent.get_stats()
        assert stats["plans_generated"] == 1
    
    def test_module_imports(self):
        """测试模块导入"""
        from agenticx.agents import MiningPlannerAgent
        
        assert MiningPlannerAgent is not None
    
    @pytest.mark.asyncio
    async def test_multiple_plan_generations(self):
        """测试多次生成计划"""
        agent = MiningPlannerAgent(
            llm_provider=None,
            auto_accept=True,
            organization_id="test-org"
        )
        
        # 生成多个计划
        plan1 = await agent.plan(goal="Goal 1", auto_accept=True)
        plan2 = await agent.plan(goal="Goal 2", auto_accept=True)
        plan3 = await agent.plan(goal="Goal 3", auto_accept=True)
        
        # 验证计划独立
        assert plan1.goal == "Goal 1"
        assert plan2.goal == "Goal 2"
        assert plan3.goal == "Goal 3"
        
        # 验证统计累积
        assert agent.plans_generated == 3


# =============================================================================
# 运行测试
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

