from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from agenticx.data_suite.acl.gate import assert_query_access
from agenticx.data_suite.acl.policy import QueryAclPolicy
from agenticx.data_suite.dashboard.binder import ChartSeries, bind_widget
from agenticx.data_suite.dashboard.spec import WidgetSpec
from agenticx.data_suite.masking.engine import MaskingEngine
from agenticx.data_suite.masking.policy import MaskingPolicy


def _as_engine(masking: Union[MaskingEngine, MaskingPolicy]) -> MaskingEngine:
    if isinstance(masking, MaskingEngine):
        return masking
    return MaskingEngine(masking)


def secure_query_rows(
    rows: List[Dict[str, Any]],
    *,
    role: str,
    dataset_id: str,
    acl: QueryAclPolicy,
    masking: Union[MaskingEngine, MaskingPolicy],
    board_id: Optional[str] = None,
    fields: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Self-serve read path: ACL gate then **forced** masking.

    Callers cannot skip masking when a policy/engine is supplied — this is the
    closed loop for A6 query APIs. Raises ``QueryAccessDenied`` on ACL deny.
    """
    assert_query_access(
        acl, role=role, dataset_id=dataset_id, board_id=board_id, fields=fields
    )
    engine = _as_engine(masking)
    return engine.apply(rows, role=role)


def secure_bind_widget(
    widget: WidgetSpec,
    rows: List[Dict[str, Any]],
    *,
    role: str,
    acl: QueryAclPolicy,
    masking: Union[MaskingEngine, MaskingPolicy],
    board_id: Optional[str] = None,
    filters: Optional[Dict[str, Any]] = None,
) -> ChartSeries:
    """Board widget bind that cannot skip ACL or masking."""
    dataset_id = widget.dataset
    assert_query_access(acl, role=role, dataset_id=dataset_id, board_id=board_id)
    engine = _as_engine(masking)
    return bind_widget(widget, rows, filters=filters, masking=engine, role=role)
