"""
Smoke tests for Mining Graph implementation.

Tests the graph-based mining workflow:
- ExploreNode: API discovery
- ValidateNode: Validation with error handling
- FeedbackNode: LLM-driven error correction
"""

import pytest
import asyncio
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

from agenticx.agents.mining_graph import (
    MiningState,
    MiningDeps,
    ExploreNode,
    ValidateNode,
    FeedbackNode,
    create_mining_graph,
    MiningGraphRunner,
)
from agenticx.core.graph import GraphRunContext, End


# =============================================================================
# Mock Providers
# =============================================================================

class MockDiscovery:
    """Mock discovery function for testing."""
    
    def __init__(self, apis_to_discover: List[List[str]]):
        """
        Args:
            apis_to_discover: List of API lists to return on each call.
        """
        self.apis_to_discover = apis_to_discover
        self.call_count = 0
    
    async def __call__(self, environment: str) -> List[str]:
        """Discover APIs."""
        if self.call_count < len(self.apis_to_discover):
            apis = self.apis_to_discover[self.call_count]
            self.call_count += 1
            return apis
        return []


class MockValidator:
    """Mock validation function for testing."""
    
    def __init__(
        self,
        fail_apis: Optional[List[str]] = None,
        fail_until_retry: int = 0,
    ):
        """
        Args:
            fail_apis: APIs that always fail validation.
            fail_until_retry: Fail until this many retries.
        """
        self.fail_apis = fail_apis or []
        self.fail_until_retry = fail_until_retry
        self.call_history: List[Dict[str, Any]] = []
    
    async def __call__(self, api: str, params: Dict[str, Any]) -> bool:
        """Validate an API."""
        self.call_history.append({"api": api, "params": params})
        
        retry = params.get("retry", 0)
        
        if api in self.fail_apis:
            raise ValueError(f"API {api} always fails")
        
        if retry < self.fail_until_retry:
            raise ValueError(f"API {api} fails until retry {self.fail_until_retry}")
        
        return True


class MockLLMProvider:
    """Mock LLM provider for testing."""
    
    def __init__(self, response: str = "Corrected parameters: auth_token=test"):
        self.response = response
        self.call_count = 0
    
    async def acomplete(self, prompt: str) -> str:
        self.call_count += 1
        return self.response


# =============================================================================
# Tests: MiningState
# =============================================================================

class TestMiningState:
    """Tests for MiningState dataclass."""
    
    def test_initial_state(self):
        """Test default state values."""
        state = MiningState()
        
        assert state.discovered_apis == []
        assert state.validated_tools == []
        assert state.pending_validation == []
        assert state.retry_count == 0
        assert state.max_retries == 3
    
    def test_state_with_values(self):
        """Test state with custom values."""
        state = MiningState(
            discovered_apis=["api_1", "api_2"],
            max_retries=5,
        )
        
        assert len(state.discovered_apis) == 2
        assert state.max_retries == 5


# =============================================================================
# Tests: ExploreNode
# =============================================================================

class TestExploreNode:
    """Tests for ExploreNode."""
    
    @pytest.mark.asyncio
    async def test_explore_discovers_apis(self):
        """Test ExploreNode discovers APIs."""
        discovery = MockDiscovery([["api_1", "api_2"]])
        deps = MiningDeps(
            discovery_fn=discovery,
            environment="test_env",
            exploration_budget=10,
        )
        state = MiningState()
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ExploreNode()
        result = await node.run(ctx)
        
        assert isinstance(result, ValidateNode)
        assert state.discovered_apis == ["api_1", "api_2"]
        assert state.pending_validation == ["api_1", "api_2"]
    
    @pytest.mark.asyncio
    async def test_explore_ends_when_no_apis(self):
        """Test ExploreNode ends when no APIs discovered."""
        discovery = MockDiscovery([[]])  # Returns empty list
        deps = MiningDeps(
            discovery_fn=discovery,
            environment="test_env",
        )
        state = MiningState()
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ExploreNode()
        result = await node.run(ctx)
        
        assert isinstance(result, End)
        assert result.result == []
    
    @pytest.mark.asyncio
    async def test_explore_respects_budget(self):
        """Test ExploreNode respects exploration budget."""
        deps = MiningDeps(
            exploration_budget=5,
        )
        state = MiningState(
            discovered_apis=["api_1", "api_2", "api_3", "api_4", "api_5"],
        )
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ExploreNode()
        result = await node.run(ctx)
        
        assert isinstance(result, End)  # Budget exhausted
    
    @pytest.mark.asyncio
    async def test_explore_mock_discovery(self):
        """Test ExploreNode with mock discovery (no discovery_fn)."""
        deps = MiningDeps(environment="test")
        state = MiningState()
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ExploreNode()
        result = await node.run(ctx)
        
        assert isinstance(result, ValidateNode)
        assert len(state.discovered_apis) == 1
        assert "api_1" in state.discovered_apis[0]


