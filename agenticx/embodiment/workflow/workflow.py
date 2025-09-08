"""GUI Workflow Implementation.

This module provides the GUIWorkflow class that extends the core Workflow
with GUI-specific capabilities and state management.
"""

from typing import Type, Dict, Any, Optional, List
from pydantic import Field
import networkx as nx

from agenticx.core.workflow import Workflow, WorkflowNode, WorkflowEdge
from agenticx.embodiment.core.context import GUIAgentContext
from agenticx.embodiment.core.models import GUIAgentResult


class GUIWorkflow(Workflow):
    """GUI task workflow representation.
    
    Extends the core Workflow with GUI-specific capabilities including:
    - Graph-based workflow structure using NetworkX
    - GUI state schema definition
    - Entry point management
    - GUI-specific metadata
    """
    
    model_config = {"arbitrary_types_allowed": True}
    
    # GUI-specific fields
    entry_point: Optional[str] = Field(default=None, description="Graph entry node name")
    state_schema: Type[GUIAgentContext] = Field(
        default=GUIAgentContext,
        description="State schema for this workflow"
    )
    
    # Internal graph representation
    graph: Optional[nx.DiGraph] = Field(default=None, exclude=True)
    
    def __init__(self, **data):
        """Initialize GUI workflow."""
        super().__init__(**data)
        if self.graph is None:
            self.graph = nx.DiGraph()
        self._build_graph()
    
    def _build_graph(self) -> None:
        """Build NetworkX graph from nodes and edges."""
        if self.graph is None:
            self.graph = nx.DiGraph()
        else:
            self.graph.clear()  # Clear existing graph instead of reassigning
        
        # Add nodes
        for node in self.nodes:
            self.graph.add_node(
                node.id,
                type=node.type,
                name=node.name,
                config=node.config
            )
        
        # Add edges
        for edge in self.edges:
            self.graph.add_edge(
                edge.source,
                edge.target,
                condition=edge.condition,
                metadata=edge.metadata
            )
    
    def rebuild_graph(self) -> None:
        """Rebuild the NetworkX graph representation."""
        self._build_graph()
    
    def add_node(self, node: WorkflowNode) -> None:
        """Add a node to the workflow graph."""
        self.nodes.append(node)
        if self.graph is not None:
            self.graph.add_node(node.id, node=node)
        else:
            # Recreate graph if it was None
            self.graph = nx.DiGraph()
            self.graph.add_node(node.id, node=node)
            # Rebuild the rest of the graph
            self._build_graph()
    
    def add_edge(self, edge: WorkflowEdge) -> None:
        """Add an edge to the workflow graph."""
        self.edges.append(edge)
        if self.graph is not None:
            self.graph.add_edge(edge.source, edge.target, edge=edge)
        else:
            # Recreate graph if it was None
            self.graph = nx.DiGraph()
            self.graph.add_edge(edge.source, edge.target, edge=edge)
            # Rebuild the rest of the graph
            self._build_graph()
    
    def get_node(self, node_id: str) -> Optional[WorkflowNode]:
        """Get a node by ID."""
        for node in self.nodes:
            if node.id == node_id:
                return node
        return None
    
    def get_successors(self, node_id: str) -> List[str]:
        """Get successor node IDs for a given node."""
        if self.graph is None:
            self._build_graph()
        if self.graph is not None:
            try:
                return list(self.graph.successors(node_id))
            except Exception:
                # Node doesn't exist in graph
                return []
        return []
    
    def get_predecessors(self, node_id: str) -> List[str]:
        """Get predecessor node IDs for a given node."""
        if self.graph is None:
            self._build_graph()
        if self.graph is not None:
            try:
                return list(self.graph.predecessors(node_id))
            except Exception:
                # Node doesn't exist in graph
                return []
        return []
    
    def validate_workflow(self) -> bool:
        """Validate the workflow structure."""
        # Check if workflow has an entry point
        if self.entry_point is None:
            raise ValueError("Workflow must have an entry point")
        
        # Check if entry point exists
        if self.entry_point not in [node.id for node in self.nodes]:
            raise ValueError(f"Entry point '{self.entry_point}' references non-existent node")
        
        # Ensure graph exists
        if self.graph is None:
            self._build_graph()
        
        # Check for cycles (optional - some workflows may allow cycles)
        if self.graph is not None and not nx.is_directed_acyclic_graph(self.graph):
            raise ValueError("Workflow contains cycles")
        
        # Check if all edges reference valid nodes
        node_ids = {node.id for node in self.nodes}
        for edge in self.edges:
            if edge.source not in node_ids or edge.target not in node_ids:
                raise ValueError(f"Edge references non-existent nodes: {edge.source} -> {edge.target}")
        
        return True
    
    def set_entry_point(self, node_id: str) -> None:
        """Set the workflow entry point.
        
        Args:
            node_id: ID of the node to set as entry point
            
        Raises:
            ValueError: If the node doesn't exist in the workflow
        """
        node_ids = {node.id for node in self.nodes}
        if node_id not in node_ids:
            raise ValueError(f"Node {node_id} does not exist in workflow")
        
        self.entry_point = node_id
    
    def get_entry_nodes(self) -> List[str]:
        """Get all nodes that have no incoming edges (entry points)."""
        if self.graph is None:
            self._build_graph()
        if self.graph is not None:
            try:
                return [node for node in self.graph.nodes() if self.graph.in_degree(node) == 0]
            except Exception:
                # Error accessing graph
                return []
        return []
    
    def get_terminal_nodes(self) -> List[str]:
        """Get all terminal nodes (nodes with no successors)."""
        if self.graph is None:
            self._build_graph()
        if self.graph is not None:
            try:
                return [node for node in self.graph.nodes() if self.graph.out_degree(node) == 0]
            except Exception:
                # Error accessing graph
                return []
        return []
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert workflow to dictionary representation."""
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "organization_id": self.organization_id,
            "entry_point": self.entry_point,
            "state_schema": self.state_schema.__name__ if hasattr(self.state_schema, '__name__') else str(self.state_schema),
            "nodes": [node.dict() for node in self.nodes],
            "edges": [edge.dict() for edge in self.edges],
            "metadata": self.metadata
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GUIWorkflow":
        """Create workflow from dictionary representation."""
        # Handle state_schema field
        state_schema = data.get("state_schema")
        if state_schema == "GUIAgentContext" or state_schema is None:
            from agenticx.embodiment.core.context import GUIAgentContext
            state_schema_class = GUIAgentContext
        else:
            # For other state schema types, use GUIAgentContext as default
            from agenticx.embodiment.core.context import GUIAgentContext
            state_schema_class = GUIAgentContext
        
        workflow = cls(
            id=data["id"],
            name=data["name"],
            version=data["version"],
            organization_id=data["organization_id"],
            entry_point=data.get("entry_point"),
            state_schema=state_schema_class,
            metadata=data.get("metadata", {})
        )
        
        # Add nodes
        for node_data in data.get("nodes", []):
            node = WorkflowNode(**node_data)
            workflow.add_node(node)
        
        # Add edges
        for edge_data in data.get("edges", []):
            edge = WorkflowEdge(**edge_data)
            workflow.add_edge(edge)
        
        return workflow