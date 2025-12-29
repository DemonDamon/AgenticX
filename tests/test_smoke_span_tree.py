"""
Smoke tests for SpanTree and SpanEvaluator implementation.

Tests hierarchical span management and span-based evaluation.
"""

import pytest
from datetime import datetime, timezone
from typing import List, Dict, Any

from agenticx.observability.span_tree import SpanNode, SpanQuery, SpanTree
from agenticx.evaluation.span_evaluator import SpanEvaluator, SpanEvaluationResult


# =============================================================================
# Test Data Fixtures
# =============================================================================

def create_sample_spans() -> List[Dict[str, Any]]:
    """Create sample span data for testing."""
    return [
        {
            "name": "agent.run",
            "span_id": "span_1",
            "parent_id": None,
            "trace_id": "trace_1",
            "start_time": datetime(2024, 1, 1, 10, 0, 0, tzinfo=timezone.utc),
            "end_time": datetime(2024, 1, 1, 10, 0, 5, tzinfo=timezone.utc),
            "duration_ms": 5000,
            "status": "ok",
            "attributes": {"agent_name": "mining_agent"},
        },
        {
            "name": "tool.call.search",
            "span_id": "span_2",
            "parent_id": "span_1",
            "trace_id": "trace_1",
            "start_time": datetime(2024, 1, 1, 10, 0, 1, tzinfo=timezone.utc),
            "end_time": datetime(2024, 1, 1, 10, 0, 2, tzinfo=timezone.utc),
            "duration_ms": 1000,
            "status": "ok",
            "attributes": {"tool_name": "search_api", "result_count": 5},
        },
        {
            "name": "tool.call.validate",
            "span_id": "span_3",
            "parent_id": "span_1",
            "trace_id": "trace_1",
            "start_time": datetime(2024, 1, 1, 10, 0, 2, tzinfo=timezone.utc),
            "end_time": datetime(2024, 1, 1, 10, 0, 3, tzinfo=timezone.utc),
            "duration_ms": 1000,
            "status": "ok",
            "attributes": {"tool_name": "validator"},
        },
        {
            "name": "llm.request",
            "span_id": "span_4",
            "parent_id": "span_2",
            "trace_id": "trace_1",
            "start_time": datetime(2024, 1, 1, 10, 0, 1, 100000, tzinfo=timezone.utc),
            "end_time": datetime(2024, 1, 1, 10, 0, 1, 500000, tzinfo=timezone.utc),
            "duration_ms": 400,
            "status": "ok",
            "attributes": {"model": "gpt-4", "tokens_used": 150},
        },
    ]


def create_error_spans() -> List[Dict[str, Any]]:
    """Create spans with errors."""
    return [
        {
            "name": "agent.run",
            "span_id": "err_1",
            "parent_id": None,
            "status": "ok",
        },
        {
            "name": "tool.call.failed",
            "span_id": "err_2",
            "parent_id": "err_1",
            "status": "error",
            "attributes": {"error_message": "API timeout"},
        },
        {
            "name": "retry.attempt",
            "span_id": "err_3",
            "parent_id": "err_1",
            "status": "ok",
        },
    ]


# =============================================================================
# Tests: SpanNode
# =============================================================================

