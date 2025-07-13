"""
AgenticX M7 工作流编排引擎测试

测试 WorkflowEngine, WorkflowGraph, TriggerService 的功能
"""

import pytest
import asyncio
import sys
import os
from datetime import datetime
from unittest.mock import Mock, AsyncMock

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.core.workflow_engine import (
    WorkflowEngine, WorkflowGraph, TriggerService,
    ScheduledTrigger, EventDrivenTrigger,
    ExecutionContext, NodeExecution, WorkflowStatus, NodeStatus
)
from agenticx.core.workflow import Workflow, WorkflowNode, WorkflowEdge
from agenticx.core.task import Task
from agenticx.core.agent import Agent
from agenticx.core.event import EventLog  # 导入正确的 EventLog
from agenticx.core.agent_executor import AgentExecutor  # 导入 AgentExecutor
from agenticx.tools.base import BaseTool


class MockTool(BaseTool):
    """测试用的Mock工具"""
    
    def __init__(self, name: str, result: str = "success"):
        self.name = name
        self.description = f"Mock tool: {name}"
        self.result = result
    
    def _run(self, *args, **kwargs):
        """实现抽象方法"""
        return self.result
    
    def run(self, **kwargs):
        return f"{self.result}:{kwargs}"
    
    async def arun(self, **kwargs):
        return f"{self.result}:{kwargs}"


class MockAgentExecutor(AgentExecutor):
    """测试用的Mock Agent执行器"""
    
    def __init__(self, result: str = "agent_success"):
        self.result = result
        # 创建一个 Mock LLM Provider
        from unittest.mock import Mock
        mock_llm = Mock()
        mock_llm.model = "mock_model"
        
        # 初始化父类需要的属性
        super().__init__(
            llm_provider=mock_llm,
            tools=[],
            max_iterations=1  # 限制迭代次数
        )
    
    def run(self, agent, task):
        return {
            "success": True,
            "result": self.result,
            "agent": agent,
            "task": task.description if task else "no_task"
        }


