"""
AgenticX Core Module Tests

测试 agenticx.core 模块中所有核心类的功能和属性。
"""

import pytest
import asyncio
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core import (
    Agent, Task, BaseTool, FunctionTool, tool, 
    Workflow, WorkflowNode, WorkflowEdge, 
    Message, ProtocolMessage, User, Organization
)


class TestAgent:
    """测试 Agent 类"""
    
    def test_agent_creation_with_defaults(self):
        """测试使用默认值创建 Agent"""
        agent = Agent(
            name="test_agent",
            role="tester",
            goal="test things",
            organization_id="test_org"
        )
        
        assert agent.name == "test_agent"
        assert agent.role == "tester"
        assert agent.goal == "test things"
        assert agent.organization_id == "test_org"
        assert agent.version == "1.0.0"  # 默认版本
        assert agent.backstory is None
        assert agent.llm_config_name is None
        assert len(agent.tool_names) == 0
        assert isinstance(agent.memory_config, dict)
        assert len(agent.id) > 0  # UUID 应该被生成

    def test_agent_creation_with_all_fields(self):
        """测试创建包含所有字段的 Agent"""
        agent = Agent(
            name="full_agent",
            version="2.0.0",
            role="full_tester", 
            goal="test everything",
            backstory="I am a comprehensive agent",
            llm_config_name="gpt-4",
            memory_config={"type": "long_term"},
            tool_names=["tool1", "tool2"],
            organization_id="test_org"
        )
        
        assert agent.version == "2.0.0"
        assert agent.backstory == "I am a comprehensive agent"
        assert agent.llm_config_name == "gpt-4"
        assert agent.memory_config["type"] == "long_term"
        assert "tool1" in agent.tool_names
        assert "tool2" in agent.tool_names


class TestTask:
    """测试 Task 类"""
    
    def test_task_creation_basic(self):
        """测试基本任务创建"""
        task = Task(
            description="Test task",
            expected_output="Test result"
        )
        
        assert task.description == "Test task"
        assert task.expected_output == "Test result"
        assert task.agent_id is None
        assert isinstance(task.context, dict)
        assert isinstance(task.dependencies, list)
        assert task.output_schema is None
        assert len(task.id) > 0

    def test_task_creation_full(self):
        """测试创建完整的任务"""
        task = Task(
            description="Complex task",
            agent_id="agent_123",
            expected_output="Complex result",
            context={"key": "value"},
            dependencies=["task_1", "task_2"],
            output_schema={"type": "object", "properties": {"result": {"type": "string"}}}
        )
        
        assert task.agent_id == "agent_123"
        assert task.context["key"] == "value"
        assert "task_1" in task.dependencies
        assert "task_2" in task.dependencies
        assert task.output_schema["type"] == "object"


class TestTool:
    """测试工具系统"""
    
    def test_tool_decorator_basic(self):
        """测试基本的 @tool 装饰器"""
        @tool()
        def simple_func(x: int) -> int:
            """A simple function"""
            return x * 2
        
        assert isinstance(simple_func, FunctionTool)
        assert simple_func.name == "simple_func"
        assert simple_func.description == "A simple function"
        assert simple_func.args_schema is not None
        
        # 测试执行
        result = simple_func.execute(x=5)
        assert result == 10

    def test_tool_decorator_with_params(self):
        """测试带参数的 @tool 装饰器"""
        @tool(name="custom_tool", description="Custom description")
        def custom_func(a: str, b: int = 10) -> str:
            """Original docstring"""
            return f"{a}_{b}"
        
        assert custom_func.name == "custom_tool"
        assert custom_func.description == "Custom description"
        
        result = custom_func.execute(a="test", b=5)
        assert result == "test_5"

    def test_tool_async_execution(self):
        """测试异步工具执行"""
        @tool()
        async def async_func(x: int) -> int:
            """An async function"""
            await asyncio.sleep(0.01)  # 模拟异步操作
            return x * 3
        
        # 测试异步执行
        async def run_test():
            result = await async_func.aexecute(x=4)
            assert result == 12
        
        asyncio.run(run_test())

    def test_tool_sync_to_async(self):
        """测试同步函数的异步执行"""
        @tool()
        def sync_func(x: int) -> int:
            """A sync function"""
            return x + 1
        
        async def run_test():
            result = await sync_func.aexecute(x=5)
            assert result == 6
        
        asyncio.run(run_test())


class TestWorkflow:
    """测试工作流系统"""
    
    def test_workflow_node_creation(self):
        """测试工作流节点创建"""
        node = WorkflowNode(
            id="node_1",
            type="agent",
            name="test_node",
            config={"param": "value"}
        )
        
        assert node.id == "node_1"
        assert node.type == "agent"
        assert node.name == "test_node"
        assert node.config["param"] == "value"

    def test_workflow_edge_creation(self):
        """测试工作流边创建"""
        edge = WorkflowEdge(
            source="node_1",
            target="node_2",
            condition="success",
            metadata={"weight": 1.0}
        )
        
        assert edge.source == "node_1"
        assert edge.target == "node_2"
        assert edge.condition == "success"
        assert edge.metadata["weight"] == 1.0

    def test_workflow_creation(self):
        """测试完整工作流创建"""
        node1 = WorkflowNode(id="n1", type="agent", name="agent1")
        node2 = WorkflowNode(id="n2", type="task", name="task1")
        edge = WorkflowEdge(source="n1", target="n2")
        
        workflow = Workflow(
            name="test_workflow",
            version="1.5.0",
            organization_id="test_org",
            nodes=[node1, node2],
            edges=[edge],
            metadata={"description": "Test workflow"}
        )
        
        assert workflow.name == "test_workflow"
        assert workflow.version == "1.5.0"
        assert workflow.organization_id == "test_org"
        assert len(workflow.nodes) == 2
        assert len(workflow.edges) == 1
        assert workflow.metadata["description"] == "Test workflow"
        assert len(workflow.id) > 0


