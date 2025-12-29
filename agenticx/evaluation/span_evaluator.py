"""
SpanEvaluator - Span-based Evaluation for Agent Execution

Evaluates agent execution by inspecting span trees. Enables checking
intermediate states, tool calls, and execution patterns.

Inspired by pydantic-evals HasMatchingSpan evaluator.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union

from agenticx.observability.span_tree import SpanNode, SpanQuery, SpanTree

logger = logging.getLogger(__name__)


@dataclass
class SpanEvaluationResult:
    """
    Result of a span-based evaluation.
    
    Attributes:
        passed: Whether the evaluation passed.
        reason: Explanation for the result.
        matched_spans: Spans that matched the query.
        total_spans_checked: Total number of spans examined.
        metadata: Additional evaluation metadata.
    """
    passed: bool
    reason: str
    matched_spans: List[SpanNode] = field(default_factory=list)
    total_spans_checked: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "passed": self.passed,
            "reason": self.reason,
            "matched_spans_count": len(self.matched_spans),
            "matched_span_names": [s.name for s in self.matched_spans],
            "total_spans_checked": self.total_spans_checked,
            "metadata": self.metadata,
        }


class SpanEvaluator:
    """
    Evaluator that checks span trees for specific patterns.
    
    Enables fine-grained evaluation of agent execution by inspecting
    intermediate states captured in spans.
    
    Example:
        >>> evaluator = SpanEvaluator()
        >>> tree = SpanTree.from_spans([...])
        >>> result = evaluator.evaluate_tool_was_called(tree, "search_api")
        >>> print(result.passed)
    """
    
    def __init__(
        self,
        strict_mode: bool = False,
        log_evaluations: bool = True,
    ):
        """
        Initialize the evaluator.
        
        Args:
            strict_mode: If True, missing spans are failures.
            log_evaluations: Whether to log evaluation results.
        """
        self.strict_mode = strict_mode
        self.log_evaluations = log_evaluations
    
    def evaluate_has_span(
        self,
        span_tree: SpanTree,
        query: Union[str, SpanQuery],
        min_count: int = 1,
        max_count: Optional[int] = None,
    ) -> SpanEvaluationResult:
        """
        Evaluate if span tree contains spans matching the query.
        
        Args:
            span_tree: The span tree to evaluate.
            query: Span name or SpanQuery.
            min_count: Minimum number of matching spans required.
            max_count: Maximum number of matching spans allowed.
            
        Returns:
            SpanEvaluationResult with evaluation outcome.
        """
        matches = span_tree.find_spans(query)
        total = span_tree.get_span_count()
        
        passed = len(matches) >= min_count
        if max_count is not None:
            passed = passed and len(matches) <= max_count
        
        if passed:
            reason = f"Found {len(matches)} matching span(s)"
        else:
            if len(matches) < min_count:
                reason = f"Found {len(matches)} spans, required at least {min_count}"
            else:
                reason = f"Found {len(matches)} spans, max allowed is {max_count}"
        
        result = SpanEvaluationResult(
            passed=passed,
            reason=reason,
            matched_spans=matches,
            total_spans_checked=total,
            metadata={"query": str(query), "min_count": min_count, "max_count": max_count},
        )
        
        if self.log_evaluations:
            logger.debug(f"[SpanEvaluator] has_span: {result.passed} - {result.reason}")
        
        return result
    
    def evaluate_tool_was_called(
        self,
        span_tree: SpanTree,
        tool_name: str,
        expected_count: Optional[int] = None,
    ) -> SpanEvaluationResult:
        """
        Evaluate if a specific tool was called.
        
        Args:
            span_tree: The span tree to evaluate.
            tool_name: Name of the tool to check.
            expected_count: Expected number of calls (None = at least 1).
            
        Returns:
            SpanEvaluationResult.
        """
        # Look for spans with tool name in name or attributes
        query = SpanQuery(
            custom_predicate=lambda s: (
                tool_name in s.name or
                s.get_attribute("tool_name") == tool_name or
                s.get_attribute("tool.name") == tool_name
            )
        )
        
        if expected_count is not None:
            return self.evaluate_has_span(
                span_tree, query,
                min_count=expected_count,
                max_count=expected_count,
            )
        else:
            return self.evaluate_has_span(span_tree, query, min_count=1)
    
    def evaluate_no_errors(self, span_tree: SpanTree) -> SpanEvaluationResult:
        """
        Evaluate that no error spans exist.
        
        Args:
            span_tree: The span tree to evaluate.
            
        Returns:
            SpanEvaluationResult.
        """
        error_spans = span_tree.find_error_spans()
        passed = len(error_spans) == 0
        
        if passed:
            reason = "No error spans found"
        else:
            error_names = [s.name for s in error_spans[:3]]
            reason = f"Found {len(error_spans)} error span(s): {error_names}"
        
        result = SpanEvaluationResult(
            passed=passed,
            reason=reason,
            matched_spans=error_spans,
            total_spans_checked=span_tree.get_span_count(),
        )
        
        if self.log_evaluations:
            logger.debug(f"[SpanEvaluator] no_errors: {result.passed} - {result.reason}")
        
        return result
    
    def evaluate_execution_order(
        self,
        span_tree: SpanTree,
        expected_order: List[str],
        strict: bool = False,
    ) -> SpanEvaluationResult:
        """
        Evaluate if spans appear in the expected order.
        
        Args:
            span_tree: The span tree to evaluate.
            expected_order: List of span names in expected order.
            strict: If True, no other spans allowed between.
            
        Returns:
            SpanEvaluationResult.
        """
        if not expected_order:
            return SpanEvaluationResult(
                passed=True,
                reason="Empty order check",
            )
        
        # Get all spans ordered by start time
        all_spans = span_tree.get_all_spans()
        all_spans_sorted = sorted(
            all_spans,
            key=lambda s: s.start_time or 0
        )
        
        span_names = [s.name for s in all_spans_sorted]
        
        if strict:
            # Extract only the expected span names
            filtered = [n for n in span_names if n in expected_order]
            passed = filtered == expected_order
        else:
            # Check if expected order is a subsequence
            expected_idx = 0
            for name in span_names:
                if expected_idx < len(expected_order) and name == expected_order[expected_idx]:
                    expected_idx += 1
            passed = expected_idx == len(expected_order)
        
        if passed:
            reason = f"Execution order matches: {expected_order}"
        else:
            reason = f"Order mismatch. Expected: {expected_order}, Found: {span_names[:len(expected_order)+2]}"
        
        return SpanEvaluationResult(
            passed=passed,
            reason=reason,
            total_spans_checked=len(all_spans),
            metadata={"expected_order": expected_order, "strict": strict},
        )
    
    def evaluate_attribute_value(
        self,
        span_tree: SpanTree,
        span_name: str,
        attribute_key: str,
        expected_value: Any,
    ) -> SpanEvaluationResult:
        """
        Evaluate if a span has a specific attribute value.
        
        Args:
            span_tree: The span tree to evaluate.
            span_name: Name of the span to check.
            attribute_key: Attribute key.
            expected_value: Expected attribute value.
            
        Returns:
            SpanEvaluationResult.
        """
        span = span_tree.find_span(span_name)
        
        if span is None:
            if self.strict_mode:
                return SpanEvaluationResult(
                    passed=False,
                    reason=f"Span '{span_name}' not found",
                )
            else:
                return SpanEvaluationResult(
                    passed=True,
                    reason=f"Span '{span_name}' not found (non-strict mode)",
                    metadata={"skipped": True},
                )
        
        actual_value = span.get_attribute(attribute_key)
        passed = actual_value == expected_value
        
        if passed:
            reason = f"Attribute '{attribute_key}' matches: {expected_value}"
        else:
            reason = f"Attribute mismatch: expected {expected_value}, got {actual_value}"
        
        return SpanEvaluationResult(
            passed=passed,
            reason=reason,
            matched_spans=[span],
            metadata={
                "span_name": span_name,
                "attribute_key": attribute_key,
                "expected_value": expected_value,
                "actual_value": actual_value,
            },
        )
    
    def evaluate_duration_within(
        self,
        span_tree: SpanTree,
        span_name: str,
        max_duration_ms: float,
    ) -> SpanEvaluationResult:
        """
        Evaluate if a span completed within the time limit.
        
        Args:
            span_tree: The span tree to evaluate.
            span_name: Name of the span to check.
            max_duration_ms: Maximum allowed duration in milliseconds.
            
        Returns:
            SpanEvaluationResult.
        """
        span = span_tree.find_span(span_name)
        
        if span is None:
            if self.strict_mode:
                return SpanEvaluationResult(
                    passed=False,
                    reason=f"Span '{span_name}' not found",
                )
            else:
                return SpanEvaluationResult(
                    passed=True,
                    reason=f"Span '{span_name}' not found (non-strict mode)",
                    metadata={"skipped": True},
                )
        
        if span.duration_ms is None:
            return SpanEvaluationResult(
                passed=False,
                reason=f"Span '{span_name}' has no duration",
            )
        
        passed = span.duration_ms <= max_duration_ms
        
        if passed:
            reason = f"Duration {span.duration_ms}ms <= {max_duration_ms}ms limit"
        else:
            reason = f"Duration {span.duration_ms}ms exceeds {max_duration_ms}ms limit"
        
        return SpanEvaluationResult(
            passed=passed,
            reason=reason,
            matched_spans=[span],
            metadata={
                "span_name": span_name,
                "actual_duration_ms": span.duration_ms,
                "max_duration_ms": max_duration_ms,
            },
        )
    
    def evaluate_all(
        self,
        span_tree: SpanTree,
        checks: List[Dict[str, Any]],
    ) -> SpanEvaluationResult:
        """
        Run multiple evaluations and aggregate results.
        
        Args:
            span_tree: The span tree to evaluate.
            checks: List of check configurations, each with:
                - type: Evaluation type (has_span, tool_called, no_errors, etc.)
                - ... type-specific parameters
            
        Returns:
            Aggregated SpanEvaluationResult (passes only if all pass).
            
        Example:
            >>> result = evaluator.evaluate_all(tree, [
            ...     {"type": "tool_called", "tool_name": "search"},
            ...     {"type": "no_errors"},
            ... ])
        """
        results: List[SpanEvaluationResult] = []
        
        for check in checks:
            check_type = check.get("type", "")
            
            if check_type == "has_span":
                result = self.evaluate_has_span(
                    span_tree,
                    query=check.get("query", ""),
                    min_count=check.get("min_count", 1),
                    max_count=check.get("max_count"),
                )
            elif check_type == "tool_called":
                result = self.evaluate_tool_was_called(
                    span_tree,
                    tool_name=check.get("tool_name", ""),
                    expected_count=check.get("expected_count"),
                )
            elif check_type == "no_errors":
                result = self.evaluate_no_errors(span_tree)
            elif check_type == "execution_order":
                result = self.evaluate_execution_order(
                    span_tree,
                    expected_order=check.get("expected_order", []),
                    strict=check.get("strict", False),
                )
            elif check_type == "attribute_value":
                result = self.evaluate_attribute_value(
                    span_tree,
                    span_name=check.get("span_name", ""),
                    attribute_key=check.get("attribute_key", ""),
                    expected_value=check.get("expected_value"),
                )
            elif check_type == "duration_within":
                result = self.evaluate_duration_within(
                    span_tree,
                    span_name=check.get("span_name", ""),
                    max_duration_ms=check.get("max_duration_ms", 1000),
                )
            else:
                result = SpanEvaluationResult(
                    passed=False,
                    reason=f"Unknown check type: {check_type}",
                )
            
            results.append(result)
        
        # Aggregate
        all_passed = all(r.passed for r in results)
        reasons = [f"[{i+1}] {r.reason}" for i, r in enumerate(results)]
        
        return SpanEvaluationResult(
            passed=all_passed,
            reason="; ".join(reasons),
            total_spans_checked=span_tree.get_span_count(),
            metadata={
                "checks_run": len(checks),
                "checks_passed": sum(r.passed for r in results),
                "individual_results": [r.to_dict() for r in results],
            },
        )


__all__ = [
    'SpanEvaluationResult',
    'SpanEvaluator',
]

