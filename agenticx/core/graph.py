"""
AgenticX Graph Execution Engine

Lightweight graph-based state machine for agent workflows.
Inspired by pydantic-graph design, but implemented from scratch.

Key Features:
- Type-driven edge definition: run() return type hints define graph edges
- State sharing via GraphRunContext
- Async execution with proper termination

This module is designed for "explore-validate-feedback" loops in
intelligent agent mining scenarios.
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import (
    Any,
    Callable,
    Dict,
    Generic,
    List,
    Optional,
    Sequence,
    Type,
    TypeVar,
    Union,
    get_args,
    get_origin,
    get_type_hints,
)
from datetime import datetime, timezone

# Type variables for generic graph components
StateT = TypeVar('StateT')
"""Type variable for the graph state."""

DepsT = TypeVar('DepsT')
"""Type variable for graph dependencies."""

RunEndT = TypeVar('RunEndT', covariant=True)
"""Covariant type variable for the graph run result."""

NodeRunEndT = TypeVar('NodeRunEndT', covariant=True)
"""Covariant type variable for node run result."""

T = TypeVar('T')
"""Generic type variable."""

logger = logging.getLogger(__name__)


@dataclass
class End(Generic[T]):
    """
    Sentinel node indicating graph execution should terminate.
    
    When a node's run() method returns End(result), the graph
    execution loop terminates and returns the encapsulated result.
    
    Attributes:
        result: The final result of the graph execution.
    
    Example:
        >>> @dataclass
        ... class FinalNode(BaseNode[MyState, None, int]):
        ...     async def run(self, ctx: GraphRunContext) -> End[int]:
        ...         return End(ctx.state.counter)
    """
    result: T


@dataclass(kw_only=True)
class GraphRunContext(Generic[StateT, DepsT]):
    """
    Runtime context for graph execution.
    
    This context is passed to each node's run() method, providing
    access to shared state and dependencies.
    
    Attributes:
        state: Mutable shared state across all nodes.
        deps: Immutable dependencies (e.g., services, configs).
        
    Example:
        >>> @dataclass
        ... class MyState:
        ...     counter: int = 0
        ... 
        >>> @dataclass
        ... class MyDeps:
        ...     api_client: Any
        ...
        >>> ctx = GraphRunContext(state=MyState(), deps=MyDeps(api_client=None))
        >>> ctx.state.counter += 1
    """
    state: StateT
    deps: DepsT


class BaseNode(ABC, Generic[StateT, DepsT, NodeRunEndT]):
    """
    Abstract base class for graph nodes.
    
    Each node represents a step in the graph execution. The run() method's
    return type annotation defines the possible next nodes (edges).
    
    Type Parameters:
        StateT: The type of the shared state.
        DepsT: The type of the dependencies.
        NodeRunEndT: The type of the result when this node terminates the graph.
    
    Example:
        >>> @dataclass
        ... class IncrementNode(BaseNode[MyState, None, int]):
        ...     async def run(self, ctx: GraphRunContext[MyState, None]) -> CheckNode | End[int]:
        ...         ctx.state.counter += 1
        ...         if ctx.state.counter >= 10:
        ...             return End(ctx.state.counter)
        ...         return CheckNode()
    """
    
    @abstractmethod
    async def run(
        self, ctx: GraphRunContext[StateT, DepsT]
    ) -> Union['BaseNode[StateT, DepsT, Any]', End[NodeRunEndT]]:
        """
        Execute this node's logic.
        
        Args:
            ctx: The graph run context with state and dependencies.
            
        Returns:
            Either the next node to execute or End to terminate.
        """
        ...
    
    @classmethod
    def get_node_id(cls) -> str:
        """Get the unique identifier for this node type."""
        return cls.__name__
    
    def __repr__(self) -> str:
        return f"{self.__class__.__name__}()"


@dataclass
class NodeDef(Generic[StateT, DepsT, RunEndT]):
    """
    Definition of a node in the graph.
    
    Contains metadata about a node type, including its possible
    outgoing edges (inferred from run() return type).
    """
    node_id: str
    node_class: Type[BaseNode[StateT, DepsT, RunEndT]]
    next_node_ids: List[str] = field(default_factory=list)
    can_end: bool = False


@dataclass
class GraphRunResult(Generic[RunEndT]):
    """
    Result of a graph execution.
    
    Attributes:
        result: The final result from the End node.
        steps_executed: Number of nodes executed.
        execution_time_ms: Total execution time in milliseconds.
        node_history: List of node IDs in execution order.
    """
    result: RunEndT
    steps_executed: int = 0
    execution_time_ms: float = 0.0
    node_history: List[str] = field(default_factory=list)


class Graph(Generic[StateT, DepsT, RunEndT]):
    """
    Graph definition and executor.
    
    A graph is a collection of nodes that define a state machine.
    Nodes' run() return types define the edges between them.
    
    Type Parameters:
        StateT: The type of the shared state.
        DepsT: The type of the dependencies.
        RunEndT: The type of the final result.
    
    Example:
        >>> graph = Graph(nodes=[IncrementNode, CheckNode])
        >>> result = await graph.run(
        ...     initial_node=IncrementNode(),
        ...     state=MyState(counter=0),
        ...     deps=None
        ... )
        >>> print(result.result)  # The final counter value
    """
    
    def __init__(
        self,
        *,
        nodes: Sequence[Type[BaseNode[StateT, DepsT, Any]]],
        name: Optional[str] = None,
        max_steps: int = 1000,
        auto_instrument: bool = True,
    ):
        """
        Create a graph from a sequence of node types.
        
        Args:
            nodes: The node types that make up the graph.
            name: Optional name for the graph.
            max_steps: Maximum number of steps before raising an error.
            auto_instrument: Whether to log execution details.
        """
        self.name = name or "Graph"
        self.max_steps = max_steps
        self.auto_instrument = auto_instrument
        
        # Build node definitions
        self.node_defs: Dict[str, NodeDef[StateT, DepsT, RunEndT]] = {}
        for node_class in nodes:
            node_def = self._build_node_def(node_class)
            self.node_defs[node_def.node_id] = node_def
        
        self._validate_graph()
    
    def _build_node_def(
        self, node_class: Type[BaseNode[StateT, DepsT, Any]]
    ) -> NodeDef[StateT, DepsT, RunEndT]:
        """Build a NodeDef by analyzing the node class."""
        node_id = node_class.get_node_id()
        next_node_ids: List[str] = []
        can_end = False
        
        # Get return type hints from run() method
        try:
            hints = get_type_hints(node_class.run)
            return_type = hints.get('return')
            
            if return_type:
                # Parse Union types (e.g., NodeA | NodeB | End[T])
                next_node_ids, can_end = self._parse_return_type(return_type)
        except Exception as e:
            logger.warning(f"Could not parse type hints for {node_id}: {e}")
        
        return NodeDef(
            node_id=node_id,
            node_class=node_class,
            next_node_ids=next_node_ids,
            can_end=can_end,
        )
    
    def _parse_return_type(self, return_type: Any) -> tuple[List[str], bool]:
        """
        Parse the return type to extract edge information.
        
        Returns:
            Tuple of (next_node_ids, can_end)
        """
        next_node_ids: List[str] = []
        can_end = False
        
        origin = get_origin(return_type)
        
        if origin is Union:
            # Handle Union types (including X | Y syntax)
            args = get_args(return_type)
            for arg in args:
                arg_origin = get_origin(arg)
                if arg_origin is None:
                    # It's a class, not a generic
                    if arg is End or (hasattr(arg, '__name__') and arg.__name__ == 'End'):
                        can_end = True
                    elif hasattr(arg, 'get_node_id'):
                        next_node_ids.append(arg.get_node_id())
                    elif hasattr(arg, '__name__'):
                        next_node_ids.append(arg.__name__)
                else:
                    # It's a generic type like End[T]
                    if hasattr(arg, '__origin__') and arg.__origin__ is End:
                        can_end = True
                    elif str(arg).startswith('End[') or 'End' in str(arg):
                        can_end = True
        elif return_type is End or (hasattr(return_type, '__name__') and return_type.__name__ == 'End'):
            can_end = True
        elif hasattr(return_type, '__origin__') and return_type.__origin__ is End:
            can_end = True
        elif hasattr(return_type, 'get_node_id'):
            next_node_ids.append(return_type.get_node_id())
        elif hasattr(return_type, '__name__'):
            next_node_ids.append(return_type.__name__)
        
        return next_node_ids, can_end
    
    def _validate_graph(self) -> None:
        """Validate the graph structure."""
        # Check that all referenced nodes exist
        for node_def in self.node_defs.values():
            for next_id in node_def.next_node_ids:
                if next_id not in self.node_defs:
                    logger.warning(
                        f"Node '{node_def.node_id}' references unknown node '{next_id}'"
                    )
    
    async def run(
        self,
        initial_node: BaseNode[StateT, DepsT, Any],
        state: StateT,
        deps: DepsT,
    ) -> GraphRunResult[RunEndT]:
        """
        Execute the graph starting from the initial node.
        
        Args:
            initial_node: The first node to execute.
            state: The initial state.
            deps: The dependencies.
            
        Returns:
            GraphRunResult containing the final result and execution metadata.
            
        Raises:
            RuntimeError: If max_steps is exceeded.
        """
        start_time = datetime.now(timezone.utc)
        ctx = GraphRunContext(state=state, deps=deps)
        
        current_node: Union[BaseNode[StateT, DepsT, Any], End[RunEndT]] = initial_node
        steps = 0
        node_history: List[str] = []
        
        if self.auto_instrument:
            logger.debug(f"[{self.name}] Starting graph execution")
        
        while not isinstance(current_node, End):
            if steps >= self.max_steps:
                raise RuntimeError(
                    f"Graph execution exceeded max_steps ({self.max_steps})"
                )
            
            node_id = current_node.get_node_id()
            node_history.append(node_id)
            
            if self.auto_instrument:
                logger.debug(f"[{self.name}] Step {steps}: Executing {node_id}")
            
            try:
                # Execute the node
                next_node = await current_node.run(ctx)
                current_node = next_node
                steps += 1
            except Exception as e:
                logger.error(f"[{self.name}] Error in {node_id}: {e}")
                raise
        
        end_time = datetime.now(timezone.utc)
        execution_time_ms = (end_time - start_time).total_seconds() * 1000
        
        if self.auto_instrument:
            logger.debug(
                f"[{self.name}] Completed in {steps} steps, {execution_time_ms:.2f}ms"
            )
        
        return GraphRunResult(
            result=current_node.result,
            steps_executed=steps,
            execution_time_ms=execution_time_ms,
            node_history=node_history,
        )
    
    def run_sync(
        self,
        initial_node: BaseNode[StateT, DepsT, Any],
        state: StateT,
        deps: DepsT,
    ) -> GraphRunResult[RunEndT]:
        """
        Synchronous wrapper for run().
        
        Args:
            initial_node: The first node to execute.
            state: The initial state.
            deps: The dependencies.
            
        Returns:
            GraphRunResult containing the final result and execution metadata.
        """
        return asyncio.run(self.run(initial_node, state, deps))
    
    def get_node_ids(self) -> List[str]:
        """Get all node IDs in the graph."""
        return list(self.node_defs.keys())
    
    def get_edges(self) -> List[tuple[str, str]]:
        """
        Get all edges in the graph as (from_node, to_node) tuples.
        
        Returns:
            List of edge tuples.
        """
        edges: List[tuple[str, str]] = []
        for node_def in self.node_defs.values():
            for next_id in node_def.next_node_ids:
                edges.append((node_def.node_id, next_id))
            if node_def.can_end:
                edges.append((node_def.node_id, "End"))
        return edges
    
    def to_mermaid(self) -> str:
        """
        Generate a Mermaid flowchart diagram of the graph.
        
        Returns:
            Mermaid diagram code as a string.
        
        Example:
            >>> print(graph.to_mermaid())
            graph TD
                IncrementNode --> CheckNode
                CheckNode --> IncrementNode
                CheckNode --> End
        """
        lines = ["graph TD"]
        
        for node_def in self.node_defs.values():
            for next_id in node_def.next_node_ids:
                lines.append(f"    {node_def.node_id} --> {next_id}")
            if node_def.can_end:
                lines.append(f"    {node_def.node_id} --> EndNode[End]")
        
        return "\n".join(lines)


# Type aliases for convenience
GraphContext = GraphRunContext
"""Alias for GraphRunContext."""


__all__ = [
    'End',
    'GraphRunContext',
    'GraphContext',
    'BaseNode',
    'NodeDef',
    'GraphRunResult',
    'Graph',
    'StateT',
    'DepsT',
    'RunEndT',
]

