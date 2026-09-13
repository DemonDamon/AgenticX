#!/usr/bin/env python3
"""Serializable RunState for an in-flight ReActAgent run.

Unlike ``agenticx.runtime.checkpoint.AgentCheckpoint`` this type has no
Studio dependency. Write failures raise; they are never swallowed.

Author: Damon Li
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from agenticx.utils.agx_home import agx_home
from agenticx.utils.atomic_writer import atomic_write_json

RUN_STATE_SCHEMA_VERSION = 1
_PHASES = frozenset({"before_llm", "tools_dispatched", "completed", "interrupted"})


def _validate_session_id(session_id: str) -> str:
    value = str(session_id or "").strip()
    if (
        not value
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
        or ".." in value
    ):
        raise ValueError(f"invalid session_id: {session_id!r}")
    return value


@dataclass
class PendingCall:
    call_id: str
    tool_name: str
    arguments: dict[str, Any]
    canonical_key: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "PendingCall":
        return cls(
            call_id=str(raw.get("call_id", "") or ""),
            tool_name=str(raw.get("tool_name", "") or ""),
            arguments=dict(raw.get("arguments") or {}),
            canonical_key=str(raw.get("canonical_key", "") or ""),
        )


@dataclass
class RunState:
    """Serializable snapshot of an in-flight ReActAgent run."""

    run_id: str
    session_id: str
    schema_version: int = RUN_STATE_SCHEMA_VERSION
    query: str = ""
    messages: list[dict[str, Any]] = field(default_factory=list)
    iteration: int = 0
    phase: Literal["before_llm", "tools_dispatched", "completed", "interrupted"] = (
        "before_llm"
    )
    pending_calls: list[PendingCall] = field(default_factory=list)
    created_at: float = 0.0
    updated_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["pending_calls"] = [pc.to_dict() for pc in self.pending_calls]
        return payload

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "RunState":
        pending = [
            PendingCall.from_dict(item)
            for item in (raw.get("pending_calls") or [])
            if isinstance(item, dict)
        ]
        phase = str(raw.get("phase", "before_llm") or "before_llm")
        if phase not in _PHASES:
            phase = "before_llm"
        return cls(
            run_id=str(raw.get("run_id", "") or ""),
            session_id=str(raw.get("session_id", "") or ""),
            schema_version=int(
                raw.get("schema_version", RUN_STATE_SCHEMA_VERSION)
                or RUN_STATE_SCHEMA_VERSION
            ),
            query=str(raw.get("query", "") or ""),
            messages=list(raw.get("messages") or []),
            iteration=int(raw.get("iteration", 0) or 0),
            phase=phase,  # type: ignore[arg-type]
            pending_calls=pending,
            created_at=float(raw.get("created_at", 0.0) or 0.0),
            updated_at=float(raw.get("updated_at", 0.0) or 0.0),
        )


class RunStateStore:
    """File-backed RunState persistence (atomic replace, fail-closed)."""

    def __init__(self, session_id: str, *, root: str | Path | None = None) -> None:
        self.session_id = _validate_session_id(session_id)
        parent = Path(root) if root is not None else agx_home() / "sessions"
        self._dir = parent / self.session_id
        self._path = self._dir / "run_state.json"

    def save(self, state: RunState) -> None:
        """Atomically persist. RAISES on failure — never swallow.

        Unlike ``agenticx.runtime.checkpoint.CheckpointStore.save``, failures
        are not logged-and-ignored: a durability kernel that cannot write
        must not pretend the run is recoverable.
        """
        now = time.time()
        if not state.created_at:
            state.created_at = now
        state.updated_at = now
        self._dir.mkdir(parents=True, exist_ok=True)
        atomic_write_json(self._path, state.to_dict())

    def load(self) -> RunState | None:
        if not self._path.exists():
            return None
        data = json.loads(self._path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"invalid run state at {self._path}")
        version = int(data.get("schema_version", 1) or 1)
        if version > RUN_STATE_SCHEMA_VERSION:
            raise ValueError(
                f"unsupported run state schema_version={version} "
                f"(max {RUN_STATE_SCHEMA_VERSION})"
            )
        return RunState.from_dict(data)

    def clear(self) -> None:
        if self._path.exists():
            self._path.unlink()
