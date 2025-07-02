#!/usr/bin/env python3
"""
AgenticX Core Module Test Runner

快速运行 agenticx.core 模块的所有测试。
"""

import sys
import os
import traceback

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def run_basic_tests():
    """运行基础功能测试"""
    print("=== AgenticX Core Module Test Runner ===\n")
    
    try:
        # 测试导入
        print("1. 测试模块导入...")
        from agenticx.core import (
            Agent, Task, BaseTool, FunctionTool, tool,
            Workflow, WorkflowNode, WorkflowEdge, 
            Message, ProtocolMessage, User, Organization
        )
        print("   ✅ 所有核心类导入成功\n")
        
        # 测试Agent创建
        print("2. 测试 Agent 类...")
        agent = Agent(
            name="test_agent",
            role="tester", 
            goal="run tests",
            organization_id="test_org"
        )
        assert len(agent.id) > 0
        assert agent.version == "1.0.0"
        print("   ✅ Agent 类创建和属性测试通过\n")
        
        # 测试Task创建
        print("3. 测试 Task 类...")
        task = Task(
            description="Test task",
            agent_id=agent.id,
            expected_output="Success"
        )
        assert len(task.id) > 0
        assert task.agent_id == agent.id
        print("   ✅ Task 类创建和关联测试通过\n")
        
        # 测试Tool装饰器
        print("4. 测试 Tool 系统...")
        @tool(name="test_tool")
        def sample_tool(x: int) -> int:
            """Sample tool for testing"""
            return x * 2
        
        assert isinstance(sample_tool, FunctionTool)
        assert sample_tool.name == "test_tool"
        result = sample_tool.execute(x=5)
        assert result == 10
        print("   ✅ Tool 装饰器和执行测试通过\n")
        
        # 测试Workflow创建
        print("5. 测试 Workflow 系统...")
        node = WorkflowNode(id="n1", type="agent", name="test_node")
        edge = WorkflowEdge(source="n1", target="n2")
        workflow = Workflow(
            name="test_workflow",
            organization_id="test_org", 
            nodes=[node],
            edges=[edge]
        )
        assert len(workflow.id) > 0
        assert len(workflow.nodes) == 1
        print("   ✅ Workflow 系统测试通过\n")
        
        # 测试Message创建
        print("6. 测试 Message 系统...")
        message = Message(
            sender_id="agent1",
            recipient_id="agent2",
            content="Test message"
        )
        assert len(message.id) > 0
        print("   ✅ Message 系统测试通过\n")
        
        # 测试平台类
        print("7. 测试平台类...")
        org = Organization(name="test_org")
        user = User(
            username="testuser",
            email="test@test.com", 
            organization_id=org.id
        )
        assert len(org.id) > 0
        assert len(user.id) > 0
        assert user.organization_id == org.id
        print("   ✅ 平台类测试通过\n")
        
        # 集成测试
        print("8. 集成测试...")
        full_agent = Agent(
            name="full_agent",
            role="comprehensive_tester",
            goal="test everything", 
            tool_names=["test_tool"],
            organization_id=org.id
        )
        
        full_task = Task(
            description="Full integration test",
            agent_id=full_agent.id,
            expected_output="All tests pass",
            dependencies=[task.id]
        )
        
        assert full_agent.organization_id == org.id
        assert full_task.agent_id == full_agent.id
        assert task.id in full_task.dependencies
        print("   ✅ 集成测试通过\n")
        
        print("🎉 所有测试都通过了！AgenticX Core 模块功能正常。")
        return True
        
    except Exception as e:
        print(f"❌ 测试失败: {str(e)}")
        print(f"详细错误信息:\n{traceback.format_exc()}")
        return False

def run_advanced_tests():
    """运行高级功能测试（异步等）"""
    print("\n=== 高级功能测试 ===")
    
    try:
        import asyncio
        from agenticx.core import tool
        
        # 测试异步工具
        @tool()
        async def async_tool(x: int) -> int:
            """Async tool test"""
            await asyncio.sleep(0.01)
            return x * 3
        
        async def test_async():
            result = await async_tool.aexecute(x=4)
            return result
        
        result = asyncio.run(test_async())
        assert result == 12
        print("   ✅ 异步工具测试通过")
        
        # 测试同步转异步
        @tool()
        def sync_tool(x: int) -> int:
            return x + 10
        
        async def test_sync_to_async():
            result = await sync_tool.aexecute(x=5)
            return result
        
        result = asyncio.run(test_sync_to_async())
        assert result == 15
        print("   ✅ 同步转异步测试通过")
        
        return True
        
    except Exception as e:
        print(f"❌ 高级测试失败: {str(e)}")
        return False

if __name__ == "__main__":
    success = run_basic_tests()
    
    if success:
        success_advanced = run_advanced_tests()
        if success_advanced:
            print("\n🎊 所有测试（包括高级功能）都通过了！")
        else:
            print("\n⚠️ 基础测试通过，但高级功能测试失败")
    
    sys.exit(0 if success else 1) 