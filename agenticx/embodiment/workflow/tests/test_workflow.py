"""Tests for GUIWorkflow class."""

import pytest
from unittest.mock import Mock, patch
from agenticx.embodiment.workflow.workflow import GUIWorkflow
from agenticx.core.workflow import WorkflowNode, WorkflowEdge
from agenticx.embodiment.core.context import GUIAgentContext


class TestGUIWorkflow:
    """Test cases for GUIWorkflow class."""
    
    def test_init_basic(self):
        """Test basic initialization of GUIWorkflow."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        assert workflow.id == "test_workflow"
        assert workflow.name == "Test Workflow"
        assert workflow.version == "1.0.0"
        assert workflow.organization_id == "test_org"
        assert workflow.entry_point is None
        assert workflow.state_schema == GUIAgentContext
        assert len(workflow.nodes) == 0
        assert len(workflow.edges) == 0
    
    def test_init_with_entry_point_and_schema(self):
        """Test initialization with entry point and state schema."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org",
            entry_point="start_node",
            state_schema=GUIAgentContext
        )
        
        assert workflow.entry_point == "start_node"
        assert workflow.state_schema == GUIAgentContext
    
    def test_add_node(self):
        """Test adding nodes to workflow."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        node = WorkflowNode(
            id="node1",
            type="tool",
            name="Click Button",
            config={"tool_name": "click", "args": {"element": "button"}}
        )
        
        workflow.add_node(node)
        assert len(workflow.nodes) == 1
        assert workflow.nodes[0] == node
    
    def test_add_edge(self):
        """Test adding edges to workflow."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Add nodes first
        node1 = WorkflowNode(id="node1", type="tool", name="Node 1")
        node2 = WorkflowNode(id="node2", type="tool", name="Node 2")
        workflow.add_node(node1)
        workflow.add_node(node2)
        
        edge = WorkflowEdge(
            source="node1",
            target="node2",
            condition="success"
        )
        
        workflow.add_edge(edge)
        assert len(workflow.edges) == 1
        assert workflow.edges[0] == edge
    
    def test_set_entry_point(self):
        """Test setting entry point."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Add a node first
        node = WorkflowNode(id="start_node", type="tool", name="Start")
        workflow.add_node(node)
        
        workflow.set_entry_point("start_node")
        assert workflow.entry_point == "start_node"
    
    def test_set_entry_point_nonexistent_node(self):
        """Test setting entry point to non-existent node raises error."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        with pytest.raises(ValueError, match="Node nonexistent does not exist in workflow"):
            workflow.set_entry_point("nonexistent")
    
    def test_validate_success(self):
        """Test successful workflow validation."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Create a simple valid workflow
        node1 = WorkflowNode(id="start", type="tool", name="Start")
        node2 = WorkflowNode(id="end", type="tool", name="End")
        edge = WorkflowEdge(source="start", target="end")
        
        workflow.add_node(node1)
        workflow.add_node(node2)
        workflow.add_edge(edge)
        workflow.set_entry_point("start")
        
        # Should not raise any exception
        workflow.validate_workflow()
    
    def test_validate_no_entry_point(self):
        """Test validation fails when no entry point is set."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        node = WorkflowNode(id="node1", type="tool", name="Node 1")
        workflow.add_node(node)
        
        with pytest.raises(ValueError, match="Workflow must have an entry point"):
            workflow.validate_workflow()
    
    def test_validate_invalid_entry_point(self):
        """Test validation fails when entry point references non-existent node."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org",
            entry_point="nonexistent"
        )
        
        node = WorkflowNode(id="node1", type="tool", name="Node 1")
        workflow.add_node(node)
        
        with pytest.raises(ValueError, match="Entry point 'nonexistent' references non-existent node"):
            workflow.validate_workflow()
    
    @patch('agenticx.embodiment.workflow.workflow.nx')
    def test_validate_cycle_detection(self, mock_nx):
        """Test validation detects cycles in workflow."""
        # Mock NetworkX to simulate cycle detection
        mock_graph = Mock()
        mock_nx.DiGraph.return_value = mock_graph
        mock_nx.is_directed_acyclic_graph.return_value = False
        
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org"
        )
        
        # Create nodes and edges that would form a cycle
        node1 = WorkflowNode(id="node1", type="tool", name="Node 1")
        node2 = WorkflowNode(id="node2", type="tool", name="Node 2")
        edge1 = WorkflowEdge(source="node1", target="node2")
        edge2 = WorkflowEdge(source="node2", target="node1")
        
        workflow.add_node(node1)
        workflow.add_node(node2)
        workflow.add_edge(edge1)
        workflow.add_edge(edge2)
        workflow.set_entry_point("node1")
        
        with pytest.raises(ValueError, match="Workflow contains cycles"):
            workflow.validate_workflow()
    
    def test_to_dict(self):
        """Test converting workflow to dictionary."""
        workflow = GUIWorkflow(
            id="test_workflow",
            name="Test Workflow",
            version="1.0.0",
            organization_id="test_org",
            entry_point="start"
        )
        
        node = WorkflowNode(id="start", type="tool", name="Start")
        edge = WorkflowEdge(source="start", target="end")
        workflow.add_node(node)
        workflow.add_edge(edge)
        
        result = workflow.to_dict()
        
        assert result["id"] == "test_workflow"
        assert result["name"] == "Test Workflow"
        assert result["version"] == "1.0.0"
        assert result["organization_id"] == "test_org"
        assert result["entry_point"] == "start"
        assert result["state_schema"] == "GUIAgentContext"
        assert len(result["nodes"]) == 1
        assert len(result["edges"]) == 1
    
    def test_from_dict(self):
        """Test creating workflow from dictionary."""
        data = {
            "id": "test_workflow",
            "name": "Test Workflow",
            "version": "1.0.0",
            "organization_id": "test_org",
            "entry_point": "start",
            "state_schema": "GUIAgentContext",
            "nodes": [
                {
                    "id": "start",
                    "type": "tool",
                    "name": "Start",
                    "config": {}
                }
            ],
            "edges": [
                {
                    "source": "start",
                    "target": "end",
                    "condition": None,
                    "metadata": {}
                }
            ],
            "metadata": {}
        }
        
        workflow = GUIWorkflow.from_dict(data)
        
        assert workflow.id == "test_workflow"
        assert workflow.name == "Test Workflow"
        assert workflow.version == "1.0.0"
        assert workflow.organization_id == "test_org"
        assert workflow.entry_point == "start"
        assert workflow.state_schema == GUIAgentContext
        assert len(workflow.nodes) == 1
        assert len(workflow.edges) == 1
        assert workflow.nodes[0].id == "start"
        assert workflow.edges[0].source == "start"