class TestSpanNode:
    """Tests for SpanNode dataclass."""
    
    def test_create_node(self):
        """Test basic node creation."""
        node = SpanNode(
            name="test.span",
            span_id="123",
        )
        
        assert node.name == "test.span"
        assert node.span_id == "123"
        assert node.parent_id is None
        assert node.status == "ok"
        assert node.children == []
    
    def test_node_with_attributes(self):
        """Test node with attributes."""
        node = SpanNode(
            name="test",
            span_id="1",
            attributes={"key": "value", "count": 10},
        )
        
        assert node.get_attribute("key") == "value"
        assert node.get_attribute("count") == 10
        assert node.get_attribute("missing") is None
        assert node.get_attribute("missing", "default") == "default"
    
    def test_has_attribute(self):
        """Test has_attribute method."""
        node = SpanNode(
            name="test",
            span_id="1",
            attributes={"key": "value"},
        )
        
        assert node.has_attribute("key") is True
        assert node.has_attribute("key", "value") is True
        assert node.has_attribute("key", "wrong") is False
        assert node.has_attribute("missing") is False
    
    def test_is_error(self):
        """Test error detection."""
        ok_node = SpanNode(name="ok", span_id="1", status="ok")
        error_node = SpanNode(name="error", span_id="2", status="error")
        failed_node = SpanNode(name="failed", span_id="3", status="failed")
        
        assert ok_node.is_error() is False
        assert error_node.is_error() is True
        assert failed_node.is_error() is True
    
    def test_add_child(self):
        """Test adding child nodes."""
        parent = SpanNode(name="parent", span_id="1")
        child1 = SpanNode(name="child1", span_id="2", parent_id="1")
        child2 = SpanNode(name="child2", span_id="3", parent_id="1")
        
        parent.add_child(child1)
        parent.add_child(child2)
        
        assert len(parent.children) == 2
        assert parent.children[0].name == "child1"
        assert parent.children[1].name == "child2"
    
    def test_to_dict(self):
        """Test conversion to dictionary."""
        node = SpanNode(
            name="test",
            span_id="1",
            attributes={"key": "value"},
        )
        
        data = node.to_dict()
        
        assert data["name"] == "test"
        assert data["span_id"] == "1"
        assert data["attributes"]["key"] == "value"
        assert data["children"] == []
    
    def test_from_dict(self):
        """Test creation from dictionary."""
        data = {
            "name": "test",
            "span_id": "1",
            "attributes": {"key": "value"},
            "children": [
                {"name": "child", "span_id": "2", "children": []},
            ],
        }
        
        node = SpanNode.from_dict(data)
        
        assert node.name == "test"
        assert len(node.children) == 1
        assert node.children[0].name == "child"
    
    def test_repr(self):
        """Test string representation."""
        node = SpanNode(name="test", span_id="123")
        
        repr_str = repr(node)
        
        assert "test" in repr_str
        assert "123" in repr_str


# =============================================================================
# Tests: SpanQuery
# =============================================================================

class TestSpanQuery:
    """Tests for SpanQuery."""
    
    def test_name_match(self):
        """Test exact name matching."""
        query = SpanQuery(name="test.span")
        node = SpanNode(name="test.span", span_id="1")
        
        assert query.matches(node) is True
        
        node2 = SpanNode(name="other", span_id="2")
        assert query.matches(node2) is False
    
    def test_name_contains(self):
        """Test name substring matching."""
        query = SpanQuery(name_contains="tool")
        
        assert query.matches(SpanNode(name="tool.call", span_id="1")) is True
        assert query.matches(SpanNode(name="my_tool_v2", span_id="2")) is True
        assert query.matches(SpanNode(name="agent.run", span_id="3")) is False
    
    def test_name_pattern(self):
        """Test regex pattern matching."""
        query = SpanQuery(name_pattern=r"tool\.call\.\w+")
        
        assert query.matches(SpanNode(name="tool.call.search", span_id="1")) is True
        assert query.matches(SpanNode(name="tool.call.validate", span_id="2")) is True
        assert query.matches(SpanNode(name="tool.call", span_id="3")) is False
    
    def test_attribute_match(self):
        """Test attribute matching."""
        query = SpanQuery(attribute="tool_name", attribute_value="search")
        
        node1 = SpanNode(name="t", span_id="1", attributes={"tool_name": "search"})
        node2 = SpanNode(name="t", span_id="2", attributes={"tool_name": "other"})
        node3 = SpanNode(name="t", span_id="3", attributes={})
        
        assert query.matches(node1) is True
        assert query.matches(node2) is False
        assert query.matches(node3) is False
    
    def test_status_match(self):
        """Test status matching."""
        query = SpanQuery(status="error")
        
        assert query.matches(SpanNode(name="t", span_id="1", status="error")) is True
        assert query.matches(SpanNode(name="t", span_id="2", status="ok")) is False
    
    def test_has_children(self):
        """Test has_children matching."""
        parent = SpanNode(name="parent", span_id="1")
        parent.add_child(SpanNode(name="child", span_id="2"))
        
        leaf = SpanNode(name="leaf", span_id="3")
        
        query_with = SpanQuery(has_children=True)
        query_without = SpanQuery(has_children=False)
        
        assert query_with.matches(parent) is True
        assert query_with.matches(leaf) is False
        assert query_without.matches(parent) is False
        assert query_without.matches(leaf) is True
    
    def test_is_root(self):
        """Test is_root matching."""
        root = SpanNode(name="root", span_id="1", parent_id=None)
        child = SpanNode(name="child", span_id="2", parent_id="1")
        
        query_root = SpanQuery(is_root=True)
        query_child = SpanQuery(is_root=False)
        
        assert query_root.matches(root) is True
        assert query_root.matches(child) is False
        assert query_child.matches(root) is False
        assert query_child.matches(child) is True
    
    def test_custom_predicate(self):
        """Test custom predicate matching."""
        query = SpanQuery(
            custom_predicate=lambda s: s.duration_ms is not None and s.duration_ms > 500
        )
        
        fast = SpanNode(name="fast", span_id="1", duration_ms=100)
        slow = SpanNode(name="slow", span_id="2", duration_ms=1000)
        
        assert query.matches(fast) is False
        assert query.matches(slow) is True
    
    def test_combined_query(self):
        """Test query with multiple conditions."""
        query = SpanQuery(
            name_contains="tool",
            status="ok",
            has_children=False,
        )
        
        match = SpanNode(name="tool.call", span_id="1", status="ok")
        no_match_name = SpanNode(name="agent.run", span_id="2", status="ok")
        no_match_status = SpanNode(name="tool.call", span_id="3", status="error")
        
        parent = SpanNode(name="tool.parent", span_id="4", status="ok")
        parent.add_child(SpanNode(name="child", span_id="5"))
        
        assert query.matches(match) is True
        assert query.matches(no_match_name) is False
        assert query.matches(no_match_status) is False
        assert query.matches(parent) is False


