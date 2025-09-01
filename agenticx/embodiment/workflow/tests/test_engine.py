"""Tests for WorkflowEngine class."""

import pytest
import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
from pydantic import Field
from unittest.mock import Mock, AsyncMock, patch
from agenticx.embodiment.workflow.engine import WorkflowEngine, NodeExecution, WorkflowExecution
from agenticx.embodiment.workflow.workflow import GUIWorkflow
from agenticx.embodiment.core.context import GUIAgentContext
from agenticx.core.workflow import WorkflowNode, WorkflowEdge
from agenticx.core.tool import BaseTool


class MockTool:
    """Mock tool for testing."""
    
    def __init__(self, name: str, should_fail: bool = False):
        self.name = name
        self.should_fail = should_fail
        self.call_count = 0
        self.last_args = None
    
    def execute(self, **kwargs):
        """Execute the tool synchronously."""
        self.call_count += 1
        self.last_args = kwargs
        return {"success": True, "result": f"Tool {self.name} executed"}
    
    async def aexecute(self, **kwargs):
        """Execute the tool asynchronously."""
        self.call_count += 1
        self.last_args = kwargs
        return {"success": True, "result": f"Tool {self.name} executed"}
    
    async def arun(self, **kwargs):
        self.call_count += 1
        self.last_args = kwargs
        return {"success": True, "result": f"Tool {self.name} executed"}


