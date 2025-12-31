"""
委派系统冒烟测试

验证 DelegateWorkTool 和 AskQuestionTool 的核心功能：
- Agent 匹配（精确/模糊）
- 任务委派执行
- 问题提问执行
- 错误处理
"""

import pytest
from agenticx.core.agent import Agent
from agenticx.collaboration.delegation import (
    DelegateWorkTool,
    AskQuestionTool,
    DelegationContext,
    sanitize_agent_name,
    find_agent_by_role,
    create_delegation_tools,
)
from agenticx.tools.base import ToolError


# ============================================================================
# Test Fixtures
# ============================================================================


@pytest.fixture
def sample_agents():
    """创建测试用的 Agent 列表"""
    return [
        Agent(
            name="Alice",
            role="Data Analyst",
            goal="Analyze data and provide insights",
            organization_id="test-org"
        ),
        Agent(
            name="Bob",
            role="Software Engineer",
            goal="Build software solutions",
            organization_id="test-org"
        ),
        Agent(
            name="Carol",
            role="Project Manager",
            goal="Manage projects efficiently",
            organization_id="test-org"
        ),
    ]


@pytest.fixture
def delegate_tool(sample_agents):
    """创建 DelegateWorkTool 实例"""
    return DelegateWorkTool(agents=sample_agents)


@pytest.fixture
def ask_tool(sample_agents):
    """创建 AskQuestionTool 实例"""
    return AskQuestionTool(agents=sample_agents)


# ============================================================================
# Test: sanitize_agent_name
# ============================================================================


class TestSanitizeAgentName:
    """测试 Agent 名称标准化"""
    
    def test_basic_lowercase(self):
        """测试基本转换为小写"""
        assert sanitize_agent_name("Data Analyst") == "data analyst"
    
    def test_remove_special_chars(self):
        """测试移除特殊字符"""
        assert sanitize_agent_name("Data-Analyst_123") == "dataanalyst123"
    
    def test_unicode_normalization(self):
        """测试 Unicode 标准化"""
        assert sanitize_agent_name("José García") == "jose garcia"
    
    def test_multiple_spaces(self):
        """测试多个空格压缩"""
        assert sanitize_agent_name("Data   Analyst") == "data analyst"
    
    def test_empty_string(self):
        """测试空字符串"""
        assert sanitize_agent_name("") == ""


# ============================================================================
# Test: find_agent_by_role
# ============================================================================


class TestFindAgentByRole:
    """测试 Agent 角色查找"""
    
    def test_exact_match_role(self, sample_agents):
        """测试精确匹配角色"""
        agent = find_agent_by_role(sample_agents, "Data Analyst")
        assert agent is not None
        assert agent.name == "Alice"
    
    def test_exact_match_name(self, sample_agents):
        """测试精确匹配名称"""
        agent = find_agent_by_role(sample_agents, "Bob")
        assert agent is not None
        assert agent.role == "Software Engineer"
    
    def test_case_insensitive(self, sample_agents):
        """测试大小写不敏感"""
        agent = find_agent_by_role(sample_agents, "data analyst")
        assert agent is not None
        assert agent.name == "Alice"
    
    def test_partial_match(self, sample_agents):
        """测试部分匹配"""
        agent = find_agent_by_role(sample_agents, "Engineer")
        assert agent is not None
        assert agent.name == "Bob"
    
    def test_word_match(self, sample_agents):
        """测试词级别匹配"""
        agent = find_agent_by_role(sample_agents, "Project")
        assert agent is not None
        assert agent.name == "Carol"
    
    def test_no_match(self, sample_agents):
        """测试无匹配"""
        agent = find_agent_by_role(sample_agents, "Unknown Role")
        assert agent is None
    
    def test_empty_agents(self):
        """测试空 Agent 列表"""
        agent = find_agent_by_role([], "Data Analyst")
        assert agent is None
    
    def test_strict_mode(self, sample_agents):
        """测试严格匹配模式"""
        # 精确匹配应成功
        agent = find_agent_by_role(sample_agents, "Data Analyst", strict=True)
        assert agent is not None
        
        # 部分匹配应失败
        agent = find_agent_by_role(sample_agents, "Analyst", strict=True)
        assert agent is None


# ============================================================================
# Test: DelegateWorkTool
# ============================================================================


