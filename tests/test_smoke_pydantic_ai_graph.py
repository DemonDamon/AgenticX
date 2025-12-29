"""
Smoke tests for AgenticX Graph Execution Engine.

Tests the lightweight graph-based state machine implementation
inspired by pydantic-graph design.
"""

import pytest
import asyncio
from dataclasses import dataclass, field
from typing import List, Optional, Any, Union

from agenticx.core.graph import (
    BaseNode,
    End,
    Graph,
    GraphRunContext,
    GraphRunResult,
    NodeDef,
)


# =============================================================================
# Test Fixtures: Simple Counter Graph
# =============================================================================

@dataclass
class CounterState:
    """Simple state for testing."""
    counter: int = 0
    history: List[str] = field(default_factory=list)


@dataclass
class CounterDeps:
    """Simple dependencies for testing."""
    max_value: int = 10
    increment_by: int = 1


@dataclass
class IncrementNode(BaseNode[CounterState, CounterDeps, int]):
    """Node that increments the counter."""
    
    async def run(
        self, ctx: GraphRunContext[CounterState, CounterDeps]
    ) -> Union['CheckNode', End[int]]:
        ctx.state.counter += ctx.deps.increment_by
        ctx.state.history.append(f"increment:{ctx.state.counter}")
        return CheckNode()


@dataclass
class CheckNode(BaseNode[CounterState, CounterDeps, int]):
    """Node that checks if counter reached max."""
    
    async def run(
        self, ctx: GraphRunContext[CounterState, CounterDeps]
    ) -> Union[IncrementNode, End[int]]:
        ctx.state.history.append(f"check:{ctx.state.counter}")
        if ctx.state.counter >= ctx.deps.max_value:
            return End(ctx.state.counter)
        return IncrementNode()


# =============================================================================
# Test Fixtures: Conditional Branching Graph
# =============================================================================

@dataclass
class BranchState:
    """State for branching tests."""
    value: int = 0
    path_taken: str = ""


@dataclass
class StartNode(BaseNode[BranchState, None, str]):
    """Start node that branches based on value."""
    
    async def run(
        self, ctx: GraphRunContext[BranchState, None]
    ) -> Union['LeftBranch', 'RightBranch']:
        if ctx.state.value < 50:
            return LeftBranch()
        return RightBranch()


@dataclass
class LeftBranch(BaseNode[BranchState, None, str]):
    """Left branch node."""
    
    async def run(
        self, ctx: GraphRunContext[BranchState, None]
    ) -> End[str]:
        ctx.state.path_taken = "left"
        return End("went left")


@dataclass
class RightBranch(BaseNode[BranchState, None, str]):
    """Right branch node."""
    
    async def run(
        self, ctx: GraphRunContext[BranchState, None]
    ) -> End[str]:
        ctx.state.path_taken = "right"
        return End("went right")


# =============================================================================
# Test Fixtures: Error Handling Graph
# =============================================================================

@dataclass
class ErrorState:
    """State for error tests."""
    should_fail: bool = False
    retry_count: int = 0


@dataclass
class MayFailNode(BaseNode[ErrorState, None, str]):
    """Node that may fail based on state."""
    
    async def run(
        self, ctx: GraphRunContext[ErrorState, None]
    ) -> Union['RecoveryNode', End[str]]:
        if ctx.state.should_fail and ctx.state.retry_count == 0:
            ctx.state.retry_count += 1
            raise ValueError("Simulated failure")
        return End("success")


@dataclass
class RecoveryNode(BaseNode[ErrorState, None, str]):
    """Recovery node after failure."""
    
    async def run(
        self, ctx: GraphRunContext[ErrorState, None]
    ) -> End[str]:
        return End("recovered")


# =============================================================================
# Tests: Basic Graph Execution
# =============================================================================

class TestGraphBasicExecution:
    """Tests for basic graph execution."""
    
    @pytest.mark.asyncio
    async def test_graph_basic_execution(self):
        """Test basic graph execution with counter."""
        graph = Graph(
            nodes=[IncrementNode, CheckNode],
            name="CounterGraph",
            max_steps=100,
        )
        
        result = await graph.run(
            initial_node=IncrementNode(),
            state=CounterState(counter=0),
            deps=CounterDeps(max_value=5, increment_by=1),
        )
        
        assert result.result == 5
        assert result.steps_executed == 10  # 5 increments + 5 checks
        assert len(result.node_history) == 10
    
    @pytest.mark.asyncio
    async def test_graph_starts_at_threshold(self):
        """Test graph when counter starts at threshold."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        
        result = await graph.run(
            initial_node=CheckNode(),  # Start with check
            state=CounterState(counter=10),
            deps=CounterDeps(max_value=10),
        )
        
        assert result.result == 10
        assert result.steps_executed == 1  # Just the check
    
    @pytest.mark.asyncio
    async def test_graph_custom_increment(self):
        """Test graph with custom increment value."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        
        result = await graph.run(
            initial_node=IncrementNode(),
            state=CounterState(counter=0),
            deps=CounterDeps(max_value=10, increment_by=5),
        )
        
        assert result.result == 10
        # 2 increments (0->5->10) + 2 checks = 4 steps
        assert result.steps_executed == 4