# =============================================================================
# Tests: ValidateNode
# =============================================================================

class TestValidateNode:
    """Tests for ValidateNode."""
    
    @pytest.mark.asyncio
    async def test_validate_success(self):
        """Test ValidateNode with successful validation."""
        validator = MockValidator()
        deps = MiningDeps(validate_fn=validator)
        state = MiningState(
            pending_validation=["api_1"],
            retry_count=1,  # Will succeed on retry
        )
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ValidateNode()
        result = await node.run(ctx)
        
        assert isinstance(result, ExploreNode)
        assert "api_1" in state.validated_tools
        assert len(state.pending_validation) == 0
    
    @pytest.mark.asyncio
    async def test_validate_failure_triggers_feedback(self):
        """Test ValidateNode triggers FeedbackNode on failure."""
        validator = MockValidator(fail_until_retry=1)
        deps = MiningDeps(validate_fn=validator)
        state = MiningState(
            pending_validation=["api_1"],
            retry_count=0,
        )
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ValidateNode()
        result = await node.run(ctx)
        
        assert isinstance(result, FeedbackNode)
        assert result.error is not None
    
    @pytest.mark.asyncio
    async def test_validate_max_retries_skip(self):
        """Test ValidateNode skips after max retries."""
        validator = MockValidator(fail_apis=["bad_api"])
        deps = MiningDeps(validate_fn=validator)
        state = MiningState(
            pending_validation=["bad_api"],
            retry_count=3,
            max_retries=3,
        )
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ValidateNode()
        result = await node.run(ctx)
        
        # Should skip to next (ExploreNode since no more pending)
        assert isinstance(result, ExploreNode)
        assert "bad_api" not in state.validated_tools
        assert len(state.pending_validation) == 0
    
    @pytest.mark.asyncio
    async def test_validate_no_pending(self):
        """Test ValidateNode with no pending validations."""
        deps = MiningDeps()
        state = MiningState(pending_validation=[])
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ValidateNode()
        result = await node.run(ctx)
        
        assert isinstance(result, ExploreNode)
    
    @pytest.mark.asyncio
    async def test_validate_mock_behavior(self):
        """Test ValidateNode with mock validation (no validate_fn)."""
        deps = MiningDeps()
        state = MiningState(
            pending_validation=["api_1"],
            retry_count=0,
        )
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = ValidateNode()
        result = await node.run(ctx)
        
        # First attempt fails with mock
        assert isinstance(result, FeedbackNode)


# =============================================================================
# Tests: FeedbackNode
# =============================================================================

class TestFeedbackNode:
    """Tests for FeedbackNode."""
    
    @pytest.mark.asyncio
    async def test_feedback_generates_message(self):
        """Test FeedbackNode generates feedback message."""
        deps = MiningDeps()
        state = MiningState(retry_count=0)
        ctx = GraphRunContext(state=state, deps=deps)
        
        error = {
            "api": "api_1",
            "error": "Missing required parameter 'auth_token'",
        }
        
        node = FeedbackNode(error=error)
        result = await node.run(ctx)
        
        assert isinstance(result, ValidateNode)
        assert state.current_feedback is not None
        assert "auth_token" in state.current_feedback or "api_1" in state.current_feedback
        assert state.retry_count == 1
    
    @pytest.mark.asyncio
    async def test_feedback_with_llm(self):
        """Test FeedbackNode calls LLM for correction."""
        llm = MockLLMProvider()
        deps = MiningDeps(llm_provider=llm)
        state = MiningState(retry_count=0)
        ctx = GraphRunContext(state=state, deps=deps)
        
        error = {"api": "api_1", "error": "Test error"}
        
        node = FeedbackNode(error=error)
        await node.run(ctx)
        
        assert llm.call_count == 1
        assert len(state.message_history) >= 1
    
    @pytest.mark.asyncio
    async def test_feedback_no_error(self):
        """Test FeedbackNode with no error."""
        deps = MiningDeps()
        state = MiningState()
        ctx = GraphRunContext(state=state, deps=deps)
        
        node = FeedbackNode(error=None)
        result = await node.run(ctx)
        
        assert isinstance(result, ValidateNode)


# =============================================================================
# Tests: Full Graph Execution
# =============================================================================

