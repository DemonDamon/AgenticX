"""JSON file persistence for dictionary fields and board specs.

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