class TestGraphConditionalBranching:
    """Tests for conditional branching."""
    
    @pytest.mark.asyncio
    async def test_graph_left_branch(self):
        """Test graph takes left branch when value < 50."""
        graph = Graph(nodes=[StartNode, LeftBranch, RightBranch])
        
        result = await graph.run(
            initial_node=StartNode(),
            state=BranchState(value=25),
            deps=None,
        )
        
        assert result.result == "went left"
        assert result.steps_executed == 2
        assert result.node_history == ["StartNode", "LeftBranch"]
    
    @pytest.mark.asyncio
    async def test_graph_right_branch(self):
        """Test graph takes right branch when value >= 50."""
        graph = Graph(nodes=[StartNode, LeftBranch, RightBranch])
        
        result = await graph.run(
            initial_node=StartNode(),
            state=BranchState(value=75),
            deps=None,
        )
        
        assert result.result == "went right"
        assert result.steps_executed == 2
        assert result.node_history == ["StartNode", "RightBranch"]
    
    @pytest.mark.asyncio
    async def test_graph_boundary_value(self):
        """Test graph at boundary value (50)."""
        graph = Graph(nodes=[StartNode, LeftBranch, RightBranch])
        
        result = await graph.run(
            initial_node=StartNode(),
            state=BranchState(value=50),  # Exactly at boundary
            deps=None,
        )
        
        assert result.result == "went right"  # >= 50 goes right


class TestGraphStateSharing:
    """Tests for state sharing across nodes."""
    
    @pytest.mark.asyncio
    async def test_state_modified_by_nodes(self):
        """Test that state is properly modified by nodes."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        state = CounterState(counter=0)
        
        result = await graph.run(
            initial_node=IncrementNode(),
            state=state,
            deps=CounterDeps(max_value=3),
        )
        
        # State should be modified in place
        assert state.counter == 3
        assert len(state.history) > 0
        assert "increment:1" in state.history
        assert "check:3" in state.history
    
    @pytest.mark.asyncio
    async def test_state_history_order(self):
        """Test that state history reflects execution order."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        state = CounterState(counter=0)
        
        await graph.run(
            initial_node=IncrementNode(),
            state=state,
            deps=CounterDeps(max_value=2),
        )
        
        expected_history = [
            "increment:1",
            "check:1",
            "increment:2",
            "check:2",
        ]
        assert state.history == expected_history


class TestGraphEndTermination:
    """Tests for End node termination."""
    
    @pytest.mark.asyncio
    async def test_end_with_result(self):
        """Test End node properly returns result."""
        graph = Graph(nodes=[CheckNode, IncrementNode])
        
        result = await graph.run(
            initial_node=CheckNode(),
            state=CounterState(counter=100),
            deps=CounterDeps(max_value=10),
        )
        
        assert isinstance(result, GraphRunResult)
        assert result.result == 100
    
    @pytest.mark.asyncio
    async def test_end_terminates_loop(self):
        """Test that End immediately terminates execution."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        
        # Start with counter already at max
        result = await graph.run(
            initial_node=IncrementNode(),
            state=CounterState(counter=9),
            deps=CounterDeps(max_value=10),
        )
        
        # Should increment once to 10, check once, then end
        assert result.steps_executed == 2
        assert result.result == 10


class TestGraphMetadata:
    """Tests for graph metadata and introspection."""
    
    def test_graph_node_ids(self):
        """Test getting node IDs from graph."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        
        node_ids = graph.get_node_ids()
        
        assert "IncrementNode" in node_ids
        assert "CheckNode" in node_ids
        assert len(node_ids) == 2
    
    def test_graph_edges(self):
        """Test getting edges from graph."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        
        edges = graph.get_edges()
        
        # IncrementNode -> CheckNode
        assert ("IncrementNode", "CheckNode") in edges
        # CheckNode -> IncrementNode
        assert ("CheckNode", "IncrementNode") in edges
        # CheckNode -> End
        assert ("CheckNode", "End") in edges
    
    def test_graph_mermaid(self):
        """Test generating Mermaid diagram."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        
        mermaid = graph.to_mermaid()
        
        assert "graph TD" in mermaid
        assert "IncrementNode --> CheckNode" in mermaid
        assert "CheckNode --> IncrementNode" in mermaid
        assert "EndNode[End]" in mermaid