class TestMiningGraph:
    """Tests for complete mining graph execution."""
    
    @pytest.mark.asyncio
    async def test_full_loop_success(self):
        """Test complete explore-validate loop with success."""
        discovery = MockDiscovery([["api_1", "api_2"], []])  # Second call returns empty
        validator = MockValidator()  # All pass
        
        deps = MiningDeps(
            discovery_fn=discovery,
            validate_fn=validator,
            environment="test",
            exploration_budget=10,
        )
        
        graph = create_mining_graph()
        state = MiningState()
        
        result = await graph.run(
            initial_node=ExploreNode(),
            state=state,
            deps=deps,
        )
        
        assert len(result.result) == 2
        assert "api_1" in result.result
        assert "api_2" in result.result
    
    @pytest.mark.asyncio
    async def test_full_loop_with_retry(self):
        """Test graph with validation retry."""
        discovery = MockDiscovery([["api_1"], []])
        validator = MockValidator(fail_until_retry=1)  # Fail once, then pass
        
        deps = MiningDeps(
            discovery_fn=discovery,
            validate_fn=validator,
            environment="test",
        )
        
        graph = create_mining_graph()
        state = MiningState()
        
        result = await graph.run(
            initial_node=ExploreNode(),
            state=state,
            deps=deps,
        )
        
        assert "api_1" in result.result
        assert len(state.validation_errors) >= 1  # Had at least one error
    
    @pytest.mark.asyncio
    async def test_full_loop_mock_behavior(self):
        """Test graph with mock discovery and validation."""
        graph = create_mining_graph()
        deps = MiningDeps(environment="mock_env", exploration_budget=3)
        state = MiningState()
        
        result = await graph.run(
            initial_node=ExploreNode(),
            state=state,
            deps=deps,
        )
        
        # With mock, should discover and eventually validate
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_node_history_tracking(self):
        """Test that node history is properly tracked."""
        discovery = MockDiscovery([["api_1"], []])
        validator = MockValidator()
        
        deps = MiningDeps(
            discovery_fn=discovery,
            validate_fn=validator,
        )
        
        graph = create_mining_graph()
        state = MiningState()
        
        result = await graph.run(
            initial_node=ExploreNode(),
            state=state,
            deps=deps,
        )
        
        assert "ExploreNode" in result.node_history
        assert "ValidateNode" in result.node_history


# =============================================================================
# Tests: MiningGraphRunner
# =============================================================================

class TestMiningGraphRunner:
    """Tests for high-level MiningGraphRunner."""
    
    @pytest.mark.asyncio
    async def test_runner_basic(self):
        """Test basic runner usage."""
        runner = MiningGraphRunner(
            environment="test_env",
            exploration_budget=3,
        )
        
        result = await runner.run()
        
        assert isinstance(result, list)
    
    @pytest.mark.asyncio
    async def test_runner_with_custom_discovery(self):
        """Test runner with custom discovery function."""
        discovery = MockDiscovery([["custom_api"], []])
        
        runner = MiningGraphRunner(
            environment="test",
            discovery_fn=discovery,
        )
        
        result = await runner.run()
        
        # With mock validation, may or may not succeed
        assert isinstance(result, list)
    
    def test_runner_sync(self):
        """Test synchronous runner."""
        runner = MiningGraphRunner(
            environment="sync_test",
            exploration_budget=2,
        )
        
        result = runner.run_sync()
        
        assert isinstance(result, list)


# =============================================================================
# Integration Tests
# =============================================================================

class TestMiningGraphIntegration:
    """Integration tests for mining graph."""
    
    @pytest.mark.asyncio
    async def test_explore_validate_feedback_cycle(self):
        """Test complete explore-validate-feedback cycle."""
        # Discovery returns one API
        discovery = MockDiscovery([["complex_api"], []])
        
        # Validator fails twice, then succeeds
        validator = MockValidator(fail_until_retry=2)
        
        # LLM for corrections
        llm = MockLLMProvider()
        
        deps = MiningDeps(
            discovery_fn=discovery,
            validate_fn=validator,
            llm_provider=llm,
            environment="integration_test",
        )
        
        graph = create_mining_graph()
        state = MiningState(max_retries=3)
        
        result = await graph.run(
            initial_node=ExploreNode(),
            state=state,
            deps=deps,
        )
        
        # Should eventually succeed after retries
        assert "complex_api" in result.result
        
        # Should have gone through feedback loop
        assert state.current_feedback is not None
        
        # LLM should have been called for corrections
        assert llm.call_count >= 1
        
        # Should have validation errors recorded
        assert len(state.validation_errors) >= 1
    
    @pytest.mark.asyncio
    async def test_message_history_tracking(self):
        """Test that message history is properly tracked."""
        discovery = MockDiscovery([["api_1"], []])
        validator = MockValidator(fail_until_retry=1)
        llm = MockLLMProvider()
        
        deps = MiningDeps(
            discovery_fn=discovery,
            validate_fn=validator,
            llm_provider=llm,
        )
        
        graph = create_mining_graph()
        state = MiningState()
        
        await graph.run(
            initial_node=ExploreNode(),
            state=state,
            deps=deps,
        )
        
        # Should have messages for discovery, feedback, validation
        assert len(state.message_history) >= 2
        
        # Check message types
        roles = [m["role"] for m in state.message_history]
        assert "system" in roles


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

