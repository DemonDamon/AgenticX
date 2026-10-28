from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Union

import yaml


class IdMapProfileError(ValueError):
    pass


@dataclass
class IdTypeDef:
    name: str
    priority: int = 0


@dataclass
class IdMapProfile:
    name: str
    id_types: List[IdTypeDef] = field(default_factory=list)
    priority: List[str] = field(default_factory=list)
    on_conflict: str = "prefer_priority"

    def priority_rank(self, id_type: str) -> int:
        try:
            return self.priority.index(id_type)
        except ValueError:
            return len(self.priority) + 100


def load_profile(path: Union[str, Path]) -> IdMapProfile:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise IdMapProfileError("profile root must be a mapping")
    name = str(data.get("name") or "").strip() or "default"
    types_raw = data.get("id_types") or []
    if not isinstance(types_raw, list) or not types_raw:
        raise IdMapProfileError("id_types required")
    id_types = []
    for t in types_raw:
        if not isinstance(t, dict) or not t.get("name"):
            raise IdMapProfileError("each id_type needs a name")
        id_types.append(IdTypeDef(name=str(t["name"]), priority=int(t.get("priority") or 0)))
    merge = data.get("merge") if isinstance(data.get("merge"), dict) else {}
    priority = [str(x) for x in (merge.get("priority") or [t.name for t in id_types])]
    on_conflict = str(merge.get("on_conflict") or "prefer_priority")
    if on_conflict not in ("prefer_priority", "reject"):
        raise IdMapProfileError(f"unsupported on_conflict: {on_conflict}")
    return IdMapProfile(name=name, id_types=id_types, priority=priority, on_conflict=on_conflict)