class TestGraphExecutionTime:
    """Tests for execution time tracking."""
    
    @pytest.mark.asyncio
    async def test_execution_time_tracked(self):
        """Test that execution time is tracked."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        
        result = await graph.run(
            initial_node=IncrementNode(),
            state=CounterState(counter=0),
            deps=CounterDeps(max_value=5),
        )
        
        assert result.execution_time_ms > 0
        assert result.execution_time_ms < 1000  # Should be fast


class TestGraphMaxSteps:
    """Tests for max steps limit."""
    
    @pytest.mark.asyncio
    async def test_max_steps_exceeded(self):
        """Test that exceeding max_steps raises error."""
        # Create a graph that never ends
        @dataclass
        class InfiniteNode(BaseNode[CounterState, CounterDeps, int]):
            async def run(self, ctx: GraphRunContext) -> 'InfiniteNode':
                ctx.state.counter += 1
                return InfiniteNode()
        
        graph = Graph(
            nodes=[InfiniteNode],
            max_steps=10,
        )
        
        with pytest.raises(RuntimeError, match="exceeded max_steps"):
            await graph.run(
                initial_node=InfiniteNode(),
                state=CounterState(),
                deps=CounterDeps(),
            )


class TestGraphSyncExecution:
    """Tests for synchronous execution wrapper."""
    
    def test_run_sync(self):
        """Test synchronous run wrapper."""
        graph = Graph(nodes=[IncrementNode, CheckNode])
        
        result = graph.run_sync(
            initial_node=IncrementNode(),
            state=CounterState(counter=0),
            deps=CounterDeps(max_value=3),
        )
        
        assert result.result == 3
        assert result.steps_executed == 6


class TestGraphErrorHandling:
    """Tests for error handling in graph execution."""
    
    @pytest.mark.asyncio
    async def test_node_exception_propagates(self):
        """Test that node exceptions propagate correctly."""
        graph = Graph(nodes=[MayFailNode, RecoveryNode])
        
        with pytest.raises(ValueError, match="Simulated failure"):
            await graph.run(
                initial_node=MayFailNode(),
                state=ErrorState(should_fail=True),
                deps=None,
            )
    
    @pytest.mark.asyncio
    async def test_node_success_after_retry_logic(self):
        """Test node succeeds when not configured to fail."""
        graph = Graph(nodes=[MayFailNode, RecoveryNode])
        
        result = await graph.run(
            initial_node=MayFailNode(),
            state=ErrorState(should_fail=False),
            deps=None,
        )
        
        assert result.result == "success"


# =============================================================================
# Integration Test: Complex Multi-Node Graph
# =============================================================================

@dataclass
class ComplexState:
    """State for complex graph test."""
    stage: str = "init"
    data: List[str] = field(default_factory=list)
    iterations: int = 0


@dataclass
class InitNode(BaseNode[ComplexState, None, List[str]]):
    async def run(self, ctx: GraphRunContext) -> 'ProcessNode':
        ctx.state.stage = "processing"
        ctx.state.data.append("init")
        return ProcessNode()


@dataclass
class ProcessNode(BaseNode[ComplexState, None, List[str]]):
    async def run(self, ctx: GraphRunContext) -> Union['ProcessNode', 'FinalizeNode']:
        ctx.state.data.append(f"process-{ctx.state.iterations}")
        ctx.state.iterations += 1
        
        if ctx.state.iterations >= 3:
            return FinalizeNode()
        return ProcessNode()


@dataclass
class FinalizeNode(BaseNode[ComplexState, None, List[str]]):
    async def run(self, ctx: GraphRunContext) -> End[List[str]]:
        ctx.state.stage = "done"
        ctx.state.data.append("finalize")
        return End(ctx.state.data)


class TestComplexGraph:
    """Tests for complex multi-node graph."""
    
    @pytest.mark.asyncio
    async def test_complex_graph_execution(self):
        """Test complex graph with multiple node types."""
        graph = Graph(nodes=[InitNode, ProcessNode, FinalizeNode])
        
        result = await graph.run(
            initial_node=InitNode(),
            state=ComplexState(),
            deps=None,
        )
        
        expected_data = [
            "init",
            "process-0",
            "process-1",
            "process-2",
            "finalize",
        ]
        assert result.result == expected_data
        # init + 3 process + finalize = 5 steps
        assert result.steps_executed == 5
    
    @pytest.mark.asyncio
    async def test_complex_graph_node_history(self):
        """Test node history tracking in complex graph."""
        graph = Graph(nodes=[InitNode, ProcessNode, FinalizeNode])
        
        result = await graph.run(
            initial_node=InitNode(),
            state=ComplexState(),
            deps=None,
        )
        
        expected_history = [
            "InitNode",
            "ProcessNode",
            "ProcessNode",
            "ProcessNode",
            "FinalizeNode",
        ]
        assert result.node_history == expected_history


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

