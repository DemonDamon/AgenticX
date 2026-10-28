from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Union

import yaml


@dataclass(frozen=True)
class TrustDecision:
    field: str
    value: object
    grade: str
    source: str
    reason: str


class TrustArbiter:
    def __init__(self) -> None:
        self._profile_id = ""
        self._grade_rank: Dict[str, int] = {}
        self._source_order: List[str] = []
        self._policy = "prefer_higher_grade"

    def load_profile(self, path: Union[str, Path]) -> None:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        self._profile_id = str(data.get("profile_id") or "")
        self._grade_rank = {str(k): int(v) for k, v in (data.get("grade_rank") or {}).items()}
        self._source_order = [str(x) for x in (data.get("source_order") or [])]
        self._policy = str(data.get("policy") or "prefer_higher_grade")

    def grade(self, candidates: List[Dict[str, Any]], *, field: str) -> TrustDecision:
        if not candidates:
            raise ValueError("candidates must be non-empty")

        def source_rank(source: str) -> int:
            try:
                return self._source_order.index(source)
            except ValueError:
                return len(self._source_order) + 1

        def sort_key(c: Dict[str, Any]) -> tuple:
            g = str(c.get("grade") or "")
            s = str(c.get("source") or "")
            if self._policy == "prefer_source_order":
                return (source_rank(s), -self._grade_rank.get(g, 0))
            # prefer_higher_grade (default)
            return (-self._grade_rank.get(g, 0), source_rank(s))

        best = sorted(candidates, key=sort_key)[0]
        reason = (
            f"policy={self._policy}; grade={best.get('grade')}; source={best.get('source')}"
        )
        return TrustDecision(
            field=field,
            value=best.get("value"),
            grade=str(best.get("grade") or ""),
            source=str(best.get("source") or ""),
            reason=reason,
        )