class TestDelegateWorkTool:
    """测试 DelegateWorkTool"""
    
    def test_initialization(self, sample_agents):
        """测试工具初始化"""
        tool = DelegateWorkTool(agents=sample_agents)
        
        assert tool.name == "delegate_work"
        assert len(tool.agents) == 3
        assert tool.args_schema is not None
    
    def test_successful_delegation(self, delegate_tool):
        """测试成功委派"""
        result = delegate_tool.run(
            task="分析销售数据",
            context="需要 Q3 季度报告",
            coworker="Data Analyst"
        )
        
        assert result is not None
        assert delegate_tool.last_delegation_context is not None
        assert delegate_tool.last_delegation_context.success is True
        assert delegate_tool.last_delegation_context.delegate_agent_name == "Alice"
    
    def test_delegation_with_fuzzy_match(self, delegate_tool):
        """测试模糊匹配委派"""
        result = delegate_tool.run(
            task="编写代码",
            context="实现登录功能",
            coworker="engineer"  # 小写，部分匹配
        )
        
        assert result is not None
        assert delegate_tool.last_delegation_context.delegate_agent_name == "Bob"
    
    def test_delegation_agent_not_found(self, delegate_tool):
        """测试找不到 Agent"""
        with pytest.raises(ToolError) as exc_info:
            delegate_tool.run(
                task="测试任务",
                context="测试上下文",
                coworker="Unknown Role"
            )
        
        assert "无法找到角色" in str(exc_info.value)
        assert delegate_tool.last_delegation_context.success is False
    
    def test_delegation_with_custom_executor(self, sample_agents):
        """测试自定义执行器"""
        executed_tasks = []
        
        def custom_executor(agent, task, context):
            executed_tasks.append({
                "agent": agent.name,
                "task": task,
                "context": context
            })
            return f"Custom result from {agent.name}"
        
        tool = DelegateWorkTool(
            agents=sample_agents,
            execute_task_func=custom_executor
        )
        
        result = tool.run(
            task="自定义任务",
            context="自定义上下文",
            coworker="Data Analyst"
        )
        
        assert "Custom result from Alice" in result
        assert len(executed_tasks) == 1
        assert executed_tasks[0]["agent"] == "Alice"
    
    def test_delegation_context_tracking(self, delegate_tool):
        """测试委派上下文追踪"""
        delegate_tool.run(
            task="测试任务",
            context="测试上下文",
            coworker="Data Analyst"
        )
        
        ctx = delegate_tool.last_delegation_context
        assert ctx is not None
        assert ctx.task == "测试任务"
        assert ctx.context == "测试上下文"
        assert ctx.delegate_agent_name == "Alice"
        assert ctx.execution_time >= 0
    
    def test_agents_property(self, delegate_tool, sample_agents):
        """测试 agents 属性"""
        assert len(delegate_tool.agents) == 3
        
        # 测试设置新的 agents
        new_agents = [sample_agents[0]]
        delegate_tool.agents = new_agents
        assert len(delegate_tool.agents) == 1
    
    def test_to_openai_schema(self, delegate_tool):
        """测试 OpenAI schema 转换"""
        schema = delegate_tool.to_openai_schema()
        
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "delegate_work"
        assert "parameters" in schema["function"]
        
        params = schema["function"]["parameters"]
        assert "task" in params["properties"]
        assert "context" in params["properties"]
        assert "coworker" in params["properties"]


# ============================================================================
# Test: AskQuestionTool
# ============================================================================


