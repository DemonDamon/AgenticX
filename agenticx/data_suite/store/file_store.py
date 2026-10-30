"""JSON file persistence for dictionary, boards, and governance ops.

Path resolution: explicit ``root`` argument, else ``AGX_DATA_SUITE_STORE_DIR``,
else a process-local default under the cwd (``.runtime/data-suite``).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.data_suite.governance.dictionary import FieldDef

_DEFAULT_REL = Path(".runtime") / "data-suite"


def resolve_store_dir(root: Optional[Union[str, Path]] = None) -> Path:
    if root is not None:
        return Path(root)
    env = os.environ.get("AGX_DATA_SUITE_STORE_DIR", "").strip()
    if env:
        return Path(env)
    return Path.cwd() / _DEFAULT_REL


class DictionaryFileStore:
    """Upsert / list FieldDef rows in ``dictionary.json``."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "dictionary.json"
        self._fields: Dict[str, FieldDef] = {}
        self._load()

    def _load(self) -> None:
        self._fields.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("fields") or []:
            fd = FieldDef(
                name=str(row["name"]),
                business_def=str(row.get("business_def") or ""),
                calc_logic=str(row.get("calc_logic") or ""),
                update_freq=str(row.get("update_freq") or ""),
                owner=str(row.get("owner") or ""),
            )
            self._fields[fd.name] = fd

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {
            "fields": [
                {
                    "name": f.name,
                    "business_def": f.business_def,
                    "calc_logic": f.calc_logic,
                    "update_freq": f.update_freq,
                    "owner": f.owner,
                }
                for f in self.list_fields()
            ]
        }
        self._path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def list_fields(self) -> List[FieldDef]:
        return [self._fields[k] for k in sorted(self._fields)]

    def get_field(self, name: str) -> FieldDef:
        try:
            return self._fields[name]
        except KeyError as e:
            raise KeyError(name) from e

    def upsert_field(self, field: FieldDef) -> FieldDef:
        self._fields[field.name] = field
        self._persist()
        return field


class BoardFileStore:
    """Upsert / list board specs in ``boards.json`` (JSON-shaped dicts)."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "boards.json"
        self._boards: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        self._boards.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("boards") or []:
            bid = str(row.get("id") or "")
            if not bid:
                continue
            self._boards[bid] = dict(row)

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"boards": [self._boards[k] for k in sorted(self._boards)]}
        self._path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def list_boards(self) -> List[Dict[str, Any]]:
        return [dict(self._boards[k]) for k in sorted(self._boards)]

    def get_board(self, board_id: str) -> Optional[Dict[str, Any]]:
        row = self._boards.get(board_id)
        return dict(row) if row is not None else None

    def upsert_board(self, board: Dict[str, Any]) -> Dict[str, Any]:
        bid = str(board.get("id") or "").strip()
        if not bid:
            raise ValueError("board.id required")
        stored = {
            "id": bid,
            "title": str(board.get("title") or bid),
            "drillLevels": list(board.get("drillLevels") or []),
            "widgets": list(board.get("widgets") or []),
        }
        # Preserve any extra keys used by callers
        for k, v in board.items():
            if k not in stored:
                stored[k] = v
        self._boards[bid] = stored
        self._persist()
        return dict(stored)


class CleaningRuleStore:
    """Upsert / list cleaning rules in ``cleaning_rules.json``."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "cleaning_rules.json"
        self._rules: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        self._rules.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("rules") or []:
            rid = str(row.get("id") or "").strip()
            if not rid:
                continue
            self._rules[rid] = {
                "id": rid,
                "template": str(row.get("template") or ""),
                "field": str(row.get("field") or ""),
                "params": dict(row.get("params") or {}),
                "enabled": bool(row.get("enabled", True)),
            }

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"rules": [self._rules[k] for k in sorted(self._rules)]}
        self._path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def list_rules(self) -> List[Dict[str, Any]]:
        return [dict(self._rules[k]) for k in sorted(self._rules)]

    def get_rule(self, rule_id: str) -> Optional[Dict[str, Any]]:
        row = self._rules.get(rule_id)
        return dict(row) if row is not None else None

    def upsert_rule(self, rule: Dict[str, Any]) -> Dict[str, Any]:
        rid = str(rule.get("id") or "").strip()
        if not rid:
            raise ValueError("rule.id required")
        stored = {
            "id": rid,
            "template": str(rule.get("template") or ""),
            "field": str(rule.get("field") or ""),
            "params": dict(rule.get("params") or {}),
            "enabled": bool(rule.get("enabled", True)),
        }
        self._rules[rid] = stored
        self._persist()
        return dict(stored)


