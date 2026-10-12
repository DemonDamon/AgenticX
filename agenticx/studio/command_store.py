#!/usr/bin/env python3
"""Local JSON storage for composer commands.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.runtime.replay_ledger.contracts import validate_ledger_id

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RESERVED_NAMES = frozenset({"perf"})
SCOPES = frozenset({"global", "avatar", "group", "room"})
_SCOPE_DIR = {"avatar": "avatars", "group": "groups", "room": "rooms"}
_MAX_NAME = 64
_MAX_DESCRIPTION = 200
_MAX_INSTRUCTIONS = 8000


class CommandStoreError(Exception):
    """Base error for command storage."""


class CommandValidationError(CommandStoreError):
    """Field failed validation."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class CommandNameReserved(CommandStoreError):
    """Name is reserved for a builtin command."""

    detail = "command name is reserved"


class CommandNameExists(CommandStoreError):
    """Name already exists in the same scope file."""

    detail = "command name already exists"


class CommandNotFound(CommandStoreError):
    """Command id or name is missing."""

    detail = "command not found"


def _utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


class CommandStore:
    """Read and write command JSON files under an injected root."""

    def __init__(self, root: Path, sessions_root: Path | None = None) -> None:
        self.root = Path(root)
        self.sessions_root = Path(sessions_root) if sessions_root is not None else self.root.parent / "sessions"

    def list_commands(self, scope: str, subject_id: str = "") -> list[dict[str, Any]]:
        path = self._scope_path(scope, subject_id)
        return self._read_commands(path)

    def add_command(
        self,
        *,
        scope: str,
        subject_id: str = "",
        name: str,
        description: str = "",
        instructions: str,
    ) -> dict[str, Any]:
        clean_name = self._validate_name(name)
        if clean_name in RESERVED_NAMES:
            raise CommandNameReserved(CommandNameReserved.detail)
        clean_description = str(description or "").strip()
        if len(clean_description) > _MAX_DESCRIPTION:
            raise CommandValidationError("description is too long")
        clean_instructions = str(instructions or "").strip()
        if not clean_instructions or len(clean_instructions) > _MAX_INSTRUCTIONS:
            raise CommandValidationError("instructions are required")
        path = self._scope_path(scope, subject_id)
        rows = self._read_commands(path)
        if any(str(row.get("name") or "") == clean_name for row in rows):
            raise CommandNameExists(CommandNameExists.detail)
        record = {
            "id": _new_id(),
            "name": clean_name,
            "description": clean_description,
            "instructions": clean_instructions,
            "created_at": _utcnow(),
        }
        rows.append(record)
        self._write_commands(path, rows)
        return record

    def delete_command(self, command_id: str, *, scope: str, subject_id: str = "") -> None:
        path = self._scope_path(scope, subject_id)
        rows = self._read_commands(path)
        target = str(command_id or "").strip()
        kept = [row for row in rows if str(row.get("id") or "") != target]
        if len(kept) == len(rows):
            raise CommandNotFound(CommandNotFound.detail)
        self._write_commands(path, kept)

    def disabled_builtin_names(self) -> set[str]:
        path = self.root / "disabled.json"
        if not path.is_file():
            return set()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return set()
        names = data.get("names") if isinstance(data, dict) else None
        if not isinstance(names, list):
            return set()
        return {str(name) for name in names if str(name) in RESERVED_NAMES}

    def set_builtin_enabled(self, name: str, enabled: bool) -> None:
        clean = self._validate_name(name)
        if clean not in RESERVED_NAMES:
            raise CommandValidationError("not a builtin command")
        names = self.disabled_builtin_names()
        if enabled:
            names.discard(clean)
        else:
            names.add(clean)
        path = self.root / "disabled.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1, "names": sorted(names)}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def list_session_pins(self, session_id: str) -> list[dict[str, Any]]:
        sid = validate_ledger_id(str(session_id or "").strip(), "session_id")
        return self._read_commands(self._session_path(sid))

    def pin_command(
        self,
        session_id: str,
        *,
        scope: str,
        subject_id: str = "",
        name: str,
    ) -> dict[str, Any]:
        sid = validate_ledger_id(str(session_id or "").strip(), "session_id")
        clean_name = self._validate_name(name)
        if clean_name in RESERVED_NAMES:
            raise CommandNameReserved(CommandNameReserved.detail)
        source = next(
            (row for row in self.list_commands(scope, subject_id) if str(row.get("name") or "") == clean_name),
            None,
        )
        if source is None:
            raise CommandNotFound(CommandNotFound.detail)
        path = self._session_path(sid)
        rows = self._read_commands(path)
        snapshot = {
            "id": _new_id(),
            "name": clean_name,
            "description": str(source.get("description") or ""),
            "instructions": str(source.get("instructions") or ""),
            "created_at": _utcnow(),
        }
        rows = [row for row in rows if str(row.get("name") or "") != clean_name]
        rows.append(snapshot)
        self._write_commands(path, rows)
        return snapshot

    def delete_session_pin(self, session_id: str, name: str) -> None:
        sid = validate_ledger_id(str(session_id or "").strip(), "session_id")
        clean_name = str(name or "").strip()
        path = self._session_path(sid)
        rows = self._read_commands(path)
        kept = [row for row in rows if str(row.get("name") or "") != clean_name]
        if len(kept) == len(rows):
            raise CommandNotFound(CommandNotFound.detail)
        self._write_commands(path, kept)

    def _validate_name(self, name: str) -> str:
        clean = str(name or "").strip()
        if not clean or len(clean) > _MAX_NAME or NAME_RE.fullmatch(clean) is None:
            raise CommandValidationError("invalid command name")
        return clean

    def _check_subject(self, subject_id: str) -> str:
        text = str(subject_id or "")
        if not text.strip() or "/" in text or "\\" in text or ".." in text:
            raise CommandValidationError("invalid subject_id")
        return text

    def _scope_path(self, scope: str, subject_id: str) -> Path:
        clean_scope = str(scope or "").strip()
        if clean_scope not in SCOPES:
            raise CommandValidationError("invalid scope")
        if clean_scope == "global":
            return self.root / "global.json"
        subject = self._check_subject(subject_id)
        return self.root / _SCOPE_DIR[clean_scope] / f"{subject}.json"

    def _session_path(self, session_id: str) -> Path:
        return self.sessions_root / session_id / "commands.json"

    def _read_commands(self, path: Path) -> list[dict[str, Any]]:
        if not path.is_file():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        rows = data.get("commands") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    def _write_commands(self, path: Path, rows: list[dict[str, Any]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1, "commands": rows}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