# =============================================================================
# Tests: SpanTree
# =============================================================================

class TestSpanTree:
    """Tests for SpanTree."""
    
    def test_empty_tree(self):
        """Test empty tree."""
        tree = SpanTree()
        
        assert tree.get_span_count() == 0
        assert tree.get_depth() == 0
        assert tree.roots == []
    
    def test_from_spans(self):
        """Test building tree from spans."""
        spans = create_sample_spans()
        tree = SpanTree.from_spans(spans)
        
        assert tree.get_span_count() == 4
        assert len(tree.roots) == 1
        assert tree.roots[0].name == "agent.run"
    
    def test_tree_structure(self):
        """Test tree has correct parent-child structure."""
        spans = create_sample_spans()
        tree = SpanTree.from_spans(spans)
        
        root = tree.roots[0]
        assert len(root.children) == 2  # search and validate
        
        search_span = next(c for c in root.children if "search" in c.name)
        assert len(search_span.children) == 1  # llm.request
    
    def test_find_span_by_name(self):
        """Test finding span by name."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        span = tree.find_span("agent.run")
        
        assert span is not None
        assert span.name == "agent.run"
    
    def test_find_spans_by_name(self):
        """Test finding multiple spans by name."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        tool_spans = tree.find_spans_by_name_contains("tool")
        
        assert len(tool_spans) == 2
    
    def test_find_spans_by_attribute(self):
        """Test finding spans by attribute."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        spans = tree.find_spans_by_attribute("tool_name", "search_api")
        
        assert len(spans) == 1
        assert spans[0].get_attribute("tool_name") == "search_api"
    
    def test_find_error_spans(self):
        """Test finding error spans."""
        tree = SpanTree.from_spans(create_error_spans())
        
        errors = tree.find_error_spans()
        
        assert len(errors) == 1
        assert errors[0].name == "tool.call.failed"
    
    def test_get_span_by_id(self):
        """Test getting span by ID."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        span = tree.get_span_by_id("span_2")
        
        assert span is not None
        assert span.name == "tool.call.search"
    
    def test_get_depth(self):
        """Test tree depth calculation."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        depth = tree.get_depth()
        
        assert depth == 3  # agent.run -> tool.call.search -> llm.request
    
    def test_get_summary(self):
        """Test tree summary."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        summary = tree.get_summary()
        
        assert summary["total_spans"] == 4
        assert summary["root_spans"] == 1
        assert summary["max_depth"] == 3
        assert "agent.run" in summary["spans_by_name"]
    
    def test_to_dict_and_back(self):
        """Test serialization round-trip."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        data = tree.to_dict()
        restored = SpanTree.from_dict(data)
        
        assert restored.get_span_count() == tree.get_span_count()
        assert restored.get_depth() == tree.get_depth()
    
    def test_to_mermaid(self):
        """Test Mermaid diagram generation."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        mermaid = tree.to_mermaid()
        
        assert "graph TD" in mermaid
        assert "agent.run" in mermaid
    
    def test_find_with_limit(self):
        """Test find with result limit."""
        tree = SpanTree.from_spans(create_sample_spans())
        
        spans = tree.find_spans(SpanQuery(), limit=2)
        
        assert len(spans) == 2
    
    def test_multiple_roots(self):
        """Test tree with multiple roots."""
        spans = [
            {"name": "root1", "span_id": "1", "parent_id": None},
            {"name": "root2", "span_id": "2", "parent_id": None},
            {"name": "child1", "span_id": "3", "parent_id": "1"},
        ]
        
        tree = SpanTree.from_spans(spans)
        
        assert len(tree.roots) == 2
        assert tree.get_span_count() == 3


