from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import yaml


@dataclass
class TagComputeResult:
    rows: List[Dict[str, Any]]
    computed: List[str] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)


class TagComputeEngine:
    def __init__(self) -> None:
        self._computes: Dict[str, Dict[str, Any]] = {}

    def load(self, path: Union[str, Path]) -> None:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        self._computes = {str(c["id"]): dict(c) for c in (data.get("computes") or [])}

    def compute(
        self,
        rows: List[Dict[str, Any]],
        *,
        tag_ids: Optional[List[str]] = None,
    ) -> TagComputeResult:
        ids = list(tag_ids) if tag_ids is not None else list(self._computes.keys())
        out_rows = [dict(r) for r in rows]
        for tid in ids:
            spec = self._computes[tid]
            for row in out_rows:
                row[tid] = self._eval(spec, row)
        return TagComputeResult(
            rows=out_rows,
            computed=ids,
            meta={"tables_out": ["tagged_rows"], "tag_ids": ids},
        )

    def _eval(self, spec: Dict[str, Any], row: Dict[str, Any]) -> Any:
        t = str(spec.get("type") or "")
        if t == "copy_field":
            return row.get(str(spec.get("field") or ""))
        if t == "equals_const":
            return row.get(str(spec.get("field") or "")) == spec.get("value")
        if t == "in_set":
            return row.get(str(spec.get("field") or "")) in list(spec.get("values") or [])
        if t == "bool_and":
            fields = [str(x) for x in (spec.get("fields") or [])]
            return all(bool(row.get(f)) for f in fields)
        raise ValueError(f"unknown compute type {t}")