class ClassificationStore:
    """Upsert / list trust grades in ``classification.json`` (seed S/A/B/C)."""

    DEFAULT_GRADES: List[Dict[str, Any]] = [
        {"id": "S", "label": "S", "rank": 4},
        {"id": "A", "label": "A", "rank": 3},
        {"id": "B", "label": "B", "rank": 2},
        {"id": "C", "label": "C", "rank": 1},
    ]

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "classification.json"
        self._grades: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        self._grades.clear()
        if not self._path.is_file():
            for g in self.DEFAULT_GRADES:
                self._grades[g["id"]] = dict(g)
            self._persist()
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        rows = raw.get("grades") or []
        if not rows:
            for g in self.DEFAULT_GRADES:
                self._grades[g["id"]] = dict(g)
            self._persist()
            return
        for row in rows:
            gid = str(row.get("id") or "").strip()
            if not gid:
                continue
            self._grades[gid] = {
                "id": gid,
                "label": str(row.get("label") or gid),
                "rank": int(row.get("rank") or 0),
            }

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        # Sort by rank desc then id
        ordered = sorted(self._grades.values(), key=lambda g: (-int(g.get("rank") or 0), g["id"]))
        payload = {"grades": [dict(g) for g in ordered]}
        self._path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def list_grades(self) -> List[Dict[str, Any]]:
        return sorted(
            [dict(g) for g in self._grades.values()],
            key=lambda g: (-int(g.get("rank") or 0), g["id"]),
        )

    def get_grade(self, grade_id: str) -> Optional[Dict[str, Any]]:
        row = self._grades.get(grade_id)
        return dict(row) if row is not None else None

    def upsert_grade(self, grade: Dict[str, Any]) -> Dict[str, Any]:
        gid = str(grade.get("id") or "").strip()
        if not gid:
            raise ValueError("grade.id required")
        stored = {
            "id": gid,
            "label": str(grade.get("label") or gid),
            "rank": int(grade.get("rank") or 0),
        }
        self._grades[gid] = stored
        self._persist()
        return dict(stored)


class QualityMetricStore:
    """Metric defs + last_run snapshot in ``quality_metrics.json``."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "quality_metrics.json"
        self._metrics: Dict[str, Dict[str, Any]] = {}
        self._last_run: Optional[Dict[str, Any]] = None
        self._load()

    def _load(self) -> None:
        self._metrics.clear()
        self._last_run = None
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("metrics") or []:
            mid = str(row.get("id") or "").strip()
            if not mid:
                continue
            self._metrics[mid] = {
                "id": mid,
                "type": str(row.get("type") or ""),
                "field": str(row.get("field") or ""),
            }
        lr = raw.get("last_run")
        self._last_run = dict(lr) if isinstance(lr, dict) else None

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {
            "metrics": [self._metrics[k] for k in sorted(self._metrics)],
            "last_run": self._last_run,
        }
        self._path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def list_metrics(self) -> List[Dict[str, Any]]:
        return [dict(self._metrics[k]) for k in sorted(self._metrics)]

    def get_last_run(self) -> Optional[Dict[str, Any]]:
        return dict(self._last_run) if self._last_run is not None else None

    def upsert_metric(self, metric: Dict[str, Any]) -> Dict[str, Any]:
        mid = str(metric.get("id") or "").strip()
        if not mid:
            raise ValueError("metric.id required")
        stored = {
            "id": mid,
            "type": str(metric.get("type") or ""),
            "field": str(metric.get("field") or ""),
        }
        self._metrics[mid] = stored
        self._persist()
        return dict(stored)

    def set_last_run(self, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        self._last_run = {
            "day": str(snapshot.get("day") or ""),
            "metrics": dict(snapshot.get("metrics") or {}),
            "meta": dict(snapshot.get("meta") or {}),
        }
        self._persist()
        return dict(self._last_run)

    def run_day(
        self,
        day: str,
        rows: Optional[List[Dict[str, Any]]] = None,
        *,
        quarantine: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Compute QualityRollup for ``day`` from stored metric defs and persist last_run."""
        from agenticx.data_suite.governance.quality import QualityRollup

        rollup = QualityRollup()
        rollup.load_metric_defs(self.list_metrics())
        snap = rollup.compute_day(day, rows or [], quarantine=quarantine)
        return self.set_last_run(
            {"day": snap.day, "metrics": snap.metrics, "meta": snap.meta}
        )


class ReviewActionStore:
    """Append-only review/audit actions in ``review_actions.json``."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "review_actions.json"
        self._actions: List[Dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        self._actions = []
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("actions") or []:
            aid = str(row.get("id") or "").strip()
            if not aid:
                continue
            self._actions.append(
                {
                    "id": aid,
                    "target_rule_id": str(row.get("target_rule_id") or ""),
                    "decision": str(row.get("decision") or ""),
                    "note": str(row.get("note") or ""),
                    "at": str(row.get("at") or ""),
                }
            )

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"actions": [dict(a) for a in self._actions]}
        self._path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def list_actions(self) -> List[Dict[str, Any]]:
        return [dict(a) for a in self._actions]

    def append_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        aid = str(action.get("id") or "").strip()
        if not aid:
            raise ValueError("action.id required")
        decision = str(action.get("decision") or "").strip()
        if decision not in {"approve", "reject", "keep"}:
            raise ValueError("decision must be approve|reject|keep")
        stored = {
            "id": aid,
            "target_rule_id": str(action.get("target_rule_id") or ""),
            "decision": decision,
            "note": str(action.get("note") or ""),
            "at": str(action.get("at") or ""),
        }
        self._actions.append(stored)
        self._persist()
        return dict(stored)