# =============================================================================
# Tests: SpanEvaluator
# =============================================================================

class TestSpanEvaluator:
    """Tests for SpanEvaluator."""
    
    @pytest.fixture
    def evaluator(self):
        return SpanEvaluator(log_evaluations=False)
    
    @pytest.fixture
    def sample_tree(self):
        return SpanTree.from_spans(create_sample_spans())
    
    @pytest.fixture
    def error_tree(self):
        return SpanTree.from_spans(create_error_spans())
    
    def test_evaluate_has_span_pass(self, evaluator, sample_tree):
        """Test has_span evaluation passing."""
        result = evaluator.evaluate_has_span(sample_tree, "agent.run")
        
        assert result.passed is True
        assert len(result.matched_spans) == 1
    
    def test_evaluate_has_span_fail(self, evaluator, sample_tree):
        """Test has_span evaluation failing."""
        result = evaluator.evaluate_has_span(sample_tree, "nonexistent")
        
        assert result.passed is False
        assert len(result.matched_spans) == 0
    
    def test_evaluate_has_span_count(self, evaluator, sample_tree):
        """Test has_span with count requirements."""
        # Tool spans should be 2
        result = evaluator.evaluate_has_span(
            sample_tree,
            SpanQuery(name_contains="tool"),
            min_count=2,
            max_count=2,
        )
        
        assert result.passed is True
        
        # Require 3 - should fail
        result2 = evaluator.evaluate_has_span(
            sample_tree,
            SpanQuery(name_contains="tool"),
            min_count=3,
        )
        
        assert result2.passed is False
    
    def test_evaluate_tool_was_called(self, evaluator, sample_tree):
        """Test tool_was_called evaluation."""
        result = evaluator.evaluate_tool_was_called(sample_tree, "search_api")
        
        assert result.passed is True
    
    def test_evaluate_tool_was_called_not_found(self, evaluator, sample_tree):
        """Test tool_was_called when not found."""
        result = evaluator.evaluate_tool_was_called(sample_tree, "unknown_tool")
        
        assert result.passed is False
    
    def test_evaluate_no_errors_pass(self, evaluator, sample_tree):
        """Test no_errors evaluation passing."""
        result = evaluator.evaluate_no_errors(sample_tree)
        
        assert result.passed is True
    
    def test_evaluate_no_errors_fail(self, evaluator, error_tree):
        """Test no_errors evaluation failing."""
        result = evaluator.evaluate_no_errors(error_tree)
        
        assert result.passed is False
        assert len(result.matched_spans) == 1
    
    def test_evaluate_execution_order_pass(self, evaluator, sample_tree):
        """Test execution order evaluation passing."""
        result = evaluator.evaluate_execution_order(
            sample_tree,
            expected_order=["agent.run", "tool.call.search"],
        )
        
        assert result.passed is True
    
    def test_evaluate_execution_order_fail(self, evaluator, sample_tree):
        """Test execution order evaluation failing."""
        result = evaluator.evaluate_execution_order(
            sample_tree,
            expected_order=["tool.call.validate", "agent.run"],  # Wrong order
        )
        
        assert result.passed is False
    
    def test_evaluate_attribute_value_pass(self, evaluator, sample_tree):
        """Test attribute value evaluation passing."""
        result = evaluator.evaluate_attribute_value(
            sample_tree,
            span_name="tool.call.search",
            attribute_key="result_count",
            expected_value=5,
        )
        
        assert result.passed is True
    
    def test_evaluate_attribute_value_fail(self, evaluator, sample_tree):
        """Test attribute value evaluation failing."""
        result = evaluator.evaluate_attribute_value(
            sample_tree,
            span_name="tool.call.search",
            attribute_key="result_count",
            expected_value=10,  # Wrong value
        )
        
        assert result.passed is False
    
    def test_evaluate_duration_within_pass(self, evaluator, sample_tree):
        """Test duration evaluation passing."""
        result = evaluator.evaluate_duration_within(
            sample_tree,
            span_name="llm.request",
            max_duration_ms=1000,
        )
        
        assert result.passed is True
    
    def test_evaluate_duration_within_fail(self, evaluator, sample_tree):
        """Test duration evaluation failing."""
        result = evaluator.evaluate_duration_within(
            sample_tree,
            span_name="agent.run",
            max_duration_ms=1000,  # agent.run is 5000ms
        )
        
        assert result.passed is False
    
    def test_evaluate_all_pass(self, evaluator, sample_tree):
        """Test evaluate_all with all passing checks."""
        checks = [
            {"type": "has_span", "query": "agent.run"},
            {"type": "tool_called", "tool_name": "search_api"},
            {"type": "no_errors"},
        ]
        
        result = evaluator.evaluate_all(sample_tree, checks)
        
        assert result.passed is True
        assert result.metadata["checks_passed"] == 3
    
    def test_evaluate_all_fail(self, evaluator, error_tree):
        """Test evaluate_all with failing check."""
        checks = [
            {"type": "has_span", "query": "agent.run"},
            {"type": "no_errors"},  # Should fail
        ]
        
        result = evaluator.evaluate_all(error_tree, checks)
        
        assert result.passed is False
        assert result.metadata["checks_passed"] == 1
    
    def test_strict_mode(self, sample_tree):
        """Test strict mode behavior."""
        strict_evaluator = SpanEvaluator(strict_mode=True, log_evaluations=False)
        
        # Missing span in strict mode should fail
        result = strict_evaluator.evaluate_attribute_value(
            sample_tree,
            span_name="nonexistent",
            attribute_key="any",
            expected_value="any",
        )
        
        assert result.passed is False
        assert "not found" in result.reason


