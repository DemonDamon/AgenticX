from __future__ import annotations

import json
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


def load_profile_dict(data: Dict[str, Any]) -> IdMapProfile:
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


def profile_to_dict(profile: IdMapProfile) -> Dict[str, Any]:
    return {
        "name": profile.name,
        "id_types": [{"name": t.name, "priority": t.priority} for t in profile.id_types],
        "merge": {
            "priority": list(profile.priority),
            "on_conflict": profile.on_conflict,
        },
    }


def load_profile(path: Union[str, Path]) -> IdMapProfile:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if p.suffix.lower() == ".json":
        data = json.loads(text)
    else:
        data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise IdMapProfileError("profile root must be a mapping")
    return load_profile_dict(data)


def dump_profile(
    profile: IdMapProfile,
    path: Union[str, Path],
    *,
    fmt: str | None = None,
) -> Path:
    """Write profile as YAML or JSON. fmt defaults from path suffix."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = profile_to_dict(profile)
    use = (fmt or p.suffix.lstrip(".") or "yaml").lower()
    if use == "json":
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        p.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return p
