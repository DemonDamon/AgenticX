"""Workflow Builder Implementation.

This module provides the WorkflowBuilder class that offers a Pythonic DSL
for defining GUI workflows in a fluent, code-first manner.
"""

import uuid
from typing import Type, Dict, Any, Optional, Callable, Union, List
from functools import wraps

from agenticx.core.workflow import WorkflowNode, WorkflowEdge
from .workflow import GUIWorkflow
from agenticx.embodiment.core.context import GUIAgentContext


class WorkflowBuilder:
    """Pythonic DSL for building GUI workflows.
    
    Provides a fluent interface for defining workflows with:
    - Node registration and configuration
    - Edge definition with conditions
    - Entry point specification
    - State schema definition
    """
    
    def __init__(
        self, 
        workflow_id: Optional[str] = None,
        name: Optional[str] = None,
        version: str = "1.0.0",
        state_schema: Type[GUIAgentContext] = GUIAgentContext,
        organization_id: str = "default"
    ):
        """Initialize workflow builder.
        
        Args:
            workflow_id: Unique workflow identifier
            name: Workflow name
            version: Workflow version
            state_schema: State schema class
            organization_id: Organization identifier
        """
        self.workflow_id = workflow_id or f"workflow_{uuid.uuid4().hex[:8]}"
        self.name = name or f"workflow_{uuid.uuid4().hex[:8]}"
        self.version = version
        self.state_schema = state_schema
        self.organization_id = organization_id
        
        self._nodes: Dict[str, WorkflowNode] = {}
        self._edges: List[WorkflowEdge] = []
        self._entry_point: Optional[str] = None
        self._metadata: Dict[str, Any] = {}
    
    def add_node(
        self, 
        node_id: str, 
        handler: Union[Callable, str], 
        node_type: str = "function",
        name: Optional[str] = None,
        **config
    ) -> "WorkflowBuilder":
        """Add a node to the workflow.
        
        Args:
            node_id: Unique node identifier
            handler: Function or tool name to execute
            node_type: Type of node (function, tool, condition)
            name: Human-readable node name
            **config: Additional node configuration
            
        Returns:
            Self for method chaining
        """
        if node_id in self._nodes:
            raise ValueError(f"Node {node_id} already exists")
        
        # Prepare config based on handler type
        node_config = config.copy()
        if callable(handler):
            node_config["function"] = handler
            if node_type == "function":
                pass  # Keep as function type
        elif isinstance(handler, str):
            node_config["tool_name"] = handler
            node_type = "tool"
        else:
            raise ValueError(f"Invalid handler type: {type(handler)}")
        
        node = WorkflowNode(
            id=node_id,
            type=node_type,
            name=name or node_id,
            config=node_config
        )
        
        self._nodes[node_id] = node
        return self
    
    def add_tool_node(
        self, 
        node_id: str, 
        name: str,
        tool_name: str, 
        tool_args: Optional[Dict[str, Any]] = None
    ) -> "WorkflowBuilder":
        """Add a tool execution node.
        
        Args:
            node_id: Unique node identifier
            name: Human-readable node name
            tool_name: Name of the tool to execute
            tool_args: Arguments to pass to the tool
            
        Returns:
            Self for method chaining
        """
        return self.add_node(
            node_id=node_id,
            handler=tool_name,
            node_type="tool",
            name=name,
            args=tool_args or {}
        )
    
    def add_function_node(
        self, 
        node_id: str, 
        name: str,
        function: Callable, 
        config: Optional[Dict[str, Any]] = None
    ) -> "WorkflowBuilder":
        """Add a function execution node.
        
        Args:
            node_id: Unique node identifier
            name: Human-readable node name
            function: Function to execute
            config: Additional configuration
            
        Returns:
            Self for method chaining
        """
        return self.add_node(
            node_id=node_id,
            handler=function,
            node_type="function",
            name=name,
            **(config or {})
        )
    
    def add_condition_node(
        self, 
        node_id: str, 
        condition: Union[str, Callable], 
        name: Optional[str] = None
    ) -> "WorkflowBuilder":
        """Add a condition evaluation node.
        
        Args:
            node_id: Unique node identifier
            condition: Condition string or function
            name: Human-readable node name
            
        Returns:
            Self for method chaining
        """
        config = {}
        if isinstance(condition, str):
            config["condition"] = condition
        else:
            config["function"] = condition
        
        return self.add_node(
            node_id=node_id,
            handler=condition,
            node_type="condition",
            name=name,
            **config
        )
    
    def add_edge(
        self, 
        source: str, 
        target: str, 
        condition: Optional[str] = None,
        **metadata
    ) -> "WorkflowBuilder":
        """Add an edge between two nodes.
        
        Args:
            source: Source node ID
            target: Target node ID
            condition: Optional condition for edge traversal
            **metadata: Additional edge metadata
            
        Returns:
            Self for method chaining
        """
        if source not in self._nodes:
            raise ValueError(f"Source node {source} does not exist")
        if target not in self._nodes:
            raise ValueError(f"Target node {target} does not exist")
        
        edge = WorkflowEdge(
            source=source,
            target=target,
            condition=condition,
            metadata=metadata
        )
        
        self._edges.append(edge)
        return self
    
    def add_conditional_edge(
        self, 
        source: str, 
        target: str,
        condition: Union[str, Callable], 
        false_target: Optional[str] = None,
        **metadata
    ) -> "WorkflowBuilder":
        """Add conditional edges from a source node.
        
        Args:
            source: Source node ID
            target: Target if condition is true
            condition: Condition to evaluate
            false_target: Target if condition is false (optional)
            **metadata: Additional edge metadata
            
        Returns:
            Self for method chaining
        """
        # Convert callable to string if needed
        condition_str = condition if isinstance(condition, str) else str(condition)
        
        # Add true edge
        self.add_edge(
            source=source,
            target=target,
            condition=condition_str,
            **metadata
        )
        
        # Add false edge if false_target is provided
        if false_target is not None:
            false_condition = f"not ({condition_str})"
            self.add_edge(
                source=source,
                target=false_target,
                condition=false_condition,
                **metadata
            )
        
        return self
    
    def set_entry_point(self, node_id: str) -> "WorkflowBuilder":
        """Set the workflow entry point.
        
        Args:
            node_id: ID of the entry node
            
        Returns:
            Self for method chaining
        """
        if node_id not in self._nodes:
            raise ValueError(f"Entry point node {node_id} does not exist")
        
        self._entry_point = node_id
        return self
    
    def set_state_schema(self, schema: Union[Dict[str, Any], type]) -> "WorkflowBuilder":
        """Set the state schema for the workflow.
        
        Args:
            schema: State schema dictionary or class
            
        Returns:
            Self for method chaining
        """
        from agenticx.embodiment.core.context import GUIAgentContext
        
        if isinstance(schema, dict):
            # For now, we'll use GUIAgentContext as the default schema class
            # In a real implementation, you might want to create a dynamic class
            self.state_schema = GUIAgentContext
        else:
            self.state_schema = schema
        return self
    
    def set_metadata(self, metadata: Union[Dict[str, Any], str], value: Any = None) -> "WorkflowBuilder":
        """Set workflow metadata.
        
        Args:
            metadata: Metadata dictionary or key string
            value: Metadata value (when metadata is a key string)
            
        Returns:
            Self for method chaining
        """
        if isinstance(metadata, dict):
            self._metadata.update(metadata)
        else:
            if value is None:
                raise ValueError("Value must be provided when metadata is a key string")
            self._metadata[metadata] = value
        return self
    
    def build(
        self, 
        name: Optional[str] = None
    ) -> GUIWorkflow:
        """Build the workflow.
        
        Args:
            name: Override workflow name
            
        Returns:
            Constructed GUIWorkflow
        """
        if not self._entry_point:
            raise ValueError("Entry point must be set before building")
        
        if not self._nodes:
            raise ValueError("At least one node must be added before building")
        
        workflow = GUIWorkflow(
            id=self.workflow_id,
            name=name or self.name,
            version=self.version,
            organization_id=self.organization_id,
            entry_point=self._entry_point,
            nodes=list(self._nodes.values()),
            edges=self._edges,
            metadata=self._metadata,
            state_schema=self.state_schema
        )
        
        # Validate the workflow
        if not workflow.validate():
            raise ValueError("Built workflow failed validation")
        
        return workflow
    
    def node(self, node_id: str, node_type: str = "function", name: Optional[str] = None, **config):
        """Decorator for adding function nodes.
        
        Args:
            node_id: Unique node identifier
            node_type: Type of node
            name: Human-readable node name
            **config: Additional node configuration
            
        Returns:
            Decorator function
        """
        def decorator(func: Callable) -> Callable:
            self.add_node(
                node_id=node_id,
                handler=func,
                node_type=node_type,
                name=name or func.__name__,
                **config
            )
            return func
        return decorator
    
    def tool(self, node_id: str, tool_name: str, name: Optional[str] = None, **tool_args):
        """Decorator for adding tool nodes.
        
        Args:
            node_id: Unique node identifier
            tool_name: Name of the tool
            name: Human-readable node name
            **tool_args: Tool arguments
            
        Returns:
            Decorator function
        """
        def decorator(func: Callable) -> Callable:
            self.add_tool_node(
                node_id=node_id,
                tool_name=tool_name,
                name=name or func.__name__,
                **tool_args
            )
            return func
        return decorator