class TestMessage:
    """测试消息系统"""
    
    def test_message_creation(self):
        """测试消息创建"""
        message = Message(
            sender_id="agent_1",
            recipient_id="agent_2",
            content="Hello world",
            metadata={"type": "greeting"}
        )
        
        assert message.sender_id == "agent_1"
        assert message.recipient_id == "agent_2"
        assert message.content == "Hello world"
        assert message.metadata["type"] == "greeting"
        assert len(message.id) > 0

    def test_protocol_message_creation(self):
        """测试协议消息创建"""
        base_message = Message(
            sender_id="agent_1",
            recipient_id="agent_2", 
            content="Test message"
        )
        
        protocol_msg = ProtocolMessage(
            protocol="a2a",
            message=base_message,
            header={"version": "1.0"}
        )
        
        assert protocol_msg.protocol == "a2a"
        assert protocol_msg.message.sender_id == "agent_1"
        assert protocol_msg.header["version"] == "1.0"


class TestPlatform:
    """测试平台相关类"""
    
    def test_organization_creation(self):
        """测试组织创建"""
        org = Organization(
            name="test_org",
            display_name="Test Organization",
            description="A test organization",
            settings={"max_agents": 100}
        )
        
        assert org.name == "test_org"
        assert org.display_name == "Test Organization"
        assert org.description == "A test organization"
        assert org.is_active is True
        assert org.settings["max_agents"] == 100
        assert len(org.id) > 0
        assert org.created_at is not None
        assert org.updated_at is None

    def test_user_creation(self):
        """测试用户创建"""
        user = User(
            username="testuser",
            email="test@example.com",
            full_name="Test User",
            organization_id="org_123",
            roles=["developer", "admin"]
        )
        
        assert user.username == "testuser"
        assert user.email == "test@example.com"
        assert user.full_name == "Test User"
        assert user.organization_id == "org_123"
        assert "developer" in user.roles
        assert "admin" in user.roles
        assert user.is_active is True
        assert len(user.id) > 0
        assert user.created_at is not None


class TestModuleImports:
    """测试模块导入"""
    
    def test_all_imports(self):
        """测试所有核心类都能正常导入"""
        from agenticx.core import (
            Agent, Task, BaseTool, FunctionTool, tool,
            Workflow, WorkflowNode, WorkflowEdge,
            Message, ProtocolMessage,
            User, Organization
        )
        
        # 验证所有类都存在且可用
        assert Agent is not None
        assert Task is not None
        assert BaseTool is not None
        assert FunctionTool is not None
        assert tool is not None
        assert Workflow is not None
        assert WorkflowNode is not None
        assert WorkflowEdge is not None
        assert Message is not None
        assert ProtocolMessage is not None
        assert User is not None
        assert Organization is not None


class TestIntegration:
    """集成测试"""
    
    def test_complete_workflow_setup(self):
        """测试完整的工作流设置"""
        # 创建组织和用户
        org = Organization(name="integration_test_org")
        user = User(
            username="test_user",
            email="test@test.com",
            organization_id=org.id
        )
        
        # 创建工具
        @tool(name="math_tool")
        def add(a: int, b: int) -> int:
            return a + b
        
        # 创建智能体
        agent = Agent(
            name="math_agent",
            role="calculator",
            goal="perform calculations",
            tool_names=["math_tool"], 
            organization_id=org.id
        )
        
        # 创建任务
        task = Task(
            description="Add 2 + 3",
            agent_id=agent.id,
            expected_output="5"
        )
        
        # 创建工作流
        agent_node = WorkflowNode(
            id="agent_node",
            type="agent",
            name="math_agent_node",
            config={"agent_id": agent.id}
        )
        
        task_node = WorkflowNode(
            id="task_node", 
            type="task",
            name="math_task_node",
            config={"task_id": task.id}
        )
        
        edge = WorkflowEdge(source="agent_node", target="task_node")
        
        workflow = Workflow(
            name="math_workflow",
            organization_id=org.id,
            nodes=[agent_node, task_node],
            edges=[edge]
        )
        
        # 创建消息
        message = Message(
            sender_id=agent.id,
            recipient_id="system",
            content="Task completed"
        )
        
        # 验证所有对象都正确创建并关联
        assert agent.organization_id == org.id
        assert user.organization_id == org.id
        assert workflow.organization_id == org.id
        assert task.agent_id == agent.id
        assert "math_tool" in agent.tool_names
        assert len(workflow.nodes) == 2
        assert len(workflow.edges) == 1
        assert message.sender_id == agent.id
        
        # 测试工具执行
        result = add.execute(a=2, b=3)
        assert result == 5


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 