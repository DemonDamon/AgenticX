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
        self.state_schema = state_schema if state_schema != GUIAgentContext else {}
        self.organization_id = organization_id
        
        self._nodes: Dict[str, WorkflowNode] = {}
        self._edges: List[WorkflowEdge] = []
        self._entry_point: Optional[str] = None
        self._metadata: Dict[str, Any] = {}
    
    @property
    def metadata(self) -> Dict[str, Any]:
        """Get workflow metadata."""
        return self._metadata
    
    @property
    def edges(self) -> List[WorkflowEdge]:
        """Get workflow edges."""
        return self._edges
    
    @property
    def entry_point(self) -> Optional[str]:
        """Get workflow entry point."""
        return self._entry_point
    
    @property
    def nodes(self) -> List[WorkflowNode]:
        """Get workflow nodes as a list."""
        return list(self._nodes.values())
    
    def add_node(
        self, 
        node_id: str, 
        node_type: str = "function",
        name: Optional[str] = None,
        handler: Optional[Union[Callable, str]] = None,
        config: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> "WorkflowBuilder":
        """Add a node to the workflow.
        
        Args:
            node_id: Unique node identifier
            node_type: Type of node (function, tool, condition)
            name: Human-readable node name
            handler: Function or handler for the node
            config: Additional configuration for the node
            **kwargs: Additional configuration for the node
            
        Returns:
            Self for method chaining
        """
        if node_id in self._nodes:
            raise ValueError(f"Node {node_id} already exists")
        
        # Prepare config based on handler type
        node_config = config.copy() if config else {}
        node_config.update(kwargs)
        
        if callable(handler):
            node_config["function"] = handler
            if node_type == "function":
                pass  # Keep as function type
        elif isinstance(handler, str):
            node_config["tool_name"] = handler
            node_type = "tool"
        elif handler is not None:
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
        args: Optional[Dict[str, Any]] = None
    ) -> "WorkflowBuilder":
        """Add a tool execution node.
        
        Args:
            node_id: Unique node identifier
            name: Human-readable node name
            tool_name: Name of the tool to execute
            args: Arguments to pass to the tool
            
        Returns:
            Self for method chaining
        """
        return self.add_node(
            node_id=node_id,
            handler=tool_name,
            node_type="tool",
            name=name,
            args=args or {}
        )
    
    def add_function_node(
        self, 
        node_id: str, 
        name: str,
        function: Callable, 
        args: Optional[Dict[str, Any]] = None
    ) -> "WorkflowBuilder":
        """Add a function execution node.
        
        Args:
            node_id: Unique node identifier
            name: Human-readable node name
            function: Function to execute
            args: Additional configuration
            
        Returns:
            Self for method chaining
        """
        node_config = {}
        node_config["function"] = function
        if args:
            node_config["args"] = args
            
        node = WorkflowNode(
            id=node_id,
            type="function",
            name=name or node_id,
            config=node_config
        )
        self._nodes[node_id] = node
        return self
    
    def add_condition_node(
        self, 
        node_id: str, 
        name: Optional[str] = None,
        expression: str = "True",
        **config
    ) -> "WorkflowBuilder":
        """Add a condition evaluation node.
        
        Args:
            node_id: Unique node identifier
            expression: Condition expression
            name: Human-readable node name
            
        Returns:
            Self for method chaining
        """
        node_config = config.copy() if config else {}
        node_config["expression"] = expression
            
        node = WorkflowNode(
            id=node_id,
            type="condition",
            name=name or node_id,
            config=node_config
        )
        self._nodes[node_id] = node
        return self
    
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
            raise ValueError("Workflow must have an entry point")
        
        if not self._nodes:
            raise ValueError("At least one node must be added before building")
        
        # Ensure state_schema is a proper class, not a dict
        state_schema = self.state_schema if isinstance(self.state_schema, type) else GUIAgentContext
        
        workflow = GUIWorkflow(
            id=self.workflow_id,
            name=name or self.name,
            version=self.version,
            organization_id=self.organization_id,
            entry_point=self._entry_point,
            nodes=list(self._nodes.values()),
            edges=self._edges,
            metadata=self._metadata,
            state_schema=state_schema
        )
        
        # Validate workflow
        if not workflow.validate_workflow():
            raise ValueError("Invalid workflow")
        
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


