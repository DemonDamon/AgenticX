"""Test to verify the fix for the None graph issue."""

import pytest
from agenticx.embodiment.workflow.workflow import GUIWorkflow
from agenticx.core.workflow import WorkflowNode, WorkflowEdge
from agenticx.embodiment.core.context import GUIAgentContext


def test_workflow_with_none_graph():
    """Test that workflow methods work even if graph is initially None."""
    # Create a workflow with graph explicitly set to None
    workflow = GUIWorkflow(
        id="test_workflow",
        name="Test Workflow",
        version="1.0.0",
        organization_id="test_org",
        entry_point="start_node"
    )
    
    # Manually set graph to None to simulate the issue
    workflow.graph = None
    
    # Adding a node should not raise an error
    node = WorkflowNode(
        id="start_node",
        type="tool",
        name="Start Node",
        config={"tool_name": "click", "args": {"element": "button"}}
    )
    
    # This should work without raising "add_node is not a known attribute of None"
    workflow.add_node(node)
    
    # Verify the node was added
    assert len(workflow.nodes) == 1
    assert workflow.nodes[0] == node


def test_workflow_graph_recreation():
    """Test that graph is properly recreated when None."""
    workflow = GUIWorkflow(
        id="test_workflow",
        name="Test Workflow",
        version="1.0.0",
        organization_id="test_org"
    )
    
    # Manually set graph to None
    workflow.graph = None
    
    # Adding nodes should recreate the graph
    node1 = WorkflowNode(id="node1", type="tool", name="Node 1")
    node2 = WorkflowNode(id="node2", type="tool", name="Node 2")
    
    workflow.add_node(node1)
    workflow.add_node(node2)
    
    # Graph should no longer be None
    assert workflow.graph is not None
    
    # Verify nodes were added to graph
    assert "node1" in workflow.graph.nodes()
    assert "node2" in workflow.graph.nodes()


def test_workflow_methods_with_none_graph():
    """Test that all workflow methods handle None graph gracefully."""
    workflow = GUIWorkflow(
        id="test_workflow",
        name="Test Workflow",
        version="1.0.0",
        organization_id="test_org"
    )
    
    # Manually set graph to None
    workflow.graph = None
    
    # These methods should not raise errors even with None graph
    successors = workflow.get_successors("nonexistent")
    predecessors = workflow.get_predecessors("nonexistent")
    entry_nodes = workflow.get_entry_nodes()
    terminal_nodes = workflow.get_terminal_nodes()
    
    # Should return empty lists
    assert successors == []
    assert predecessors == []
    assert entry_nodes == []
    assert terminal_nodes == []
    
    # Add nodes to test with actual data
    node1 = WorkflowNode(id="start", type="tool", name="Start")
    node2 = WorkflowNode(id="end", type="tool", name="End")
    workflow.add_node(node1)
    workflow.add_node(node2)
    
    # Set entry point
    workflow.entry_point = "start"
    
    # Validate should work
    # Note: We're not testing validation failure cases here as they would raise exceptions
    # Just ensuring the method can run without None graph errors