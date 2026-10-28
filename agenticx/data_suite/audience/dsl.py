from __future__ import annotations

from typing import Any, Dict, List


def select_audience(
    rows: List[Dict[str, Any]],
    query: Dict[str, Any],
    *,
    id_field: str = "member_id",
) -> List[str]:
    """Select entity ids whose tag columns match the audience query.

    query shape: {op: and|or|not, args: [...]} or
    {tag: name, op: eq|in|exists, value: ...}
    """
    return [str(r[id_field]) for r in rows if id_field in r and _match(r, query)]


def _match(row: Dict[str, Any], node: Dict[str, Any]) -> bool:
    if "op" in node and node["op"] in {"and", "or", "not"}:
        op = node["op"]
        args = list(node.get("args") or [])
        if op == "and":
            return all(_match(row, a) for a in args)
        if op == "or":
            return any(_match(row, a) for a in args)
        if op == "not":
            if len(args) != 1:
                raise ValueError("not expects exactly one arg")
            return not _match(row, args[0])
    tag = str(node.get("tag") or "")
    op = str(node.get("op") or "eq")
    value = node.get("value")
    cur = row.get(tag)
    if op == "eq":
        return cur == value
    if op == "in":
        return cur in list(value or [])
    if op == "exists":
        return cur is not None and cur != ""
    raise ValueError(f"unknown predicate op {op}")