class TestWorkflowGraph:
    """测试工作流图"""
    
    def setup_method(self):
        """设置测试"""
        self.graph = WorkflowGraph()
    
    def test_add_node(self):
        """测试添加节点"""
        tool = MockTool("test_tool")
        
        result = self.graph.add_node("node1", tool, "task", {"param": "value"})
        
        # 应该返回self支持链式调用
        assert result == self.graph
        
        # 检查节点是否添加成功
        assert "node1" in self.graph.nodes
        assert self.graph.nodes["node1"].name == "node1"
        assert self.graph.nodes["node1"].type == "task"
        assert self.graph.nodes["node1"].config == {"param": "value"}
        
        # 检查组件是否添加
        assert "node1" in self.graph.components
        assert self.graph.components["node1"] == tool
    
    def test_add_edge(self):
        """测试添加边"""
        # 先添加节点
        self.graph.add_node("node1", MockTool("tool1"))
        self.graph.add_node("node2", MockTool("tool2"))
        
        # 添加边
        condition = lambda result: result == "success"
        result = self.graph.add_edge("node1", "node2", condition, {"type": "success"})
        
        # 应该返回self支持链式调用
        assert result == self.graph
        
        # 检查边是否添加成功
        assert len(self.graph.edges) == 1
        edge = self.graph.edges[0]
        assert edge.source == "node1"
        assert edge.target == "node2"
        assert edge.condition == '{"type": "success"}'  # 现在存储为JSON字符串
        
        # 检查条件函数是否保存
        assert hasattr(self.graph, '_edge_conditions')
        assert "node1->node2" in self.graph._edge_conditions
    
    def test_get_next_nodes_no_condition(self):
        """测试获取下一个节点（无条件）"""
        self.graph.add_node("node1", MockTool("tool1"))
        self.graph.add_node("node2", MockTool("tool2"))
        self.graph.add_node("node3", MockTool("tool3"))
        
        # 添加无条件边
        self.graph.add_edge("node1", "node2")
        self.graph.add_edge("node1", "node3")
        
        next_nodes = self.graph.get_next_nodes("node1")
        
        assert set(next_nodes) == {"node2", "node3"}
    
    def test_get_next_nodes_with_condition(self):
        """测试获取下一个节点（有条件）"""
        self.graph.add_node("node1", MockTool("tool1"))
        self.graph.add_node("node2", MockTool("tool2"))
        self.graph.add_node("node3", MockTool("tool3"))
        
        # 添加条件边
        self.graph.add_edge("node1", "node2", lambda result: "success" in result)
        self.graph.add_edge("node1", "node3", lambda result: "error" in result)
        
        # 测试成功结果
        next_nodes = self.graph.get_next_nodes("node1", "success:data")
        assert next_nodes == ["node2"]
        
        # 测试错误结果
        next_nodes = self.graph.get_next_nodes("node1", "error:data")
        assert next_nodes == ["node3"]
        
        # 测试不匹配结果
        next_nodes = self.graph.get_next_nodes("node1", "unknown:data")
        assert next_nodes == []
    
    def test_get_next_nodes_with_config_condition(self):
        """测试基于配置的条件检查"""
        self.graph.add_node("node1", MockTool("tool1"))
        self.graph.add_node("node2", MockTool("tool2"))
        
        # 添加配置条件边
        self.graph.add_edge("node1", "node2", condition_config={
            "type": "result_equals",
            "value": "success"
        })
        
        # 测试匹配条件
        next_nodes = self.graph.get_next_nodes("node1", "success")
        assert next_nodes == ["node2"]
        
        # 测试不匹配条件
        next_nodes = self.graph.get_next_nodes("node1", "failure")
        assert next_nodes == []
    
    def test_get_entry_nodes(self):
        """测试获取入口节点"""
        self.graph.add_node("node1", MockTool("tool1"))
        self.graph.add_node("node2", MockTool("tool2"))
        self.graph.add_node("node3", MockTool("tool3"))
        
        # node1 -> node2 -> node3
        self.graph.add_edge("node1", "node2")
        self.graph.add_edge("node2", "node3")
        
        entry_nodes = self.graph.get_entry_nodes()
        assert entry_nodes == ["node1"]
    
    def test_validate_success(self):
        """测试验证成功"""
        self.graph.add_node("node1", MockTool("tool1"))
        self.graph.add_node("node2", MockTool("tool2"))
        self.graph.add_edge("node1", "node2")
        
        errors = self.graph.validate()
        assert errors == []
    
    def test_validate_missing_component(self):
        """测试验证失败：缺少组件"""
        # 只添加节点，不添加组件
        self.graph.nodes["node1"] = WorkflowNode(id="node1", name="node1", type="task")
        
        errors = self.graph.validate()
        assert len(errors) == 1
        assert "没有对应的执行组件" in errors[0]
    
    def test_validate_invalid_edge(self):
        """测试验证失败：无效边"""
        self.graph.add_node("node1", MockTool("tool1"))
        
        # 添加指向不存在节点的边
        edge = WorkflowEdge(id="invalid", source="node1", target="nonexistent")
        self.graph.edges.append(edge)
        
        errors = self.graph.validate()
        assert len(errors) == 1
        assert "目标节点 nonexistent 不存在" in errors[0]
    
    def test_validate_no_entry_nodes(self):
        """测试验证失败：无入口节点"""
        self.graph.add_node("node1", MockTool("tool1"))
        self.graph.add_node("node2", MockTool("tool2"))
        
        # 创建环路：node1 -> node2 -> node1
        self.graph.add_edge("node1", "node2")
        self.graph.add_edge("node2", "node1")
        
        errors = self.graph.validate()
        assert any("没有入口节点" in error for error in errors)
    
    def test_has_cycles(self):
        """测试环路检测"""
        self.graph.add_node("node1", MockTool("tool1"))
        self.graph.add_node("node2", MockTool("tool2"))
        self.graph.add_node("node3", MockTool("tool3"))
        
        # 创建环路：node1 -> node2 -> node3 -> node1
        self.graph.add_edge("node1", "node2")
        self.graph.add_edge("node2", "node3")
        self.graph.add_edge("node3", "node1")
        
        errors = self.graph.validate()
        assert any("包含环路" in error for error in errors)
    
    def test_load_from_workflow(self):
        """测试从工作流定义加载"""
        # 创建工作流定义
        nodes = [
            WorkflowNode(id="node1", name="Node 1", type="task"),
            WorkflowNode(id="node2", name="Node 2", type="task")
        ]
        edges = [
            WorkflowEdge(id="edge1", source="node1", target="node2")
        ]
        workflow = Workflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0",
            organization_id="test_org",  # 添加必需字段
            nodes=nodes,
            edges=edges
        )
        
        graph = WorkflowGraph(workflow)
        
        assert len(graph.nodes) == 2
        assert "node1" in graph.nodes
        assert "node2" in graph.nodes
        assert len(graph.edges) == 1
        assert graph.edges[0].source == "node1"
        assert graph.edges[0].target == "node2"


