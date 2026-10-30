from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import FrozenSet, List, Optional, Union

import yaml


@dataclass(frozen=True)
class DatasetGrant:
    """Role grant for datasets/boards/fields. ``*`` means all."""

    role: str
    datasets: FrozenSet[str]
    boards: FrozenSet[str]
    fields: Optional[FrozenSet[str]] = None  # None = all fields allowed


@dataclass(frozen=True)
class QueryAclPolicy:
    id: str
    default_effect: str  # "deny" | "allow"
    grants: List[DatasetGrant]


def _as_frozen(values) -> FrozenSet[str]:
    if values is None:
        return frozenset()
    if isinstance(values, str):
        return frozenset({values})
    return frozenset(str(v) for v in values)


def load_query_acl_policy(path: Union[str, Path]) -> QueryAclPolicy:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    effect = str(data.get("default_effect") or "deny").lower()
    if effect not in {"deny", "allow"}:
        raise ValueError(f"unknown default_effect: {effect}")
    grants: List[DatasetGrant] = []
    for row in data.get("grants") or []:
        fields_raw = row.get("fields")
        fields: Optional[FrozenSet[str]]
        if fields_raw is None:
            fields = None
        else:
            fields = _as_frozen(fields_raw)
        grants.append(
            DatasetGrant(
                role=str(row["role"]),
                datasets=_as_frozen(row.get("datasets")),
                boards=_as_frozen(row.get("boards")),
                fields=fields,
            )
        )
    return QueryAclPolicy(
        id=str(data.get("id") or ""),
        default_effect=effect,
        grants=grants,
    )
