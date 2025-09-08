"""Tests for WorkflowBuilder class."""

import pytest
from unittest.mock import Mock
from agenticx.embodiment.workflow.builder import (
    WorkflowBuilder, 
    node, 
    tool, 
    create_sequential_workflow, 
    create_conditional_workflow
)
from agenticx.embodiment.workflow.workflow import GUIWorkflow
from agenticx.core.workflow import WorkflowNode, WorkflowEdge


class TestWorkflowBuilder:
    """Test cases for WorkflowBuilder class."""
    
    def test_init(self):
        """Test WorkflowBuilder initialization."""
        builder = WorkflowBuilder(
            workflow_id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        assert builder.workflow_id == "test_workflow"
        assert builder.name == "Test Workflow"
        assert builder.version == "1.0.0"
        assert builder.organization_id == "test_org"
        assert builder.entry_point is None
        assert builder.state_schema == {}
        assert len(builder.nodes) == 0
        assert len(builder.edges) == 0
    
    def test_add_node_basic(self):
        """Test adding a basic node."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        builder.add_node(
            node_id="test_node",
            node_type="tool",
            name="Test Node",
            config={"tool_name": "click"}
        )
        
        assert len(builder.nodes) == 1
        node = builder.nodes[0]
        assert node.id == "test_node"
        assert node.type == "tool"
        assert node.name == "Test Node"
        assert node.config == {"tool_name": "click"}
    
    def test_add_function_node(self):
        """Test adding a function node."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        def test_function(x, y):
            return x + y
        
        builder.add_function_node(
            node_id="func_node",
            name="Add Function",
            function=test_function,
            args={"x": 1, "y": 2}
        )
        
        assert len(builder.nodes) == 1
        node = builder.nodes[0]
        assert node.id == "func_node"
        assert node.type == "function"
        assert node.name == "Add Function"
        assert "function" in node.config
        assert node.config["args"] == {"x": 1, "y": 2}
    
    def test_add_tool_node(self):
        """Test adding a tool node."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        builder.add_tool_node(
            node_id="tool_node",
            name="Click Tool",
            tool_name="click",
            args={"element": "button"}
        )
        
        assert len(builder.nodes) == 1
        node = builder.nodes[0]
        assert node.id == "tool_node"
        assert node.type == "tool"
        assert node.name == "Click Tool"
        assert node.config["tool_name"] == "click"
        assert node.config["args"] == {"element": "button"}
    
    def test_add_condition_node(self):
        """Test adding a condition node."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        builder.add_condition_node(
            node_id="condition_node",
            name="Check Status",
            expression="status == 'success'"
        )
        
        assert len(builder.nodes) == 1
        node = builder.nodes[0]
        assert node.id == "condition_node"
        assert node.type == "condition"
        assert node.name == "Check Status"
        assert node.config["expression"] == "status == 'success'"
    
    def test_add_edge_basic(self):
        """Test adding a basic edge."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Add nodes first
        builder.add_node("node1", "tool", "Node 1")
        builder.add_node("node2", "tool", "Node 2")
        
        builder.add_edge("node1", "node2")
        
        assert len(builder.edges) == 1
        edge = builder.edges[0]
        assert edge.source == "node1"
        assert edge.target == "node2"
        assert edge.condition is None
    
    def test_add_conditional_edge(self):
        """Test adding a conditional edge."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Add nodes first
        builder.add_node("condition", "condition", "Condition")
        builder.add_node("success", "tool", "Success")
        
        builder.add_conditional_edge(
            "condition",
            "success",
            "result == True"
        )
        
        assert len(builder.edges) == 1
        edge = builder.edges[0]
        assert edge.source == "condition"
        assert edge.target == "success"
        assert edge.condition == "result == True"
    
    def test_set_entry_point(self):
        """Test setting entry point."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        builder.add_node("start", "tool", "Start")
        builder.set_entry_point("start")
        
        assert builder.entry_point == "start"
    
    def test_set_state_schema(self):
        """Test setting state schema."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        schema = {
            "current_screen": {"type": "string"},
            "user_input": {"type": "string"}
        }
        
        builder.set_state_schema(schema)
        
        assert builder.state_schema == schema
    
    def test_set_metadata(self):
        """Test setting metadata."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        metadata = {"author": "test", "description": "Test workflow"}
        builder.set_metadata(metadata)
        
        assert builder.metadata == metadata
    
    def test_build(self):
        """Test building a complete workflow."""
        builder = WorkflowBuilder(
            workflow_id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Build a simple workflow
        builder.add_tool_node("start", "Start", "click", {"element": "start_button"})
        builder.add_tool_node("end", "End", "click", {"element": "end_button"})
        builder.add_edge("start", "end")
        builder.set_entry_point("start")
        
        workflow = builder.build()
        
        assert isinstance(workflow, GUIWorkflow)
        assert workflow.id == "test_workflow"
        assert workflow.name == "Test Workflow"
        assert workflow.version == "1.0.0"
        assert workflow.organization_id == "test_org"
        assert workflow.entry_point == "start"
        assert len(workflow.nodes) == 2
        assert len(workflow.edges) == 1
    
    def test_build_validates_workflow(self):
        """Test that build validates the workflow."""
        builder = WorkflowBuilder(
            workflow_id="test",
            name="Test",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Build invalid workflow (no entry point)
        builder.add_node("node1", "tool", "Node 1")
        
        with pytest.raises(ValueError, match="Workflow must have an entry point"):
            builder.build()


class TestDecorators:
    """Test cases for workflow decorators."""
    
    def test_node_decorator(self):
        """Test @node decorator."""
        @node("test_node", "Test Node")
        def test_function(x, y):
            return x + y
        
        # Check that function is registered correctly in the registry
        from agenticx.embodiment.workflow.builder import get_workflow_node_info
        node_info = get_workflow_node_info(test_function)
        
        assert node_info is not None
        assert node_info['node_id'] == "test_node"
        assert node_info['name'] == "Test Node"
        
        # Check that function still works
        result = test_function(2, 3)
        assert result == 5
    
    def test_tool_decorator(self):
        """Test @tool decorator."""
        @tool("test_tool", "Test Tool")
        def test_tool_function(element):
            return f"Clicked {element}"
        
        # Check that function is registered correctly in the registry
        from agenticx.embodiment.workflow.builder import get_workflow_node_info
        tool_info = get_workflow_node_info(test_tool_function)
        
        assert tool_info is not None
        assert tool_info['tool_id'] == "test_tool"
        assert tool_info['tool_name'] == "Test Tool"
        
        # Check that function still works
        result = test_tool_function("button")
        assert result == "Clicked button"


class TestHelperFunctions:
    """Test cases for helper functions."""
    
    def test_create_sequential_workflow(self):
        """Test creating a sequential workflow."""
        steps = [
            {"id": "step1", "name": "Step 1", "tool_name": "click", "args": {"element": "button1"}},
            {"id": "step2", "name": "Step 2", "tool_name": "type", "args": {"text": "hello"}},
            {"id": "step3", "name": "Step 3", "tool_name": "click", "args": {"element": "submit"}}
        ]
        
        workflow = create_sequential_workflow(
            workflow_id="sequential_test",
            name="Sequential Test",
            steps=steps,
            version="1.0.0",
            organization_id="test_org"
        )
        
        assert isinstance(workflow, GUIWorkflow)
        assert workflow.id == "sequential_test"
        assert workflow.name == "Sequential Test"
        assert workflow.entry_point == "step1"
        assert len(workflow.nodes) == 3
        assert len(workflow.edges) == 2
        
        # Check edges connect steps sequentially
        edge1 = next(e for e in workflow.edges if e.source == "step1")
        edge2 = next(e for e in workflow.edges if e.source == "step2")
        assert edge1.target == "step2"
        assert edge2.target == "step3"
    
    def test_create_conditional_workflow(self):
        """Test creating a conditional workflow."""
        condition_config = {
            "condition_node": {
                "id": "check_status",
                "name": "Check Status",
                "expression": "status == 'success'"
            },
            "true_branch": [
                {"id": "success_step", "name": "Success", "tool_name": "click", "args": {"element": "success_button"}}
            ],
            "false_branch": [
                {"id": "failure_step", "name": "Failure", "tool_name": "click", "args": {"element": "failure_button"}}
            ]
        }
        
        workflow = create_conditional_workflow(
            workflow_id="conditional_test",
            name="Conditional Test",
            condition_config=condition_config,
            version="1.0.0",
            organization_id="test_org"
        )
        
        assert isinstance(workflow, GUIWorkflow)
        assert workflow.id == "conditional_test"
        assert workflow.name == "Conditional Test"
        assert workflow.entry_point == "check_status"
        assert len(workflow.nodes) == 3  # condition + 2 branch nodes
        assert len(workflow.edges) == 2  # true and false branches
        
        # Check conditional edges
        true_edge = next(e for e in workflow.edges if e.condition == "result == True")
        false_edge = next(e for e in workflow.edges if e.condition == "result == False")
        assert true_edge.target == "success_step"
        assert false_edge.target == "failure_step"
    
    def test_create_sequential_workflow_empty_steps(self):
        """Test creating sequential workflow with empty steps raises error."""
        with pytest.raises(ValueError, match="Steps cannot be empty"):
            create_sequential_workflow(
                workflow_id="test",
                name="Test",
                steps=[],
                version="1.0.0",
                organization_id="test_org"
            )
    
    def test_create_conditional_workflow_missing_config(self):
        """Test creating conditional workflow with missing config raises error."""
        incomplete_config = {
            "condition_node": {
                "id": "check",
                "name": "Check",
                "expression": "True"
            }
            # Missing true_branch and false_branch
        }
        
        with pytest.raises(ValueError, match="Condition config must include"):
            create_conditional_workflow(
                workflow_id="test",
                name="Test",
                condition_config=incomplete_config,
                version="1.0.0",
                organization_id="test_org"
            )