class TestTriggerService:
    """测试触发器服务"""
    
    def setup_method(self):
        """设置测试"""
        self.service = TriggerService()
    
    def test_register_trigger(self):
        """测试注册触发器"""
        trigger = ScheduledTrigger("test_workflow", "every_5s")
        
        self.service.register_trigger("trigger1", trigger)
        
        assert "trigger1" in self.service.triggers
        assert self.service.triggers["trigger1"] == trigger
        assert trigger.service == self.service
    
    def test_start_stop_service(self):
        """测试启动和停止服务"""
        trigger = Mock()
        self.service.register_trigger("trigger1", trigger)
        
        # 启动服务
        self.service.start()
        assert self.service.running is True
        trigger.start.assert_called_once()
        
        # 停止服务
        self.service.stop()
        assert self.service.running is False
        trigger.stop.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_trigger_workflow(self):
        """测试触发工作流"""
        # 这个测试主要验证方法调用，实际集成需要WorkflowEngine
        await self.service.trigger_workflow("test_workflow", {"key": "value"})
        # 应该不抛出异常


class TestScheduledTrigger:
    """测试定时触发器"""
    
    def test_parse_schedule(self):
        """测试解析调度表达式"""
        trigger = ScheduledTrigger("test_workflow", "every_5s")
        
        # 测试各种调度表达式
        assert trigger._parse_schedule("every_5s") == 5.0
        assert trigger._parse_schedule("every_10m") == 600.0
        assert trigger._parse_schedule("every_2h") == 7200.0
        assert trigger._parse_schedule("daily") == 86400.0
        assert trigger._parse_schedule("hourly") == 3600.0
        assert trigger._parse_schedule("unknown") == 300.0  # 默认5分钟
    
    @pytest.mark.asyncio
    async def test_scheduled_trigger_execution(self):
        """测试定时触发器执行"""
        service = TriggerService()
        service.trigger_workflow = AsyncMock()
        
        trigger = ScheduledTrigger("test_workflow", "every_1s", {"initial": "data"})
        trigger.set_service(service)
        
        # 启动触发器
        trigger.start()
        
        # 等待一段时间让触发器执行
        await asyncio.sleep(1.5)
        
        # 停止触发器
        trigger.stop()
        
        # 验证触发器是否被调用
        service.trigger_workflow.assert_called()
        call_args = service.trigger_workflow.call_args
        assert call_args[0][0] == "test_workflow"
        assert call_args[0][1] == {"initial": "data"}


class TestEventDrivenTrigger:
    """测试事件驱动触发器"""
    
    def test_start_stop_listening(self):
        """测试开始和停止监听"""
        trigger = EventDrivenTrigger("test_workflow", "test_topic")
        
        # 开始监听
        trigger.start()
        assert trigger.listening is True
        
        # 停止监听
        trigger.stop()
        assert trigger.listening is False
    
    @pytest.mark.asyncio
    async def test_handle_event(self):
        """测试处理事件"""
        service = TriggerService()
        service.trigger_workflow = AsyncMock()
        
        trigger = EventDrivenTrigger("test_workflow", "test_topic")
        trigger.set_service(service)
        trigger.start()
        
        # 处理事件
        event_data = {"event": "test", "data": "value"}
        trigger.handle_event(event_data)
        
        # 等待一小段时间让异步任务完成
        await asyncio.sleep(0.1)
        
        # 由于是异步调用，这里主要验证不抛出异常
        assert trigger.listening is True


