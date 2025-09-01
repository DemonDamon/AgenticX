"""Integration tests for GUI workflow system."""

import pytest
import asyncio
from typing import List, Dict, Any
from pydantic import Field
from unittest.mock import Mock, AsyncMock, patch
from agenticx.embodiment.workflow import GUIWorkflow, WorkflowEngine, WorkflowBuilder
from agenticx.embodiment.core.context import GUIAgentContext
from agenticx.core.tool import BaseTool
from agenticx.core.workflow import WorkflowNode, WorkflowEdge


class MockGUITool(BaseTool):
    """Mock GUI tool for integration testing."""
    
    actions: List[Dict[str, Any]] = Field(default_factory=list, description="Action history")
    
    def __init__(self, name: str, **data):
        super().__init__(name=name, description=f"Mock {name} tool for testing", **data)
    
    def execute(self, **kwargs):
        """Execute the tool synchronously."""
        action = {
            "tool": self.name,
            "args": kwargs,
            "timestamp": asyncio.get_event_loop().time()
        }
        self.actions.append(action)
        
        # Simulate different tool behaviors
        if self.name == "click":
            return {"success": True, "element_clicked": kwargs.get("element", "unknown")}
        elif self.name == "type":
            return {"success": True, "text_typed": kwargs.get("text", "")}
        elif self.name == "screenshot":
            return {"success": True, "screenshot_path": "/tmp/screenshot.png"}
        elif self.name == "wait":
            return {"success": True, "waited_seconds": kwargs.get("seconds", 1)}
        else:
            return {"success": True, "result": f"Tool {self.name} executed"}
    
    async def aexecute(self, **kwargs):
        """Execute the tool asynchronously."""
        action = {
            "tool": self.name,
            "args": kwargs,
            "timestamp": asyncio.get_event_loop().time()
        }
        self.actions.append(action)
        
        # Simulate different tool behaviors
        if self.name == "click":
            return {"success": True, "element_clicked": kwargs.get("element", "unknown")}
        elif self.name == "type":
            return {"success": True, "text_typed": kwargs.get("text", "")}
        elif self.name == "screenshot":
            return {"success": True, "screenshot_path": "/tmp/screenshot.png"}
        elif self.name == "wait":
            await asyncio.sleep(0.01)  # Simulate wait
            return {"success": True, "waited_seconds": kwargs.get("seconds", 1)}
        else:
            return {"success": True, "result": f"Tool {self.name} executed"}
    
    async def arun(self, **kwargs):
        action = {
            "tool": self.name,
            "args": kwargs,
            "timestamp": asyncio.get_event_loop().time()
        }
        self.actions.append(action)
        
        # Simulate different tool behaviors
        if self.name == "click":
            return {"success": True, "element_clicked": kwargs.get("element", "unknown")}
        elif self.name == "type":
            return {"success": True, "text_typed": kwargs.get("text", "")}
        elif self.name == "screenshot":
            return {"success": True, "screenshot_path": "/tmp/screenshot.png"}
        elif self.name == "wait":
            await asyncio.sleep(0.01)  # Simulate wait
            return {"success": True, "waited_seconds": kwargs.get("seconds", 1)}
        else:
            return {"success": True, "result": f"Tool {self.name} executed"}