# Convenience functions for common workflow patterns
def create_sequential_workflow(
    name: str,
    steps: List[Dict[str, Any]],
    state_schema: Type[GUIAgentContext] = GUIAgentContext,
    organization_id: str = "default"
) -> GUIWorkflow:
    """Create a simple sequential workflow.
    
    Args:
        name: Workflow name
        steps: List of step definitions
        state_schema: State schema class
        organization_id: Organization identifier
        
    Returns:
        Constructed GUIWorkflow
    """
    builder = WorkflowBuilder(
        name=name,
        state_schema=state_schema,
        organization_id=organization_id
    )
    
    previous_step = None
    
    for i, step in enumerate(steps):
        step_id = step.get("id", f"step_{i}")
        step_type = step.get("type", "function")
        handler = step.get("handler")
        step_name = step.get("name", step_id)
        config = step.get("config", {})
        
        builder.add_node(
            node_id=step_id,
            handler=handler,
            node_type=step_type,
            name=step_name,
            **config
        )
        
        if i == 0:
            builder.set_entry_point(step_id)
        
        if previous_step:
            builder.add_edge(previous_step, step_id)
        
        previous_step = step_id
    
    return builder.build()


# Standalone decorator functions for convenience
def node(node_id: str, node_type: str = "function", name: Optional[str] = None, **config):
    """Standalone decorator for adding function nodes.
    
    This creates a global workflow builder instance if none exists.
    
    Args:
        node_id: Unique node identifier
        node_type: Type of node
        name: Human-readable node name
        **config: Additional node configuration
        
    Returns:
        Decorator function
    """
    def decorator(func: Callable) -> Callable:
        # This is a simplified version for testing purposes
        # In practice, you'd want to use a proper builder instance
        func._workflow_node_id = node_id
        func._workflow_node_type = node_type
        func._workflow_node_name = name or func.__name__
        func._workflow_node_config = config
        return func
    return decorator