class TestWorkflowEngine:
    """测试工作流引擎"""
    
    def setup_method(self):
        """设置测试"""
        self.engine = WorkflowEngine()
    
    @pytest.mark.asyncio
    async def test_run_simple_workflow(self):
        """测试运行简单工作流"""
        # 创建简单的工作流图
        graph = WorkflowGraph()
        graph.add_node("task1", MockTool("tool1", "result1"))
        graph.add_node("task2", MockTool("tool2", "result2"))
        graph.add_edge("task1", "task2")
        
        # 执行工作流
        context = await self.engine.run(graph, {"input": "test"})
        
        assert context.status == WorkflowStatus.COMPLETED
        assert "task1" in context.node_results
        assert "task2" in context.node_results
        assert context.variables == {"input": "test"}
    
    @pytest.mark.asyncio
    async def test_run_parallel_workflow(self):
        """测试运行并行工作流"""
        # 创建并行工作流图
        graph = WorkflowGraph()
        graph.add_node("task1", MockTool("tool1", "result1"))
        graph.add_node("task2", MockTool("tool2", "result2"))
        graph.add_node("task3", MockTool("tool3", "result3"))
        
        # task1 并行启动 task2 和 task3
        graph.add_edge("task1", "task2")
        graph.add_edge("task1", "task3")
        
        # 执行工作流
        context = await self.engine.run(graph)
        
        assert context.status == WorkflowStatus.COMPLETED
        assert len(context.node_results) == 3
    
    @pytest.mark.asyncio
    async def test_run_conditional_workflow(self):
        """测试运行条件工作流"""
        # 创建条件工作流图
        graph = WorkflowGraph()
        graph.add_node("decision", MockTool("decision", "success"))
        graph.add_node("success_task", MockTool("success_tool"))
        graph.add_node("failure_task", MockTool("failure_tool"))
        
        # 根据结果选择不同路径
        graph.add_edge("decision", "success_task", lambda result: "success" in result)
        graph.add_edge("decision", "failure_task", lambda result: "failure" in result)
        
        # 执行工作流
        context = await self.engine.run(graph)
        
        assert context.status == WorkflowStatus.COMPLETED
        assert "decision" in context.node_results
        assert "success_task" in context.node_results
        assert "failure_task" not in context.node_results
    
    @pytest.mark.asyncio
    async def test_run_workflow_with_agent(self):
        """测试运行包含Agent的工作流"""
        # 创建包含Agent的工作流图
        graph = WorkflowGraph()
        agent_executor = MockAgentExecutor("agent_result")
        
        graph.add_node("agent_task", agent_executor, "agent", {
            "task": {
                "description": "执行Agent任务",
                "expected_output": "Agent执行结果"
            }
        })
        
        # 执行工作流
        context = await self.engine.run(graph)
        
        assert context.status == WorkflowStatus.COMPLETED
        assert "agent_task" in context.node_results
        result = context.node_results["agent_task"]
        assert result["success"] is True
        assert result["result"] == "agent_result"
    
    @pytest.mark.asyncio
    async def test_run_workflow_with_function(self):
        """测试运行包含自定义函数的工作流"""
        def custom_function(param1, param2="default"):
            return f"function_result:{param1}:{param2}"
        
        # 创建包含自定义函数的工作流图
        graph = WorkflowGraph()
        graph.add_node("function_task", custom_function, "function", {
            "args": {
                "param1": "${input_value}",
                "param2": "custom"
            }
        })
        
        # 执行工作流
        context = await self.engine.run(graph, {"input_value": "test"})
        
        assert context.status == WorkflowStatus.COMPLETED
        assert "function_task" in context.node_results
        assert context.node_results["function_task"] == "function_result:test:custom"
    
    @pytest.mark.asyncio
    async def test_run_workflow_validation_error(self):
        """测试工作流验证错误"""
        # 创建无效的工作流图（无入口节点）
        graph = WorkflowGraph()
        graph.add_node("task1", MockTool("tool1"))
        graph.add_node("task2", MockTool("tool2"))
        graph.add_edge("task1", "task2")
        graph.add_edge("task2", "task1")  # 创建环路
        
        # 执行应该失败
        context = await self.engine.run(graph)
        
        assert context.status == WorkflowStatus.FAILED
        assert len(context.event_log.events) > 0
    
    @pytest.mark.asyncio
    async def test_run_workflow_execution_error(self):
        """测试工作流执行错误"""
        def failing_function():
            raise ValueError("Function execution failed")
        
        # 创建会失败的工作流图
        graph = WorkflowGraph()
        graph.add_node("failing_task", failing_function)
        
        # 执行应该失败
        context = await self.engine.run(graph)
        
        assert context.status == WorkflowStatus.FAILED
        assert len(context.event_log.events) > 0
    
    @pytest.mark.asyncio
    async def test_pause_resume_cancel_execution(self):
        """测试暂停、恢复和取消执行"""
        # 创建简单工作流
        graph = WorkflowGraph()
        graph.add_node("task1", MockTool("tool1"))
        
        # 开始执行（在后台）
        execution_task = asyncio.create_task(self.engine.run(graph))
        
        # 等待一小段时间让执行开始
        await asyncio.sleep(0.1)
        
        # 获取执行ID（这里需要模拟）
        execution_id = list(self.engine.active_executions.keys())[0] if self.engine.active_executions else None
        
        if execution_id:
            # 测试暂停
            result = await self.engine.pause_execution(execution_id)
            assert result is True
            
            # 测试恢复
            result = await self.engine.resume_execution(execution_id)
            assert result is True
            
            # 测试取消
            result = await self.engine.cancel_execution(execution_id)
            assert result is True
        
        # 等待执行完成
        await execution_task
    
    def test_get_execution_status(self):
        """测试获取执行状态"""
        # 创建执行上下文
        context = self.engine._create_execution_context(
            WorkflowGraph(), 
            {"test": "data"}
        )
        
        execution_id = context.execution_id
        self.engine.active_executions[execution_id] = context
        
        # 获取状态
        retrieved_context = self.engine.get_execution_status(execution_id)
        assert retrieved_context == context
        
        # 获取不存在的执行
        non_existent = self.engine.get_execution_status("non_existent")
        assert non_existent is None
    
    def test_create_execution_context(self):
        """测试创建执行上下文"""
        graph = WorkflowGraph()
        initial_data = {"key": "value"}
        
        context = self.engine._create_execution_context(graph, initial_data)
        
        assert context.workflow_id == "dynamic_workflow"
        assert context.execution_id is not None
        assert context.variables == initial_data
        assert context.status == WorkflowStatus.PENDING
        assert isinstance(context.start_time, datetime)
    
    def test_resolve_variables(self):
        """测试变量解析"""
        variables = {
            "name": "test",
            "value": 123,
            "nested": {"key": "nested_value"}
        }
        
        # 测试字符串变量替换
        result = self.engine._resolve_variables("Hello ${name}!", variables)
        assert result == "Hello test!"
        
        # 测试字典变量替换
        obj = {
            "message": "Value is ${value}",
            "data": "${nested}"
        }
        result = self.engine._resolve_variables(obj, variables)
        assert result["message"] == "Value is 123"
        assert result["data"] == "{'key': 'nested_value'}"
        
        # 测试列表变量替换
        list_obj = ["${name}", "${value}", "static"]
        result = self.engine._resolve_variables(list_obj, variables)
        assert result == ["test", "123", "static"]


