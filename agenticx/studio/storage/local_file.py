#!/usr/bin/env python3
"""Local filesystem storage backend (default, pre-HA behavior).

All roots are injected by the caller (factory or ``SessionManager``); this
module never resolves ``Path.home()`` itself. File formats are byte-identical
to the legacy inline implementations:

- ``<sessions_root>/<sid>/messages.json`` — full chat history list
- ``<sessions_root>/<sid>/agent_messages.json`` — last 40 model-context rows
- ``<sessions_root>/<sid>/messages_tail.json`` — tail snapshot dict
- ``<sessions_root>/<sid>/agent_state.json`` — runtime agent state (new file;
  written only when callers use the agent-state channel)
- ``<config_dir>/automation_tasks.json`` — automation task list
- ``<config_dir>/mcp_state.json`` — MCP last-connected/quarantine state

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from agenticx.utils.atomic_writer import atomic_write_json, atomic_write_text

logger = logging.getLogger(__name__)

_AGENT_MESSAGES_TAIL = 40


class LocalSessionPaths:
    """Path layout for session-scoped files under ``sessions_root``."""

    def __init__(self, sessions_root: str | Path) -> None:
        self._root = Path(sessions_root)

    @property
    def root(self) -> Path:
        return self._root

    def session_dir(self, session_id: str) -> Path:
        return self._root / session_id

    def messages_path(self, session_id: str) -> Path:
        return self._root / session_id / "messages.json"

    def agent_messages_path(self, session_id: str) -> Path:
        return self._root / session_id / "agent_messages.json"

    def messages_tail_path(self, session_id: str) -> Path:
        return self._root / session_id / "messages_tail.json"

    def agent_state_path(self, session_id: str) -> Path:
        return self._root / session_id / "agent_state.json"


def _parse_messages_payload(data: Any) -> list[dict]:
    """Accept list snapshots or legacy ``{"messages": [...]}`` wrappers."""
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        inner = data.get("messages") or data.get("chat_history")
        rows = inner if isinstance(inner, list) else []
    else:
        rows = []
    return [item for item in rows if isinstance(item, dict)]


def _read_json_file(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


class LocalFileBackend:
    """``SessionStorageBackend`` implementation backed by local JSON files."""

    def __init__(self, *, sessions_root: str | Path, config_dir: str | Path) -> None:
        self._sessions_root = Path(sessions_root)
        self._config_dir = Path(config_dir)
        self.paths = LocalSessionPaths(self._sessions_root)

    @property
    def sessions_root(self) -> Path:
        return self._sessions_root

    @property
    def config_dir(self) -> Path:
        return self._config_dir

    @property
    def automation_tasks_path(self) -> Path:
        return self._config_dir / "automation_tasks.json"

    @property
    def mcp_state_path(self) -> Path:
        return self._config_dir / "mcp_state.json"

    # ── Sync implementation (primary; async protocol delegates here) ──

    def load_messages_sync(self, session_id: str) -> list[dict]:
        return _parse_messages_payload(_read_json_file(self.paths.messages_path(session_id)))

    def save_messages_sync(self, session_id: str, messages: list[dict]) -> None:
        atomic_write_json(self.paths.messages_path(session_id), messages)

    def load_agent_messages_sync(self, session_id: str) -> list[dict]:
        data = _read_json_file(self.paths.agent_messages_path(session_id))
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    def save_agent_messages_sync(self, session_id: str, messages: list[dict]) -> None:
        atomic_write_json(
            self.paths.agent_messages_path(session_id),
            messages[-_AGENT_MESSAGES_TAIL:],
        )

    def load_messages_tail_sync(self, session_id: str) -> dict | None:
        data = _read_json_file(self.paths.messages_tail_path(session_id))
        return data if isinstance(data, dict) else None

    def save_messages_tail_sync(self, session_id: str, tail: dict) -> None:
        atomic_write_json(self.paths.messages_tail_path(session_id), tail)

    def load_agent_state_sync(self, session_id: str) -> dict | None:
        data = _read_json_file(self.paths.agent_state_path(session_id))
        return data if isinstance(data, dict) else None

    def save_agent_state_sync(self, session_id: str, state: dict) -> None:
        atomic_write_json(self.paths.agent_state_path(session_id), state)

    def delete_session_sync(self, session_id: str) -> bool:
        """Remove the session directory. Returns True when nothing remains."""
        session_dir = self.paths.session_dir(session_id)
        if not session_dir.exists():
            return True
        try:
            shutil.rmtree(session_dir, ignore_errors=False)
        except Exception:
            logger.warning("failed to remove session dir %s", session_dir, exc_info=True)
            return False
        return not session_dir.exists()

    def load_automation_tasks_sync(self) -> list[dict]:
        try:
            path = self.automation_tasks_path
            if not path.exists():
                return []
            parsed = json.loads(path.read_text("utf-8"))
            return parsed if isinstance(parsed, list) else []
        except Exception:
            logger.warning("Failed to read %s", self.automation_tasks_path, exc_info=True)
            return []

    def save_automation_tasks_sync(self, tasks: list[dict]) -> None:
        self._config_dir.mkdir(parents=True, exist_ok=True)
        try:
            atomic_write_json(self.automation_tasks_path, tasks)
        except Exception:
            logger.error("Failed to write %s", self.automation_tasks_path, exc_info=True)
            raise

    def load_mcp_state_sync(self) -> dict:
        data = _read_json_file(self.mcp_state_path)
        return data if isinstance(data, dict) else {}

    def save_mcp_state_sync(self, state: dict) -> None:
        self._config_dir.mkdir(parents=True, exist_ok=True)
        try:
            atomic_write_text(
                self.mcp_state_path,
                json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            )
        except Exception as exc:
            logger.warning("mcp_state.json write error (ignored): %s", exc)

    def ping_sync(self) -> bool:
        return True

    # ── Async protocol (thin wrappers; file IO is fast and local) ──

    async def load_messages(self, session_id: str) -> list[dict]:
        return self.load_messages_sync(session_id)

    async def save_messages(self, session_id: str, messages: list[dict]) -> None:
        self.save_messages_sync(session_id, messages)

    async def load_agent_messages(self, session_id: str) -> list[dict]:
        return self.load_agent_messages_sync(session_id)

    async def save_agent_messages(self, session_id: str, messages: list[dict]) -> None:
        self.save_agent_messages_sync(session_id, messages)

    async def load_messages_tail(self, session_id: str) -> dict | None:
        return self.load_messages_tail_sync(session_id)

    async def save_messages_tail(self, session_id: str, tail: dict) -> None:
        self.save_messages_tail_sync(session_id, tail)

    async def load_agent_state(self, session_id: str) -> dict | None:
        return self.load_agent_state_sync(session_id)

    async def save_agent_state(self, session_id: str, state: dict) -> None:
        self.save_agent_state_sync(session_id, state)

    async def delete_session(self, session_id: str) -> None:
        self.delete_session_sync(session_id)

    async def load_automation_tasks(self) -> list[dict]:
        return self.load_automation_tasks_sync()

    async def save_automation_tasks(self, tasks: list[dict]) -> None:
        self.save_automation_tasks_sync(tasks)

    async def load_mcp_state(self) -> dict:
        return self.load_mcp_state_sync()

    async def save_mcp_state(self, state: dict) -> None:
        self.save_mcp_state_sync(state)

    async def ping(self) -> bool:
        return True
