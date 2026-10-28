from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Union

import yaml


class FieldNotFoundError(KeyError):
    """Raised when a field name is not in the dictionary."""


@dataclass(frozen=True)
class FieldDef:
    name: str
    business_def: str
    calc_logic: str
    update_freq: str
    owner: str


class DictionaryCatalog:
    def __init__(self) -> None:
        self._fields: Dict[str, FieldDef] = {}

    def load(self, path: Union[str, Path]) -> None:
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        self._fields.clear()
        for row in data.get("fields") or []:
            fd = FieldDef(
                name=str(row["name"]),
                business_def=str(row.get("business_def") or ""),
                calc_logic=str(row.get("calc_logic") or ""),
                update_freq=str(row.get("update_freq") or ""),
                owner=str(row.get("owner") or ""),
            )
            self._fields[fd.name] = fd

    def get(self, field: str) -> FieldDef:
        try:
            return self._fields[field]
        except KeyError as e:
            raise FieldNotFoundError(field) from e

    def list_fields(self) -> List[FieldDef]:
        return [self._fields[k] for k in sorted(self._fields)]