# 添加一个全局注册表来存储函数与工作流节点的映射关系
_workflow_node_registry = {}


# Convenience functions for common workflow patterns
def create_sequential_workflow(
    name: str,
    steps: List[Dict[str, Any]],
    workflow_id: Optional[str] = None,
    version: str = "1.0.0",
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
        workflow_id=workflow_id or name.lower().replace(" ", "_"),
        name=name,
        version=version,
        state_schema=state_schema,
        organization_id=organization_id
    )
    
    previous_step = None
    
    if not steps:
        raise ValueError("Steps cannot be empty")
    
    for i, step in enumerate(steps):
        step_id = step.get("id", f"step_{i}")
        step_name = step.get("name", step_id)
        
        if "tool_name" in step:
            # This is a tool node
            builder.add_tool_node(
                node_id=step_id,
                name=step_name,
                tool_name=step["tool_name"],
                args=step.get("args", {})
            )
        else:
            # This is a function node
            step_type = step.get("type", "function")
            handler = step.get("handler")
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
def node(node_id: str, name: Optional[str] = None, node_type: str = "function", **config):
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
        # 使用注册表存储函数与工作流节点的映射关系，而不是直接给函数添加属性
        _workflow_node_registry[func] = {
            'node_id': node_id,
            'node_type': node_type,
            'name': name if name is not None else func.__name__,
            'config': config
        }
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
        # 使用注册表存储函数与工具节点的映射关系
        _workflow_node_registry[func] = {
            'tool_id': node_id,
            'tool_name': tool_name,
            'display_name': name or func.__name__,
            'tool_args': tool_args
        }
        return func
    return decorator


def get_workflow_node_info(func: Callable) -> Optional[Dict[str, Any]]:
    """获取函数关联的工作流节点信息。
    
    Args:
        func: 装饰的函数
        
    Returns:
        工作流节点信息字典，如果函数未被装饰则返回None
    """
    return _workflow_node_registry.get(func)


def create_conditional_workflow(
    name: str,
    condition_config: Dict[str, Any],
    workflow_id: Optional[str] = None,
    version: str = "1.0.0",
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
        workflow_id=workflow_id or name.lower().replace(" ", "_"),
        name=name,
        version=version,
        state_schema=state_schema,
        organization_id=organization_id
    )
    
    # Validate condition_config
    if "condition_node" not in condition_config:
        raise ValueError("Condition config must include 'condition_node'")
    if "true_branch" not in condition_config:
        raise ValueError("Condition config must include 'true_branch'")
    if "false_branch" not in condition_config:
        raise ValueError("Condition config must include 'false_branch'")
    
    # Add condition node
    condition_node = condition_config["condition_node"]
    condition_id = condition_node.get("id", "condition")
    builder.add_condition_node(
        node_id=condition_id,
        expression=condition_node.get("expression", "True"),
        name=condition_node.get("name", "Condition")
    )
    builder.set_entry_point(condition_id)
    
    # Add true branch
    true_branch = condition_config["true_branch"]
    true_start = None
    previous_step = None
    for i, step in enumerate(true_branch):
        step_id = step.get("id", f"true_{i}")
        builder.add_tool_node(
            node_id=step_id,
            name=step.get("name", step_id),
            tool_name=step.get("tool_name", "default_tool"),
            args=step.get("args", {})
        )
        
        if i == 0:
            true_start = step_id
        
        if previous_step:
            builder.add_edge(previous_step, step_id)
        
        previous_step = step_id
    
    # Add false branch
    false_branch = condition_config["false_branch"]
    false_start = None
    previous_step = None
    for i, step in enumerate(false_branch):
        step_id = step.get("id", f"false_{i}")
        builder.add_tool_node(
            node_id=step_id,
            name=step.get("name", step_id),
            tool_name=step.get("tool_name", "default_tool"),
            args=step.get("args", {})
        )
        
        if i == 0:
            false_start = step_id
        
        if previous_step:
            builder.add_edge(previous_step, step_id)
        
        previous_step = step_id
    
    # Add conditional edges
    if true_start and false_start:
        # Add true edge
        builder.add_edge(
            source=condition_id,
            target=true_start,
            condition="result == True"
        )
        # Add false edge
        builder.add_edge(
            source=condition_id,
            target=false_start,
            condition="result == False"
        )
    
    return builder.build()