def tool(node_id: str, tool_name: str, name: Optional[str] = None, **tool_args):
    """Standalone decorator for adding tool nodes.
    
    Args:
        node_id: Unique node identifier
        tool_name: Name of the tool
        name: Human-readable node name
        **tool_args: Tool arguments
        
    Returns:
        Decorator function
    """
    def decorator(func: Callable) -> Callable:
        # This is a simplified version for testing purposes
        func._workflow_tool_id = node_id
        func._workflow_tool_name = tool_name
        func._workflow_tool_display_name = name or func.__name__
        func._workflow_tool_args = tool_args
        return func
    return decorator


def create_conditional_workflow(
    name: str,
    entry_step: Dict[str, Any],
    condition: str,
    true_branch: List[Dict[str, Any]],
    false_branch: List[Dict[str, Any]],
    state_schema: Type[GUIAgentContext] = GUIAgentContext,
    organization_id: str = "default"
) -> GUIWorkflow:
    """Create a workflow with conditional branching.
    
    Args:
        name: Workflow name
        entry_step: Entry step definition
        condition: Condition for branching
        true_branch: Steps for true condition
        false_branch: Steps for false condition
        state_schema: State schema class
        organization_id: Organization identifier
        
    Returns:
        Constructed GUIWorkflow
    """
    builder = WorkflowBuilder(
        name=name,
        state_schema=state_schema,
        organization_id=organization_id
    )
    
    # Add entry step
    entry_id = entry_step.get("id", "entry")
    builder.add_node(
        node_id=entry_id,
        handler=entry_step.get("handler"),
        node_type=entry_step.get("type", "function"),
        name=entry_step.get("name", entry_id),
        **entry_step.get("config", {})
    )
    builder.set_entry_point(entry_id)
    
    # Add condition node
    condition_id = "condition"
    builder.add_condition_node(condition_id, condition)
    builder.add_edge(entry_id, condition_id)
    
    # Add true branch
    true_start = None
    previous_step = None
    for i, step in enumerate(true_branch):
        step_id = step.get("id", f"true_{i}")
        builder.add_node(
            node_id=step_id,
            handler=step.get("handler"),
            node_type=step.get("type", "function"),
            name=step.get("name", step_id),
            **step.get("config", {})
        )
        
        if i == 0:
            true_start = step_id
        
        if previous_step:
            builder.add_edge(previous_step, step_id)
        
        previous_step = step_id
    
    # Add false branch
    false_start = None
    previous_step = None
    for i, step in enumerate(false_branch):
        step_id = step.get("id", f"false_{i}")
        builder.add_node(
            node_id=step_id,
            handler=step.get("handler"),
            node_type=step.get("type", "function"),
            name=step.get("name", step_id),
            **step.get("config", {})
        )
        
        if i == 0:
            false_start = step_id
        
        if previous_step:
            builder.add_edge(previous_step, step_id)
        
        previous_step = step_id
    
    # Add conditional edges
    if true_start and false_start:
        builder.add_conditional_edge(
            condition_id, condition, true_start, false_start
        )
    
    return builder.build()