class TestWorkflowIntegration:
    """Integration tests for the complete workflow system."""
    
    @pytest.fixture
    def engine(self):
        """Create and initialize a WorkflowEngine."""
        engine = WorkflowEngine()
        return engine
    
    @pytest.fixture
    def context(self):
        """Create a GUIAgentContext for testing."""
        return GUIAgentContext(
            agent_id="test_agent_001",
            session_id="integration_test",
            task_id="test_task",
            metadata={"test_mode": True}
        )
    
    @pytest.fixture
    def mock_tools(self):
        """Create mock GUI tools."""
        return {
            "click": MockGUITool("click"),
            "type": MockGUITool("type"),
            "screenshot": MockGUITool("screenshot"),
            "wait": MockGUITool("wait")
        }
    
    @pytest.mark.asyncio
    async def test_simple_login_workflow(self, engine, context, mock_tools):
        """Test a simple login workflow integration."""
        # Initialize engine and register tools
        await engine.initialize()
        for name, tool in mock_tools.items():
            engine.register_tool(name, tool)
        
        # Create login workflow using builder
        builder = WorkflowBuilder(
            workflow_id="login_workflow",
            name="Login Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Add workflow steps
        builder.add_tool_node(
            "take_screenshot",
            "Take Initial Screenshot",
            "screenshot",
            {"filename": "initial.png"}
        )
        
        builder.add_tool_node(
            "click_username",
            "Click Username Field",
            "click",
            {"element": "username_field"}
        )
        
        builder.add_tool_node(
            "type_username",
            "Type Username",
            "type",
            {"text": "testuser"}
        )
        
        builder.add_tool_node(
            "click_password",
            "Click Password Field",
            "click",
            {"element": "password_field"}
        )
        
        builder.add_tool_node(
            "type_password",
            "Type Password",
            "type",
            {"text": "testpass"}
        )
        
        builder.add_tool_node(
            "click_login",
            "Click Login Button",
            "click",
            {"element": "login_button"}
        )
        
        builder.add_tool_node(
            "wait_for_response",
            "Wait for Response",
            "wait",
            {"seconds": 2}
        )
        
        # Connect nodes sequentially
        builder.add_edge("take_screenshot", "click_username")
        builder.add_edge("click_username", "type_username")
        builder.add_edge("type_username", "click_password")
        builder.add_edge("click_password", "type_password")
        builder.add_edge("type_password", "click_login")
        builder.add_edge("click_login", "wait_for_response")
        
        builder.set_entry_point("take_screenshot")
        
        # Build and run workflow
        workflow = builder.build()
        result = await engine.arun(workflow, context)
        
        # Verify workflow execution
        assert result.status == "completed"
        assert len(result.node_executions) == 7
        
        # Verify all tools were called in correct order by checking node executions
        expected_node_order = [
            "take_screenshot", "click_username", "type_username", 
            "click_password", "type_password", "click_login", "wait_for_response"
        ]
        actual_node_order = [exec.node_id for exec in result.node_executions]
        assert actual_node_order == expected_node_order
        
        # Verify tools were called the correct number of times
        assert len(mock_tools["screenshot"].actions) == 1
        assert len(mock_tools["click"].actions) == 3
        assert len(mock_tools["type"].actions) == 2
        assert len(mock_tools["wait"].actions) == 1
        
        # Verify specific tool calls
        click_tool = mock_tools["click"]
        type_tool = mock_tools["type"]
        
        assert len(click_tool.actions) == 3
        assert click_tool.actions[0]["args"]["element"] == "username_field"
        assert click_tool.actions[1]["args"]["element"] == "password_field"
        assert click_tool.actions[2]["args"]["element"] == "login_button"
        
        assert len(type_tool.actions) == 2
        assert type_tool.actions[0]["args"]["text"] == "testuser"
        assert type_tool.actions[1]["args"]["text"] == "testpass"
    
    @pytest.mark.asyncio
    async def test_conditional_workflow_success_path(self, engine, context, mock_tools):
        """Test conditional workflow taking success path."""
        # Initialize engine and register tools
        await engine.initialize()
        for name, tool in mock_tools.items():
            engine.register_tool(name, tool)
        
        # Create conditional workflow
        builder = WorkflowBuilder(
            workflow_id="conditional_workflow",
            name="Conditional Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Add initial action
        builder.add_tool_node(
            "initial_action",
            "Initial Action",
            "click",
            {"element": "start_button"}
        )
        
        # Add condition check
        builder.add_condition_node(
            "check_success",
            "Check Success",
            "True"  # Always true for this test
        )
        
        # Add success path
        builder.add_tool_node(
            "success_action",
            "Success Action",
            "click",
            {"element": "success_button"}
        )
        
        # Add failure path
        builder.add_tool_node(
            "failure_action",
            "Failure Action",
            "click",
            {"element": "failure_button"}
        )
        
        # Connect nodes
        builder.add_edge("initial_action", "check_success")
        builder.add_conditional_edge("check_success", "success_action", "result == True")
        builder.add_conditional_edge("check_success", "failure_action", "result == False")
        
        builder.set_entry_point("initial_action")
        
        # Build and run workflow
        workflow = builder.build()
        result = await engine.arun(workflow, context)
        
        # Verify workflow execution
        assert result.status == "completed"
        assert len(result.node_executions) == 3  # initial + condition + success
        
        # Verify success path was taken
        node_ids = [exec.node_id for exec in result.node_executions]
        assert "initial_action" in node_ids
        assert "check_success" in node_ids
        assert "success_action" in node_ids
        assert "failure_action" not in node_ids
        
        # Verify tool calls
        click_tool = mock_tools["click"]
        assert len(click_tool.actions) == 2
        assert click_tool.actions[0]["args"]["element"] == "start_button"
        assert click_tool.actions[1]["args"]["element"] == "success_button"
    
    @pytest.mark.asyncio
    async def test_workflow_with_error_handling(self, engine, context, mock_tools):
        """Test workflow behavior when a tool fails."""
        # Initialize engine and register tools
        await engine.initialize()
        for name, tool in mock_tools.items():
            engine.register_tool(name, tool)
        
        # Create workflow with a failing tool
        builder = WorkflowBuilder(
            workflow_id="error_workflow",
            name="Error Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        builder.add_tool_node(
            "working_tool",
            "Working Tool",
            "click",
            {"element": "button"}
        )
        
        builder.add_tool_node(
            "failing_tool",
            "Failing Tool",
            "nonexistent_tool",  # This will cause an error
            {"element": "button"}
        )
        
        builder.add_edge("working_tool", "failing_tool")
        builder.set_entry_point("working_tool")
        
        # Build and run workflow
        workflow = builder.build()
        result = await engine.arun(workflow, context)
        
        # Verify workflow failed at the failing tool
        assert result.status == "failed"
        assert len(result.node_executions) == 2
        
        # Check that first node succeeded
        first_execution = result.node_executions[0]
        assert first_execution.node_id == "working_tool"
        assert first_execution.status == "completed"
        
        # Check that second node failed
        second_execution = result.node_executions[1]
        assert second_execution.node_id == "failing_tool"
        assert second_execution.status == "failed"
        assert "Tool not found: nonexistent_tool" in second_execution.error
    
    @pytest.mark.asyncio
    async def test_workflow_state_management(self, engine, context, mock_tools):
        """Test workflow state management and context updates."""
        # Initialize engine and register tools
        await engine.initialize()
        for name, tool in mock_tools.items():
            engine.register_tool(name, tool)
        
        # Create workflow that modifies context
        builder = WorkflowBuilder(
            workflow_id="state_workflow",
            name="State Management Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Set state schema
        builder.set_state_schema({
            "current_page": {"type": "string"},
            "form_data": {"type": "object"}
        })
        
        # Add function node that updates context
        def update_context(context):
            context.metadata["current_page"] = "login_page"
            context.metadata["form_data"] = {"username": "testuser"}
            return {"success": True, "page_updated": True}
        
        builder.add_function_node(
            "update_state",
            "Update State",
            update_context,
            {"context": context}
        )
        
        builder.add_tool_node(
            "take_action",
            "Take Action",
            "click",
            {"element": "submit_button"}
        )
        
        builder.add_edge("update_state", "take_action")
        builder.set_entry_point("update_state")
        
        # Build and run workflow
        workflow = builder.build()
        result = await engine.arun(workflow, context)
        
        # Verify workflow execution
        assert result.status == "completed"
        assert len(result.node_executions) == 2
        
        # Verify context was updated in the final result
        final_context = result.output
        assert "metadata" in final_context
        assert final_context["metadata"]["current_page"] == "login_page"
        assert final_context["metadata"]["form_data"] == {"username": "testuser"}
        
        # Verify function node result
        function_execution = result.node_executions[0]
        assert function_execution.node_id == "update_state"
        assert function_execution.status == "completed"
        # Check the function result in the output context
        assert "update_state_result" in final_context["metadata"]
        assert final_context["metadata"]["update_state_result"]["page_updated"] is True
    
    @pytest.mark.asyncio
    async def test_complex_branching_workflow(self, engine, context, mock_tools):
        """Test complex workflow with multiple branches and conditions."""
        # Initialize engine and register tools
        await engine.initialize()
        for name, tool in mock_tools.items():
            engine.register_tool(name, tool)
        
        # Create complex branching workflow
        builder = WorkflowBuilder(
            workflow_id="complex_workflow",
            name="Complex Branching Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Start node
        builder.add_tool_node("start", "Start", "screenshot", {})
        
        # First condition
        builder.add_condition_node("check_login", "Check Login Status", "True")
        
        # Login branch
        builder.add_tool_node("login", "Login", "click", {"element": "login_button"})
        
        # Second condition after login
        builder.add_condition_node("check_success", "Check Login Success", "True")
        
        # Success branch
        builder.add_tool_node("dashboard", "Go to Dashboard", "click", {"element": "dashboard_link"})
        
        # Failure branch
        builder.add_tool_node("retry", "Retry Login", "click", {"element": "retry_button"})
        
        # Already logged in branch
        builder.add_tool_node("continue", "Continue", "click", {"element": "continue_button"})
        
        # Connect nodes
        builder.add_edge("start", "check_login")
        builder.add_conditional_edge("check_login", "login", "result == True")
        builder.add_conditional_edge("check_login", "continue", "result == False")
        builder.add_edge("login", "check_success")
        builder.add_conditional_edge("check_success", "dashboard", "result == True")
        builder.add_conditional_edge("check_success", "retry", "result == False")
        
        builder.set_entry_point("start")
        
        # Build and run workflow
        workflow = builder.build()
        result = await engine.arun(workflow, context)
        
        # Verify workflow execution
        assert result.status == "completed"
        
        # Verify the path taken (start -> check_login -> login -> check_success -> dashboard)
        node_ids = [exec.node_id for exec in result.node_executions]
        expected_path = ["start", "check_login", "login", "check_success", "dashboard"]
        assert node_ids == expected_path
        
        # Verify tool calls
        screenshot_tool = mock_tools["screenshot"]
        click_tool = mock_tools["click"]
        
        assert len(screenshot_tool.actions) == 1
        assert len(click_tool.actions) == 2
        assert click_tool.actions[0]["args"]["element"] == "login_button"
        assert click_tool.actions[1]["args"]["element"] == "dashboard_link"
    
    def test_workflow_serialization_roundtrip(self):
        """Test workflow serialization and deserialization."""
        # Create workflow using builder
        builder = WorkflowBuilder(
            workflow_id="serialization_test",
            name="Serialization Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        builder.add_tool_node("node1", "Node 1", "click", {"element": "button1"})
        builder.add_tool_node("node2", "Node 2", "type", {"text": "hello"})
        builder.add_condition_node("condition", "Condition", "True")
        
        builder.add_edge("node1", "condition")
        builder.add_conditional_edge("condition", "node2", "result == True")
        
        builder.set_entry_point("node1")
        builder.set_metadata({"author": "test", "description": "Test workflow"})
        
        original_workflow = builder.build()
        
        # Serialize to dict
        workflow_dict = original_workflow.to_dict()
        
        # Deserialize from dict
        restored_workflow = GUIWorkflow.from_dict(workflow_dict)
        
        # Verify workflows are equivalent
        assert restored_workflow.id == original_workflow.id
        assert restored_workflow.name == original_workflow.name
        assert restored_workflow.version == original_workflow.version
        assert restored_workflow.organization_id == original_workflow.organization_id
        assert restored_workflow.entry_point == original_workflow.entry_point
        assert len(restored_workflow.nodes) == len(original_workflow.nodes)
        assert len(restored_workflow.edges) == len(original_workflow.edges)
        
        # Verify nodes are equivalent
        for orig_node, rest_node in zip(original_workflow.nodes, restored_workflow.nodes):
            assert orig_node.id == rest_node.id
            assert orig_node.type == rest_node.type
            assert orig_node.name == rest_node.name
            assert orig_node.config == rest_node.config
        
        # Verify edges are equivalent
        for orig_edge, rest_edge in zip(original_workflow.edges, restored_workflow.edges):
            assert orig_edge.source == rest_edge.source
            assert orig_edge.target == rest_edge.target
            assert orig_edge.condition == rest_edge.condition