class TestAskQuestionTool:
    """测试 AskQuestionTool"""
    
    def test_initialization(self, sample_agents):
        """测试工具初始化"""
        tool = AskQuestionTool(agents=sample_agents)
        
        assert tool.name == "ask_question"
        assert len(tool.agents) == 3
        assert tool.args_schema is not None
    
    def test_successful_ask(self, ask_tool):
        """测试成功提问"""
        result = ask_tool.run(
            question="项目预算是多少？",
            context="我在准备采购计划",
            coworker="Project Manager"
        )
        
        assert result is not None
        assert ask_tool.last_delegation_context is not None
        assert ask_tool.last_delegation_context.success is True
        assert ask_tool.last_delegation_context.delegate_agent_name == "Carol"
    
    def test_ask_with_fuzzy_match(self, ask_tool):
        """测试模糊匹配提问"""
        result = ask_tool.run(
            question="数据在哪里？",
            context="需要找数据源",
            coworker="analyst"
        )
        
        assert result is not None
        assert ask_tool.last_delegation_context.delegate_agent_name == "Alice"
    
    def test_ask_agent_not_found(self, ask_tool):
        """测试找不到 Agent"""
        with pytest.raises(ToolError) as exc_info:
            ask_tool.run(
                question="测试问题",
                context="测试上下文",
                coworker="Unknown Role"
            )
        
        assert "无法找到角色" in str(exc_info.value)
    
    def test_ask_with_custom_func(self, sample_agents):
        """测试自定义提问函数"""
        asked_questions = []
        
        def custom_ask(agent, question, context):
            asked_questions.append({
                "agent": agent.name,
                "question": question,
                "context": context
            })
            return f"Answer from {agent.name}: Yes, I can help."
        
        tool = AskQuestionTool(
            agents=sample_agents,
            ask_func=custom_ask
        )
        
        result = tool.run(
            question="你能帮我吗？",
            context="我需要帮助",
            coworker="Data Analyst"
        )
        
        assert "Answer from Alice" in result
        assert len(asked_questions) == 1
    
    def test_to_openai_schema(self, ask_tool):
        """测试 OpenAI schema 转换"""
        schema = ask_tool.to_openai_schema()
        
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "ask_question"
        
        params = schema["function"]["parameters"]
        assert "question" in params["properties"]
        assert "context" in params["properties"]
        assert "coworker" in params["properties"]


# ============================================================================
# Test: DelegationContext
# ============================================================================


class TestDelegationContext:
    """测试 DelegationContext"""
    
    def test_default_values(self):
        """测试默认值"""
        ctx = DelegationContext()
        
        assert ctx.delegating_agent_id is None
        assert ctx.task == ""
        assert ctx.success is False
        assert ctx.metadata == {}
    
    def test_full_initialization(self):
        """测试完整初始化"""
        ctx = DelegationContext(
            delegating_agent_id="agent-1",
            delegating_agent_name="Alice",
            delegate_agent_id="agent-2",
            delegate_agent_name="Bob",
            task="Test task",
            context="Test context",
            result="Success",
            success=True,
            execution_time=1.5,
            metadata={"key": "value"}
        )
        
        assert ctx.delegating_agent_id == "agent-1"
        assert ctx.delegate_agent_name == "Bob"
        assert ctx.success is True
        assert ctx.execution_time == 1.5


# ============================================================================
# Test: create_delegation_tools Factory
# ============================================================================


class TestCreateDelegationTools:
    """测试工具工厂函数"""
    
    def test_create_tools(self, sample_agents):
        """测试创建工具集"""
        tools = create_delegation_tools(agents=sample_agents)
        
        assert "delegate_work" in tools
        assert "ask_question" in tools
        assert isinstance(tools["delegate_work"], DelegateWorkTool)
        assert isinstance(tools["ask_question"], AskQuestionTool)
    
    def test_create_tools_with_custom_funcs(self, sample_agents):
        """测试带自定义函数创建工具集"""
        def custom_exec(agent, task, context):
            return "executed"
        
        def custom_ask(agent, question, context):
            return "answered"
        
        tools = create_delegation_tools(
            agents=sample_agents,
            execute_task_func=custom_exec,
            ask_func=custom_ask
        )
        
        # 验证自定义函数被使用
        result = tools["delegate_work"].run(
            task="test",
            context="ctx",
            coworker="Data Analyst"
        )
        assert result == "executed"


# ============================================================================
# Test: Edge Cases
# ============================================================================


class TestEdgeCases:
    """测试边界情况"""
    
    def test_empty_agents_list(self):
        """测试空 Agent 列表"""
        tool = DelegateWorkTool(agents=[])
        
        with pytest.raises(ToolError):
            tool.run(
                task="test",
                context="ctx",
                coworker="Anyone"
            )
    
    def test_none_agents(self):
        """测试 None agents"""
        tool = DelegateWorkTool(agents=None)
        assert tool.agents == []
    
    def test_multiple_delegations(self, delegate_tool):
        """测试多次委派"""
        # 第一次委派
        delegate_tool.run(
            task="任务1",
            context="上下文1",
            coworker="Data Analyst"
        )
        ctx1 = delegate_tool.last_delegation_context
        
        # 第二次委派
        delegate_tool.run(
            task="任务2",
            context="上下文2",
            coworker="Software Engineer"
        )
        ctx2 = delegate_tool.last_delegation_context
        
        # 验证上下文被更新
        assert ctx2.task == "任务2"
        assert ctx2.delegate_agent_name == "Bob"

