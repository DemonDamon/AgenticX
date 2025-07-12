"""
AgenticX Human-in-the-Loop (HITL) 功能测试

测试 M3 和 M7 中的人机协同功能：
- @human_in_the_loop 装饰器
- ApprovalRequiredError 异常处理
- human_approval 工作流节点
"""

import pytest
import asyncio
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core import (
    WorkflowEngine, WorkflowGraph, WorkflowStatus, NodeStatus,
    AgentExecutor, tool, HumanRequestEvent, Agent, Task
)
from agenticx.tools.security import human_in_the_loop, ApprovalRequiredError
from agenticx.tools.executor import ToolExecutor
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse, TokenUsage
from tests.test_m5_agent_core import MockLLMProvider


class TestHumanInTheLoopDecorator:
    """测试 @human_in_the_loop 装饰器"""

    def test_decorator_requires_approval_by_default(self):
        """测试装饰器默认需要审批"""
        @human_in_the_loop()
        def high_risk_tool(amount: int):
            return f"Transferred {amount}"

        with pytest.raises(ApprovalRequiredError) as excinfo:
            high_risk_tool.execute(amount=1000)
        
        assert "执行此工具需要人工批准" in str(excinfo.value.message)
        assert excinfo.value.tool_name == "high_risk_tool"
        assert excinfo.value.kwargs == {"amount": 1000}

    def test_decorator_with_custom_prompt(self):
        """测试自定义提示信息"""
        @human_in_the_loop(prompt="请确认转账操作")
        def transfer_funds(account: str, amount: int):
            return "Success"

        with pytest.raises(ApprovalRequiredError) as excinfo:
            transfer_funds.execute(account="12345", amount=500)
        
        assert "请确认转账操作" in str(excinfo.value)

    def test_decorator_with_policy_check_requires_approval(self):
        """测试策略检查函数要求审批"""
        def check_if_large_amount(amount: int):
            return amount > 100

        @human_in_the_loop(policy_check=check_if_large_amount)
        def process_payment(amount: int):
            return "Payment processed"

        # 超过阈值，需要审批
        with pytest.raises(ApprovalRequiredError):
            process_payment.execute(amount=200)

    def test_decorator_with_policy_check_does_not_require_approval(self):
        """测试策略检查函数不要求审批"""
        def check_if_large_amount(amount: int):
            return amount > 100

        @human_in_the_loop(policy_check=check_if_large_amount)
        def process_payment(amount: int):
            return f"Payment of {amount} processed"

        # 未超过阈值，直接执行
        result = process_payment.execute(amount=50)
        assert result == "Payment of 50 processed"

    def test_decorator_with_failing_policy_check(self):
        """测试策略检查函数本身失败"""
        def failing_policy_check(*args, **kwargs):
            raise ValueError("策略检查失败")

        @human_in_the_loop(policy_check=failing_policy_check)
        def some_tool():
            return "Should not be executed"

        # 策略检查失败，应默认需要审批
        with pytest.raises(ApprovalRequiredError):
            some_tool.execute()


class TestToolExecutorHITL:
    """测试 ToolExecutor 对 HITL 的支持"""

    def setup_method(self):
        """设置测试"""
        self.executor = ToolExecutor()

    def test_executor_catches_approval_required(self):
        """测试执行器捕获 ApprovalRequiredError"""
        @human_in_the_loop()
        def critical_tool():
            pass

        with pytest.raises(ApprovalRequiredError) as excinfo:
            self.executor.execute(critical_tool)
        
        assert isinstance(excinfo.value, ApprovalRequiredError)


class TestWorkflowEngineHITL:
    """测试 WorkflowEngine 对 HITL 的支持"""

    def setup_method(self):
        """设置测试"""
        self.engine = WorkflowEngine()

    @pytest.mark.asyncio
    async def test_human_approval_node_pauses_workflow(self):
        """测试 human_approval 节点暂停工作流"""
        graph = WorkflowGraph()
        
        # 定义工作流：start -> human_approval -> end
        graph.add_node("start", lambda: "started", "function")
        graph.add_node(
            "approval_step", 
            component="human_approval_placeholder", # 添加占位符
            node_type="human_approval",
            config={
                "question": "是否继续执行？",
                "context": "这将执行一个关键操作"
            }
        )
        graph.add_node("end", lambda: "finished", "function")
        
        graph.add_edge("start", "approval_step")
        graph.add_edge("approval_step", "end")
        
        # 执行工作流
        context = await self.engine.run(graph)
        
        # 验证工作流状态
        assert context.status == WorkflowStatus.PAUSED
        
        # 验证事件日志
        last_event = context.event_log.get_last_event()
        assert isinstance(last_event, HumanRequestEvent)
        assert "是否继续执行？" in last_event.question
        assert "关键操作" in last_event.context
        
        # 验证节点执行状态
        node_executions = self.engine.node_executions[context.execution_id]
        assert "approval_step" in node_executions
        assert node_executions["approval_step"].status == NodeStatus.RUNNING
    
    @pytest.mark.asyncio
    async def test_agent_executor_with_hitl_tool(self):
        """测试 AgentExecutor 调用需要审批的工具"""
        
        @human_in_the_loop(prompt="请批准删除操作")
        def delete_database_tool(db_name: str):
            return f"数据库 {db_name} 已删除"
        
        # 模拟 LLM 响应，要求调用高风险工具
        mock_llm = MockLLMProvider([
            '{"action": "tool_call", "tool": "delete_database_tool", "args": {"db_name": "production"}}'
        ])
        
        # 创建 AgentExecutor
        agent_executor = AgentExecutor(
            llm_provider=mock_llm,
            tools=[delete_database_tool]
        )
        
        agent = Agent(
            name="test_agent", 
            role="tester", 
            goal="test hitl", 
            organization_id="test_org"
        )
        task = Task(
            description="删除数据库",
            expected_output="数据库删除成功"
        )

        # 执行
        result = agent_executor.run(agent, task)
        
        # 验证结果
        assert result["success"] is True # 执行器本身是成功的，只是暂停了
        
        event_log = result["event_log"]
        
        # 验证工作流因人工请求而暂停
        assert event_log.needs_human_input() is True
        
        last_event = event_log.get_last_event()
        assert isinstance(last_event, HumanRequestEvent)
        assert "请批准删除操作" in last_event.question
        assert "delete_database_tool" in last_event.context


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 