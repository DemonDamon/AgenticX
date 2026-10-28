from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import yaml


class TagConflictError(ValueError):
    """Raised when the same name+meaning_key is defined twice."""


class TagNotFoundError(KeyError):
    """Raised when a tag lookup misses."""


@dataclass(frozen=True)
class TagDef:
    name: str
    layer: str
    business_def: str
    calc_logic: str
    update_freq: str
    owner: str
    meaning_key: str = "default"


class TagCatalog:
    def __init__(self) -> None:
        self._tags: Dict[Tuple[str, str], TagDef] = {}

    def load(self, path: Union[str, Path]) -> None:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        self._tags.clear()
        for row in data.get("tags") or []:
            td = TagDef(
                name=str(row["name"]),
                layer=str(row.get("layer") or ""),
                business_def=str(row.get("business_def") or ""),
                calc_logic=str(row.get("calc_logic") or ""),
                update_freq=str(row.get("update_freq") or ""),
                owner=str(row.get("owner") or ""),
                meaning_key=str(row.get("meaning_key") or "default"),
            )
            key = (td.name, td.meaning_key)
            if key in self._tags:
                raise TagConflictError(
                    f"duplicate tag {td.name!r} meaning_key={td.meaning_key!r}"
                )
            self._tags[key] = td

    def get(self, name: str, *, meaning_key: Optional[str] = None) -> TagDef:
        if meaning_key is not None:
            key = (name, meaning_key)
            try:
                return self._tags[key]
            except KeyError as e:
                raise TagNotFoundError(f"{name}/{meaning_key}") from e
        matches = [t for (n, _), t in self._tags.items() if n == name]
        if not matches:
            raise TagNotFoundError(name)
        if len(matches) > 1:
            raise TagNotFoundError(f"{name} is ambiguous; pass meaning_key")
        return matches[0]

    def list_tags(self, *, layer: Optional[str] = None) -> List[TagDef]:
        vals = list(self._tags.values())
        if layer is not None:
            vals = [t for t in vals if t.layer == layer]
        return sorted(vals, key=lambda t: (t.layer, t.name, t.meaning_key))