class TestIntegration:
    """集成测试"""
    
    @pytest.mark.asyncio
    async def test_complete_workflow_execution(self):
        """测试完整的工作流执行"""
        # 创建复杂的工作流
        graph = WorkflowGraph()
        
        # 添加节点
        graph.add_node("start", MockTool("start_tool", "started"))
        graph.add_node("process1", MockTool("process1_tool", "processed1"))
        graph.add_node("process2", MockTool("process2_tool", "processed2"))
        graph.add_node("merge", MockTool("merge_tool", "merged"))
        graph.add_node("end", MockTool("end_tool", "completed"))
        
        # 添加边
        graph.add_edge("start", "process1")
        graph.add_edge("start", "process2")
        graph.add_edge("process1", "merge")
        graph.add_edge("process2", "merge")
        graph.add_edge("merge", "end")
        
        # 创建引擎并执行
        engine = WorkflowEngine()
        context = await engine.run(graph, {"input": "test_data"})
        
        # 验证执行结果
        assert context.status == WorkflowStatus.COMPLETED
        assert len(context.node_results) == 5
        assert all(node in context.node_results for node in 
                  ["start", "process1", "process2", "merge", "end"])
        
        # 验证事件日志
        assert len(context.event_log.events) >= 2  # 至少有开始和结束事件
    
    @pytest.mark.asyncio
    async def test_workflow_with_triggers(self):
        """测试带触发器的工作流"""
        # 创建触发器服务
        trigger_service = TriggerService()
        
        # 创建定时触发器
        scheduled_trigger = ScheduledTrigger(
            "test_workflow", 
            "every_1s", 
            {"trigger_data": "scheduled"}
        )
        
        # 创建事件触发器
        event_trigger = EventDrivenTrigger("test_workflow", "test_topic")
        
        # 注册触发器
        trigger_service.register_trigger("scheduled", scheduled_trigger)
        trigger_service.register_trigger("event", event_trigger)
        
        # 启动服务
        trigger_service.start()
        
        # 等待一段时间
        await asyncio.sleep(0.1)
        
        # 停止服务
        trigger_service.stop()
        
        # 验证触发器状态
        assert scheduled_trigger.service == trigger_service
        assert event_trigger.service == trigger_service


if __name__ == "__main__":
    pytest.main([__file__, "-v"])