# =============================================================================
# Tests: SpanEvaluationResult
# =============================================================================

class TestSpanEvaluationResult:
    """Tests for SpanEvaluationResult."""
    
    def test_to_dict(self):
        """Test result serialization."""
        result = SpanEvaluationResult(
            passed=True,
            reason="Test passed",
            matched_spans=[SpanNode(name="test", span_id="1")],
            total_spans_checked=5,
            metadata={"key": "value"},
        )
        
        data = result.to_dict()
        
        assert data["passed"] is True
        assert data["reason"] == "Test passed"
        assert data["matched_spans_count"] == 1
        assert data["total_spans_checked"] == 5


# =============================================================================
# Integration Tests
# =============================================================================

class TestIntegration:
    """Integration tests combining SpanTree and SpanEvaluator."""
    
    def test_full_evaluation_workflow(self):
        """Test complete evaluation workflow."""
        # Build tree from execution spans
        spans = [
            {"name": "mining.start", "span_id": "1", "parent_id": None, "status": "ok",
             "start_time": datetime(2024, 1, 1, 0, 0, 0), "duration_ms": 100},
            {"name": "discover.api", "span_id": "2", "parent_id": "1", "status": "ok",
             "attributes": {"apis_found": 3}, "start_time": datetime(2024, 1, 1, 0, 0, 1)},
            {"name": "validate.tool", "span_id": "3", "parent_id": "1", "status": "ok",
             "attributes": {"tool_name": "search"}, "start_time": datetime(2024, 1, 1, 0, 0, 2)},
            {"name": "mining.complete", "span_id": "4", "parent_id": "1", "status": "ok",
             "start_time": datetime(2024, 1, 1, 0, 0, 3)},
        ]
        
        tree = SpanTree.from_spans(spans)
        evaluator = SpanEvaluator(log_evaluations=False)
        
        # Run comprehensive checks
        result = evaluator.evaluate_all(tree, [
            {"type": "has_span", "query": "mining.start"},
            {"type": "has_span", "query": "mining.complete"},
            {"type": "tool_called", "tool_name": "search"},
            {"type": "no_errors"},
            {"type": "execution_order", "expected_order": ["mining.start", "mining.complete"]},
            {"type": "attribute_value", "span_name": "discover.api", 
             "attribute_key": "apis_found", "expected_value": 3},
        ])
        
        assert result.passed is True
        assert result.metadata["checks_passed"] == 6
    
    def test_error_detection_workflow(self):
        """Test error detection in evaluation."""
        spans = [
            {"name": "agent.run", "span_id": "1", "parent_id": None, "status": "ok"},
            {"name": "tool.call", "span_id": "2", "parent_id": "1", "status": "error",
             "attributes": {"error_type": "ValidationError"}},
            {"name": "retry", "span_id": "3", "parent_id": "1", "status": "ok"},
            {"name": "tool.call", "span_id": "4", "parent_id": "1", "status": "ok"},
        ]
        
        tree = SpanTree.from_spans(spans)
        evaluator = SpanEvaluator(log_evaluations=False)
        
        # Check for errors
        error_result = evaluator.evaluate_no_errors(tree)
        assert error_result.passed is False
        
        # Check that retry happened
        retry_result = evaluator.evaluate_has_span(tree, "retry")
        assert retry_result.passed is True
        
        # Check eventual success
        success_spans = tree.find_spans(SpanQuery(name="tool.call", status="ok"))
        assert len(success_spans) == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

