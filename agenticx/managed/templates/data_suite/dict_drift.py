"""Dictionary / 口径 drift patrol."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union

import yaml

from agenticx.data_suite.governance.dictionary import DictionaryCatalog
from agenticx.managed.templates.data_suite.types import GovernanceTodo
from agenticx.managed.templates.data_suite.webhook import WebhookNotifier


@dataclass(frozen=True)
class DictDriftConfig:
    dictionary_yaml: Path
    null_rate_ceiling: float = 0.2
    require_fields: tuple[str, ...] = ()

    @classmethod
    def load(cls, path: Union[str, Path], *, fixtures_dir: Optional[Path] = None) -> "DictDriftConfig":
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        ref = str(raw.get("dictionary_ref") or "")
        base = fixtures_dir or Path(path).parent
        dictionary_yaml = Path(ref)
        if not dictionary_yaml.is_absolute():
            dictionary_yaml = base / ref
        req = tuple(str(x) for x in (raw.get("require_fields") or []))
        return cls(
            dictionary_yaml=dictionary_yaml,
            null_rate_ceiling=float(raw.get("null_rate_ceiling") or 0.2),
            require_fields=req,
        )


@dataclass
class DictDriftRunner:
    config: DictDriftConfig
    notifier: WebhookNotifier
    _catalog: DictionaryCatalog = field(default_factory=DictionaryCatalog, init=False, repr=False)

    def __post_init__(self) -> None:
        self._catalog.load(self.config.dictionary_yaml)

    def run(self, rows: List[Dict[str, Any]]) -> List[GovernanceTodo]:
        todos: List[GovernanceTodo] = []
        n = max(len(rows), 1)
        known = {f.name for f in self._catalog.list_fields()}
        required: Sequence[str] = self.config.require_fields or tuple(sorted(known))

        for field_name in required:
            if field_name not in known:
                todo = GovernanceTodo(
                    field=field_name,
                    reason="unknown_field",
                    detail={"message": "not in dictionary"},
                )
                todos.append(todo)
                continue
            present = any(field_name in r for r in rows)
            if not present:
                todos.append(
                    GovernanceTodo(
                        field=field_name,
                        reason="missing_in_sample",
                        detail={},
                    )
                )
                continue
            nulls = sum(1 for r in rows if r.get(field_name) is None or r.get(field_name) == "")
            rate = nulls / n
            if rate > self.config.null_rate_ceiling:
                todos.append(
                    GovernanceTodo(
                        field=field_name,
                        reason="null_rate_exceeded",
                        detail={"null_rate": rate, "ceiling": self.config.null_rate_ceiling},
                    )
                )

        if todos:
            self.notifier.emit(
                "dict_drift",
                count=len(todos),
                fields=[t.field for t in todos],
                reasons=[t.reason for t in todos],
            )
        return todos
