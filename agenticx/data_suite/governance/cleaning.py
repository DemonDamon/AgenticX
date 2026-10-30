from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import yaml


@dataclass
class CleanResult:
    rows: List[Dict[str, Any]]
    quarantine: List[Dict[str, Any]] = field(default_factory=list)
    audit: List[Dict[str, Any]] = field(default_factory=list)


class CleaningEngine:
    def __init__(self) -> None:
        self._ruleset_id: str = ""
        self._rules: List[Dict[str, Any]] = []

    def load_ruleset(self, path: Union[str, Path]) -> None:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        self._ruleset_id = str(data.get("ruleset_id") or "")
        self._rules = list(data.get("rules") or [])

    def load_rules(
        self,
        rules: List[Dict[str, Any]],
        *,
        ruleset_id: str = "",
    ) -> None:
        """Load rules from in-memory dicts (e.g. CleaningRuleStore)."""
        self._ruleset_id = ruleset_id
        self._rules = [dict(r) for r in rules]

    def apply(
        self,
        rows: List[Dict[str, Any]],
        *,
        ruleset_id: Optional[str] = None,
    ) -> CleanResult:
        if ruleset_id is not None and self._ruleset_id and ruleset_id != self._ruleset_id:
            raise ValueError(f"ruleset_id mismatch: {ruleset_id!r} != {self._ruleset_id!r}")

        counts: Dict[str, Dict[str, int]] = {
            str(r["id"]): {"passed": 0, "failed": 0} for r in self._rules
        }
        survivors: List[Dict[str, Any]] = [dict(row) for row in rows]
        quarantine: List[Dict[str, Any]] = []

        for rule in self._rules:
            rule_id = str(rule["id"])
            template = str(rule.get("template") or "")
            field_name = str(rule.get("field") or "")
            params = dict(rule.get("params") or {})
            next_survivors: List[Dict[str, Any]] = []
            for row in survivors:
                ok, reason, mutated = self._apply_one(template, field_name, params, row)
                if ok:
                    counts[rule_id]["passed"] += 1
                    next_survivors.append(mutated)
                else:
                    counts[rule_id]["failed"] += 1
                    quarantine.append({"row": row, "rule_id": rule_id, "reason": reason})
            survivors = next_survivors

        audit = [
            {"rule_id": rid, "passed": c["passed"], "failed": c["failed"]}
            for rid, c in counts.items()
        ]
        return CleanResult(rows=survivors, quarantine=quarantine, audit=audit)

    def _apply_one(
        self,
        template: str,
        field_name: str,
        params: Dict[str, Any],
        row: Dict[str, Any],
    ) -> tuple[bool, str, Dict[str, Any]]:
        out = dict(row)
        value = out.get(field_name)

        if template == "not_null":
            if value is None or value == "":
                return False, f"{field_name} is null/empty", out
            return True, "", out

        if template == "regex":
            pattern = str(params.get("pattern") or "")
            if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
                return False, f"{field_name} failed regex {pattern}", out
            return True, "", out

        if template == "in_set":
            allowed = list(params.get("values") or [])
            if value not in allowed:
                return False, f"{field_name} not in {allowed}", out
            return True, "", out

        if template == "trim":
            if isinstance(value, str):
                out[field_name] = value.strip()
            return True, "", out

        return False, f"unknown template {template}", out
