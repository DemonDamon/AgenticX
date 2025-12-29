"""
SpanTree - Hierarchical Span Management for Evaluation

Organizes OpenTelemetry spans into a tree structure for fine-grained
evaluation of agent execution. Inspired by pydantic-evals SpanTree.

Key Features:
- Build tree from flat span list
- Query spans by name, attributes, or custom predicates
- Support intermediate state inspection during evaluation
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class SpanNode:
    """
    A node in the span tree representing a single span.
    
    Attributes:
        name: The span name (operation name).
        span_id: Unique identifier for this span.
        parent_id: ID of the parent span (None for root).
        trace_id: Trace ID this span belongs to.
        start_time: When the span started.
        end_time: When the span ended.
        duration_ms: Duration in milliseconds.
        status: Span status (ok, error, etc.).
        attributes: Span attributes (key-value pairs).
        events: Span events.
        children: Child span nodes.
    """
    name: str
    span_id: str
    parent_id: Optional[str] = None
    trace_id: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_ms: Optional[float] = None
    status: str = "ok"
    attributes: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict[str, Any]] = field(default_factory=list)
    children: List['SpanNode'] = field(default_factory=list)
    
    def add_child(self, child: 'SpanNode') -> None:
        """Add a child span node."""
        self.children.append(child)
    
    def get_attribute(self, key: str, default: Any = None) -> Any:
        """Get an attribute value."""
        return self.attributes.get(key, default)
    
    def has_attribute(self, key: str, value: Any = None) -> bool:
        """Check if span has an attribute (optionally with specific value)."""
        if key not in self.attributes:
            return False
        if value is None:
            return True
        return self.attributes[key] == value
    
    def is_error(self) -> bool:
        """Check if span represents an error."""
        return self.status.lower() in ("error", "failed")
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "span_id": self.span_id,
            "parent_id": self.parent_id,
            "trace_id": self.trace_id,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "attributes": self.attributes,
            "events": self.events,
            "children": [c.to_dict() for c in self.children],
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SpanNode':
        """Create from dictionary."""
        children_data = data.pop("children", [])
        
        # Parse datetime strings
        if data.get("start_time") and isinstance(data["start_time"], str):
            data["start_time"] = datetime.fromisoformat(data["start_time"])
        if data.get("end_time") and isinstance(data["end_time"], str):
            data["end_time"] = datetime.fromisoformat(data["end_time"])
        
        node = cls(**data)
        for child_data in children_data:
            node.add_child(cls.from_dict(child_data))
        
        return node
    
    def __repr__(self) -> str:
        return f"SpanNode(name={self.name!r}, span_id={self.span_id!r}, children={len(self.children)})"


@dataclass
class SpanQuery:
    """
    Query specification for finding spans.
    
    Attributes:
        name: Exact name match.
        name_contains: Name contains substring.
        name_pattern: Regex pattern for name.
        attribute: Attribute key to check.
        attribute_value: Expected attribute value.
        status: Expected status.
        has_children: Whether span should have children.
        is_root: Whether span should be a root.
        custom_predicate: Custom filter function.
    """
    name: Optional[str] = None
    name_contains: Optional[str] = None
    name_pattern: Optional[str] = None
    attribute: Optional[str] = None
    attribute_value: Optional[Any] = None
    status: Optional[str] = None
    has_children: Optional[bool] = None
    is_root: Optional[bool] = None
    custom_predicate: Optional[Callable[[SpanNode], bool]] = None
    
    def matches(self, node: SpanNode) -> bool:
        """Check if a node matches this query."""
        # Name exact match
        if self.name is not None and node.name != self.name:
            return False
        
        # Name contains
        if self.name_contains is not None and self.name_contains not in node.name:
            return False
        
        # Name pattern (regex)
        if self.name_pattern is not None:
            import re
            if not re.search(self.name_pattern, node.name):
                return False
        
        # Attribute check
        if self.attribute is not None:
            if not node.has_attribute(self.attribute, self.attribute_value):
                return False
        
        # Status check
        if self.status is not None and node.status != self.status:
            return False
        
        # Has children check
        if self.has_children is not None:
            if self.has_children and not node.children:
                return False
            if not self.has_children and node.children:
                return False
        
        # Is root check
        if self.is_root is not None:
            is_root = node.parent_id is None
            if self.is_root != is_root:
                return False
        
        # Custom predicate
        if self.custom_predicate is not None:
            if not self.custom_predicate(node):
                return False
        
        return True


class SpanTree:
    """
    Hierarchical container for spans.
    
    Builds a tree structure from a flat list of spans and provides
    query methods for finding specific spans.
    
    Example:
        >>> tree = SpanTree.from_spans([
        ...     {"name": "agent.run", "span_id": "1", "parent_id": None},
        ...     {"name": "tool.call", "span_id": "2", "parent_id": "1"},
        ... ])
        >>> tool_spans = tree.find_spans_by_name("tool.call")
        >>> print(len(tool_spans))  # 1
    """
    
    def __init__(self, roots: Optional[List[SpanNode]] = None):
        """
        Initialize span tree.
        
        Args:
            roots: Root span nodes.
        """
        self.roots: List[SpanNode] = roots or []
        self._all_spans: Dict[str, SpanNode] = {}
        
        # Index all spans
        for root in self.roots:
            self._index_span(root)
    
    def _index_span(self, node: SpanNode) -> None:
        """Index a span and its children."""
        self._all_spans[node.span_id] = node
        for child in node.children:
            self._index_span(child)
    
    @classmethod
    def from_spans(cls, spans: List[Dict[str, Any]]) -> 'SpanTree':
        """
        Build a tree from a flat list of span dictionaries.
        
        Args:
            spans: List of span dictionaries with span_id and parent_id.
            
        Returns:
            SpanTree with properly linked nodes.
        """
        if not spans:
            return cls()
        
        # Create nodes
        nodes: Dict[str, SpanNode] = {}
        for span_data in spans:
            node = SpanNode(
                name=span_data.get("name", "unknown"),
                span_id=span_data.get("span_id", ""),
                parent_id=span_data.get("parent_id"),
                trace_id=span_data.get("trace_id"),
                start_time=span_data.get("start_time"),
                end_time=span_data.get("end_time"),
                duration_ms=span_data.get("duration_ms"),
                status=span_data.get("status", "ok"),
                attributes=span_data.get("attributes", {}),
                events=span_data.get("events", []),
            )
            nodes[node.span_id] = node
        
        # Link children to parents
        roots: List[SpanNode] = []
        for node in nodes.values():
            if node.parent_id and node.parent_id in nodes:
                nodes[node.parent_id].add_child(node)
            else:
                roots.append(node)
        
        return cls(roots=roots)
    
    def find_span(self, query: Union[str, SpanQuery]) -> Optional[SpanNode]:
        """
        Find a single span matching the query.
        
        Args:
            query: Span name or SpanQuery.
            
        Returns:
            First matching span or None.
        """
        results = self.find_spans(query, limit=1)
        return results[0] if results else None
    
    def find_spans(
        self,
        query: Union[str, SpanQuery],
        limit: Optional[int] = None,
    ) -> List[SpanNode]:
        """
        Find all spans matching the query.
        
        Args:
            query: Span name or SpanQuery.
            limit: Maximum number of results.
            
        Returns:
            List of matching spans.
        """
        if isinstance(query, str):
            query = SpanQuery(name=query)
        
        results: List[SpanNode] = []
        
        def search(node: SpanNode) -> bool:
            """Search node and children, return True to stop."""
            if query.matches(node):
                results.append(node)
                if limit and len(results) >= limit:
                    return True
            
            for child in node.children:
                if search(child):
                    return True
            
            return False
        
        for root in self.roots:
            if search(root):
                break
        
        return results
    
    def find_spans_by_name(self, name: str) -> List[SpanNode]:
        """Find all spans with exact name match."""
        return self.find_spans(SpanQuery(name=name))
    
    def find_spans_by_name_contains(self, substring: str) -> List[SpanNode]:
        """Find all spans with name containing substring."""
        return self.find_spans(SpanQuery(name_contains=substring))
    
    def find_spans_by_attribute(
        self, key: str, value: Optional[Any] = None
    ) -> List[SpanNode]:
        """Find spans by attribute."""
        return self.find_spans(SpanQuery(attribute=key, attribute_value=value))
    
    def find_error_spans(self) -> List[SpanNode]:
        """Find all error spans."""
        return self.find_spans(SpanQuery(status="error"))
    
    def find_root_spans(self) -> List[SpanNode]:
        """Get all root spans."""
        return self.roots
    
    def get_span_by_id(self, span_id: str) -> Optional[SpanNode]:
        """Get a span by its ID."""
        return self._all_spans.get(span_id)
    
    def get_all_spans(self) -> List[SpanNode]:
        """Get all spans in the tree."""
        return list(self._all_spans.values())
    
    def get_span_count(self) -> int:
        """Get total number of spans."""
        return len(self._all_spans)
    
    def get_depth(self) -> int:
        """Get maximum depth of the tree."""
        def _depth(node: SpanNode) -> int:
            if not node.children:
                return 1
            return 1 + max(_depth(c) for c in node.children)
        
        if not self.roots:
            return 0
        
        return max(_depth(root) for root in self.roots)
    
    def get_summary(self) -> Dict[str, Any]:
        """Get summary statistics of the tree."""
        all_spans = self.get_all_spans()
        
        names = {}
        statuses = {}
        total_duration = 0.0
        
        for span in all_spans:
            names[span.name] = names.get(span.name, 0) + 1
            statuses[span.status] = statuses.get(span.status, 0) + 1
            if span.duration_ms:
                total_duration += span.duration_ms
        
        return {
            "total_spans": len(all_spans),
            "root_spans": len(self.roots),
            "max_depth": self.get_depth(),
            "spans_by_name": names,
            "spans_by_status": statuses,
            "total_duration_ms": total_duration,
            "error_count": statuses.get("error", 0),
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert tree to dictionary."""
        return {
            "roots": [root.to_dict() for root in self.roots],
            "summary": self.get_summary(),
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SpanTree':
        """Create from dictionary."""
        roots = [SpanNode.from_dict(r) for r in data.get("roots", [])]
        return cls(roots=roots)
    
    def to_mermaid(self) -> str:
        """
        Generate Mermaid diagram of the span tree.
        
        Returns:
            Mermaid flowchart code.
        """
        lines = ["graph TD"]
        
        def add_node(node: SpanNode, parent_id: Optional[str] = None):
            node_label = f'{node.span_id}["{node.name}"]'
            
            if parent_id:
                lines.append(f"    {parent_id} --> {node_label}")
            else:
                lines.append(f"    {node_label}")
            
            for child in node.children:
                add_node(child, node.span_id)
        
        for root in self.roots:
            add_node(root)
        
        return "\n".join(lines)
    
    def __repr__(self) -> str:
        return f"SpanTree(roots={len(self.roots)}, total_spans={self.get_span_count()})"


__all__ = [
    'SpanNode',
    'SpanQuery',
    'SpanTree',
]

