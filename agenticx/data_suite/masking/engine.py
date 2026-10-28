from __future__ import annotations

import copy
import hashlib
from typing import Any, Dict, List

from agenticx.data_suite.masking.policy import MaskingPolicy


def _partial(value: Any) -> Any:
    if value is None:
        return None
    s = str(value)
    if len(s) <= 2:
        return "*" * len(s)
    return s[0] + ("*" * (len(s) - 2)) + s[-1]


def _hash(value: Any) -> str:
    raw = "" if value is None else str(value)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def _apply_strategy(value: Any, strategy: str) -> Any:
    if strategy == "full":
        return value
    if strategy == "partial":
        return _partial(value)
    if strategy == "hash":
        return _hash(value)
    if strategy == "drop":
        return None
    raise ValueError(f"unknown mask strategy: {strategy}")


class MaskingEngine:
    def __init__(self, policy: MaskingPolicy) -> None:
        self._policy = policy
        self._by_field = {r.field: r for r in policy.rules}

    def apply(self, rows: List[Dict[str, Any]], *, role: str) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for row in rows:
            cloned = copy.deepcopy(row)
            for field, rule in self._by_field.items():
                if field in cloned:
                    cloned[field] = _apply_strategy(cloned[field], rule.strategy_for(role))
            out.append(cloned)
        return out