class TestWorkflowEngine:
    """Test cases for WorkflowEngine class."""
    
    @pytest.fixture
    def engine(self):
        """Create a WorkflowEngine instance for testing."""
        return WorkflowEngine()
    
    @pytest.fixture
    def simple_workflow(self):
        """Create a simple workflow for testing."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Add nodes
        start_node = WorkflowNode(
            id="start",
            type="tool",
            name="Start Tool",
            config={"tool_name": "mock_tool", "args": {"action": "start"}}
        )
        end_node = WorkflowNode(
            id="end",
            type="tool",
            name="End Tool",
            config={"tool_name": "mock_tool", "args": {"action": "end"}}
        )
        
        workflow.add_node(start_node)
        workflow.add_node(end_node)
        
        # Add edge
        edge = WorkflowEdge(source="start", target="end")
        workflow.add_edge(edge)
        
        # Set entry point
        workflow.set_entry_point("start")
        
        return workflow
    
    @pytest.fixture
    def context(self):
        """Create a GUIAgentContext for testing."""
        return GUIAgentContext(
            agent_id="test_agent_001",
            session_id="test_session",
            task_id="test_task",
            metadata={"test": True}
        )
    
    def test_init(self, engine):
        """Test WorkflowEngine initialization."""
        assert engine.tools == {}
        assert engine.node_processors == {}
        assert engine.is_initialized() is False
    
    @pytest.mark.asyncio
    async def test_initialize(self, engine):
        """Test WorkflowEngine initialization."""
        await engine.initialize()
        assert engine.is_initialized() is True
        
        # Check default node processors are registered
        assert "tool" in engine.node_processors
        assert "function" in engine.node_processors
        assert "condition" in engine.node_processors
    
    def test_register_tool(self, engine):
        """Test tool registration."""
        mock_tool = MockTool("test_tool")
        engine.register_tool("test_tool", mock_tool)
        
        assert "test_tool" in engine.tools
        assert engine.tools["test_tool"] == mock_tool
    
    def test_register_node_processor(self, engine):
        """Test node processor registration."""
        async def custom_processor(node, context, execution):
            return {"success": True, "custom": True}
        
        engine.register_node_processor("custom", custom_processor)
        
        assert "custom" in engine.node_processors
        assert engine.node_processors["custom"] == custom_processor
    
    @pytest.mark.asyncio
    async def test_arun_simple_workflow(self, engine, simple_workflow, context):
        """Test running a simple workflow."""
        # Initialize engine
        await engine.initialize()
        
        # Register mock tool
        mock_tool = MockTool("mock_tool")
        engine.register_tool("mock_tool", mock_tool)
        
        # Run workflow
        result = await engine.arun(simple_workflow, context)
        
        # The arun method returns GUIAgentResult, not WorkflowExecution
        assert hasattr(result, 'status')
        assert result.status == "completed"
        
        # Check tool was called twice
        assert mock_tool.call_count == 2
    
    @pytest.mark.asyncio
    async def test_arun_workflow_with_condition(self, engine, context):
        """Test running workflow with conditional logic."""
        # Create workflow with condition
        workflow = GUIWorkflow(
            id="conditional_workflow",
            name="Conditional Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Add nodes
        start_node = WorkflowNode(
            id="start",
            type="tool",
            name="Start",
            config={"tool_name": "mock_tool", "args": {"action": "start"}}
        )
        condition_node = WorkflowNode(
            id="condition",
            type="condition",
            name="Check Condition",
            config={"expression": "context.get('test_condition', True)"}
        )
        success_node = WorkflowNode(
            id="success",
            type="tool",
            name="Success",
            config={"tool_name": "mock_tool", "args": {"action": "success"}}
        )
        
        workflow.add_node(start_node)
        workflow.add_node(condition_node)
        workflow.add_node(success_node)
        
        # Add edges
        workflow.add_edge(WorkflowEdge(source="start", target="condition"))
        workflow.add_edge(WorkflowEdge(source="condition", target="success", condition="result == True"))
        
        workflow.set_entry_point("start")
        
        # Initialize engine and register tool
        await engine.initialize()
        mock_tool = MockTool("mock_tool")
        engine.register_tool("mock_tool", mock_tool)
        
        # Set condition in context
        context.metadata["test_condition"] = True
        
        # Run workflow
        result = await engine.arun(workflow, context)
        
        assert result.status == "completed"
        assert len(result.node_executions) == 3  # start, condition, success
    
    @pytest.mark.asyncio
    async def test_execute_node_tool(self, engine, context, simple_workflow):
        """Test executing a tool node."""
        await engine.initialize()
        
        # Register mock tool
        mock_tool = MockTool("test_tool")
        engine.register_tool("test_tool", mock_tool)
        
        # Create tool node
        node = WorkflowNode(
            id="tool_node",
            type="tool",
            name="Test Tool",
            config={"tool_name": "test_tool", "args": {"param1": "value1"}}
        )
        
        # Execute node
        result = await engine._execute_node(node, context, simple_workflow)
        
        assert result.node_id == "tool_node"
        assert result.status == "completed"
        assert mock_tool.call_count == 1
        assert mock_tool.last_args == {"param1": "value1"}
    
    @pytest.mark.asyncio
    async def test_execute_node_function(self, engine, context, simple_workflow):
        """Test executing a function node."""
        await engine.initialize()
        
        # Create function node
        node = WorkflowNode(
            id="function_node",
            type="function",
            name="Test Function",
            config={
                "function": lambda ctx: ctx,  # Simple function that returns context
                "args": {}
            }
        )
        
        # Execute node
        result = await engine._execute_node(node, context, simple_workflow)
        
        assert result.node_id == "function_node"
        assert result.status == "completed"
    
    @pytest.mark.asyncio
    async def test_execute_node_condition(self, engine, context, simple_workflow):
        """Test executing a condition node."""
        await engine.initialize()
        
        # Create condition node
        node = WorkflowNode(
            id="condition_node",
            type="condition",
            name="Test Condition",
            config={"expression": "5 > 3"}
        )
        
        # Execute node
        result = await engine._execute_node(node, context, simple_workflow)
        
        assert result.node_id == "condition_node"
        assert result.status == "completed"
    
    @pytest.mark.asyncio
    async def test_execute_node_error_handling(self, engine, context, simple_workflow):
        """Test error handling during node execution."""
        await engine.initialize()
        
        # Create node that will cause error
        node = WorkflowNode(
            id="error_node",
            type="tool",
            name="Error Tool",
            config={"tool_name": "nonexistent_tool"}
        )
        
        # Execute node
        result = await engine._execute_node(node, context, simple_workflow)
        
        assert result.node_id == "error_node"
        assert result.status == "failed"
        assert "Tool not found: nonexistent_tool" in result.error
    
    def test_get_next_node(self, engine, simple_workflow, context):
        """Test getting next node in workflow."""
        # Get next node
        next_node_id = engine._get_next_node("start", context, simple_workflow)
        
        assert next_node_id is not None
        assert next_node_id == "end"
    
    def test_get_next_node_no_edges(self, engine, context):
        """Test getting next node when no outgoing edges exist."""
        workflow = GUIWorkflow(
            id="single_node_workflow",
            name="Single Node",
            version="1.0.0",
            organization_id="test_org"
        )
        
        node = WorkflowNode(id="single", type="tool", name="Single")
        workflow.add_node(node)
        workflow.set_entry_point("single")
        
        # Get next node (should be None)
        next_node_id = engine._get_next_node("single", context, workflow)
        
        assert next_node_id is None
    
    def test_evaluate_condition_true(self, engine, context):
        """Test condition evaluation that returns True."""
        context.metadata["x"] = 10
        context.metadata["y"] = 5
        result = engine._evaluate_condition("x > y", context)
        assert result is True
    
    def test_evaluate_condition_false(self, engine, context):
        """Test condition evaluation that returns False."""
        context.metadata["x"] = 3
        context.metadata["y"] = 5
        result = engine._evaluate_condition("x > y", context)
        assert result is False
    
    def test_evaluate_condition_complex(self, engine, context):
        """Test complex condition evaluation."""
        context.metadata["status"] = "success"
        context.metadata["count"] = 3
        result = engine._evaluate_condition("status == 'success' and count > 2", context)
        assert result is True
    
    def test_evaluate_condition_error(self, engine, context):
        """Test condition evaluation with syntax error."""
        context.metadata["x"] = 5
        result = engine._evaluate_condition("x >", context)  # Invalid syntax
        assert result is False  # Should return False on error