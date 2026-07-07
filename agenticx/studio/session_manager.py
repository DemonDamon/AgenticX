#!/usr/bin/env python3
"""Session manager for Studio service mode.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import re
import shutil
import time
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from agenticx.cli.config_manager import ConfigManager

_log = logging.getLogger(__name__)

DEFAULT_MAX_TASKSPACES = 20
MIN_MAX_TASKSPACES = 5
MAX_MAX_TASKSPACES = 100


def _resolve_max_taskspaces() -> int:
    raw = str(os.getenv("AGX_MAX_TASKSPACES", "")).strip()
    if not raw:
        try:
            global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
            project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
            merged = ConfigManager._deep_merge(global_data, project_data)
            cfg_val: Any = ConfigManager._get_nested(merged, "runtime.max_taskspaces")
        except Exception:
            cfg_val = None
        if cfg_val is not None:
            raw = str(cfg_val).strip()
    if not raw:
        raw = str(DEFAULT_MAX_TASKSPACES)
    try:
        value = int(raw)
    except ValueError:
        value = DEFAULT_MAX_TASKSPACES
    return max(MIN_MAX_TASKSPACES, min(MAX_MAX_TASKSPACES, value))

_THINK_BLOCK_RE = re.compile(
    r"<think>.*?</think>", re.IGNORECASE | re.DOTALL
)
_THINK_OPEN_TAIL_RE = re.compile(
    r"<think>.*\Z", re.IGNORECASE | re.DOTALL
)
_INTERRUPTED_PLACEHOLDER_MARKERS = ("（已中断）", "(已中断)")


def _visible_assistant_body(content: str) -> str:
    """Assistant text with <think> reasoning stripped (closed blocks AND an
    unclosed trailing <think>...). Mirrors desktop assistantBodyText so backend
    and frontend agree on whether a turn produced a real reply.
    """
    text = str(content or "")
    text = _THINK_BLOCK_RE.sub("", text)
    text = _THINK_OPEN_TAIL_RE.sub("", text)
    return text.strip()


def _messages_last_turn_has_completed_reply(messages: List[Dict[str, Any]]) -> bool:
    """Pure helper: whether the last user turn has a completed assistant reply."""
    if not messages:
        return False
    last_user_idx = -1
    for idx, msg in enumerate(messages):
        if str(msg.get("role", "")).strip() == "user":
            last_user_idx = idx
    if last_user_idx < 0:
        return False
    tail = messages[last_user_idx + 1 :]
    last_reply_idx = -1
    for idx, msg in enumerate(tail):
        if str(msg.get("role", "")).strip() != "assistant":
            continue
        content = str(msg.get("content", "") or "")
        visible = _visible_assistant_body(content)
        is_reply = bool(visible) and not any(
            marker in visible for marker in _INTERRUPTED_PLACEHOLDER_MARKERS
        )
        raw_sq = msg.get("suggested_questions")
        if isinstance(raw_sq, list) and any(str(x).strip() for x in raw_sq):
            is_reply = True
        if "</followups>" in content.lower():
            is_reply = True
        if is_reply:
            last_reply_idx = idx
    if last_reply_idx < 0:
        return False

    # A visible reply followed by a new assistant tool_calls message is only a
    # preamble; the turn kept running and has not truly completed yet.
    for msg in tail[last_reply_idx + 1 :]:
        if str(msg.get("role", "")).strip() != "assistant":
            continue
        tool_calls = msg.get("tool_calls")
        if isinstance(tool_calls, list) and tool_calls:
            return False
    return True


_REASONING_ACTION_INTENT_RE = re.compile(
    r"让我先|我先|接下来要|然后加载|然后调用|去读取|去加载|todo_write",
    re.IGNORECASE,
)
_DEFERRAL_BODY_RE = re.compile(r"我先|让我先|接下来|稍等|正在|马上")

# Explicit handoff / step-entry phrases that promise next-step work without doing it.
# Strict: short, declarative "I'm now starting X" patterns only — DO NOT add generic
# narrative connectors like 「接下来」 or 「下面」 alone, they appear in normal prose.
_HANDOFF_BODY_RE = re.compile(
    r"我现在进入第[一二三四五六七八九十0-9]+[项步阶段点]"  # 我现在进入第二项 / 第3步
    r"|现在开始(?:进行|优化|处理|执行|动手)"               # 现在开始优化
    r"|让我开始(?:进行|优化|处理|执行|动手)"                # 让我开始处理
    r"|我(?:现在)?去(?:读取|加载|执行|处理|优化|改|看)"     # 我现在去读取 / 我去看
    r"|我来(?:试试|看看|读取|加载|执行|改|优化)"            # 我来试试 / 我来优化
    r"|接下来我(?:就|来|去|会)(?:读取|执行|改|优化|开始)",  # 接下来我去执行
)

# Body length cap for path C — beyond this, treat the message as a real reply.
_HANDOFF_BODY_MAX_CHARS = 300


def _turn_has_any_tool_row(tail: List[Dict[str, Any]]) -> bool:
    """True if the messages after the last user include any role=tool row."""
    for msg in tail:
        if str(msg.get("role", "")).strip() == "tool":
            return True
    return False


def _extract_assistant_reasoning(content: str) -> str:
    text = str(content or "")
    match = _THINK_BLOCK_RE.search(text)
    if match:
        inner = match.group(0)
        return inner.replace("<think>", "").replace("</think>", "").strip()
    open_match = _THINK_OPEN_TAIL_RE.search(text)
    if open_match:
        return open_match.group(0).replace("<think>", "", 1).strip()
    return ""


def _messages_last_turn_promised_action_without_followthrough(
    messages: List[Dict[str, Any]],
) -> bool:
    """Assistant promised tool/file work in reasoning but ended without tool_calls."""
    if not messages:
        return False
    last_user_idx = -1
    for idx, msg in enumerate(messages):
        if str(msg.get("role", "")).strip() == "user":
            last_user_idx = idx
    if last_user_idx < 0:
        return False
    tail = messages[last_user_idx + 1 :]
    if not tail:
        return False
    last = tail[-1]
    if str(last.get("role", "")).strip() != "assistant":
        return False
    tool_calls = last.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        return False
    raw_sq = last.get("suggested_questions")
    if isinstance(raw_sq, list) and any(str(x).strip() for x in raw_sq):
        return False
    content = str(last.get("content", "") or "")
    if "</followups>" in content.lower():
        return False
    reasoning = _extract_assistant_reasoning(content)
    body = _visible_assistant_body(content)

    # Path A (existing): reasoning promises action + short / deferring body.
    if reasoning and _REASONING_ACTION_INTENT_RE.search(reasoning):
        if _DEFERRAL_BODY_RE.search(body) and len(body) < 220:
            return True
        if body and body.rstrip()[-1:] in {":", "：", ",", "，", ";", "；", "、", "—", "…"}:
            return True

    # Path B/C (new): explicit handoff in body, regardless of reasoning.
    # Requires no tool rows after the last user turn — already guarded above by
    # asserting the *last* message is assistant; but a deferred turn may still
    # have an earlier tool call in the same turn, so we tighten here.
    if body and _HANDOFF_BODY_RE.search(body) and len(body) < _HANDOFF_BODY_MAX_CHARS:
        if not _turn_has_any_tool_row(tail):
            return True

    return False


# Titles that should be replaced by the first real user message (case-insensitive ASCII).
_PLACEHOLDER_SESSION_TITLE_CF: frozenset[str] = frozenset(
    x.casefold()
    for x in (
        "微信会话",
        "微信对话",
        "微信聊天",
        "飞书会话",
        "飞书对话",
        "新对话",
        "新会话",
        "new chat",
        "new conversation",
    )
)

# One-shot flag in StudioSession.scratchpad: after first Meta assistant FINAL we may call LLM titling.
LLM_TITLE_SCRATCH_KEY = "__agx_llm_title_done__"

from agenticx.cli.studio import StudioSession
from agenticx.runtime.session_mode import (
    READ_FILES_SCRATCH_PREFIX,
    normalize_session_mode,
    is_code_dev,
    get_session_phase,
)


def _harness_list_fields(session: StudioSession) -> dict[str, Any]:
    if not is_code_dev(session):
        return {}
    scratch = getattr(session, "scratchpad", None) or {}
    read_count = 0
    if isinstance(scratch, dict):
        read_count = sum(1 for k in scratch if str(k).startswith(READ_FILES_SCRATCH_PREFIX))
    return {
        "harness_phase": get_session_phase(session),
        "read_files_count": read_count,
    }
from agenticx.memory.session_store import SessionStore, session_fts_enabled
from agenticx.runtime import AsyncClarifyGate, AsyncConfirmGate
from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext
from agenticx.utils.atomic_writer import atomic_write_json
from agenticx.studio.session_event_hub import SessionEventHub

EventEmitter = Callable[[Any], Awaitable[None]]
SummarySink = Callable[[str, SubAgentContext], Awaitable[None]]


def normalize_session_avatar_binding(avatar_id: Optional[str]) -> Optional[str]:
    """Collapse empty string to None so meta vs avatar-bound sessions compare consistently."""
    s = (avatar_id or "").strip()
    return s or None


def managed_session_binding_matches_avatar_query(
    managed: "ManagedSession",
    *,
    query_avatar_id: Optional[str],
) -> bool:
    """Enforce session isolation: Meta panes omit avatar_id (expect unbound); avatar panes must match."""
    stored = normalize_session_avatar_binding(managed.avatar_id)
    q = normalize_session_avatar_binding(query_avatar_id)
    if q is None:
        return stored is None
    return stored == q


@dataclass
class ManagedSession:
    session_id: str
    studio_session: StudioSession
    confirm_gate: AsyncConfirmGate = field(default_factory=AsyncConfirmGate)
    sub_confirm_gates: Dict[str, AsyncConfirmGate] = field(default_factory=dict)
    clarify_gate: AsyncClarifyGate = field(default_factory=AsyncClarifyGate)
    sub_clarify_gates: Dict[str, AsyncClarifyGate] = field(default_factory=dict)
    team_manager: Optional[AgentTeamManager] = None
    updated_at: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    avatar_id: Optional[str] = None
    avatar_name: Optional[str] = None
    session_name: Optional[str] = None
    pinned: bool = False
    archived: bool = False
    taskspaces: list[dict[str, str]] = field(default_factory=list)
    execution_state: str = "idle"  # idle | running | interrupted | failed
    event_hub: SessionEventHub | None = None

    def get_confirm_gate(self, agent_id: str = "meta") -> AsyncConfirmGate:
        if not agent_id or agent_id == "meta":
            return self.confirm_gate
        return self.sub_confirm_gates.setdefault(agent_id, AsyncConfirmGate())

    def get_clarify_gate(self, agent_id: str = "meta") -> AsyncClarifyGate:
        if not agent_id or agent_id == "meta":
            return self.clarify_gate
        return self.sub_clarify_gates.setdefault(agent_id, AsyncClarifyGate())

    def get_or_create_team(
        self,
        *,
        llm_factory: Callable[[], Any],
        event_emitter: Optional[EventEmitter] = None,
        summary_sink: Optional[SummarySink] = None,
    ) -> AgentTeamManager:
        if self.team_manager is None:
            self.team_manager = AgentTeamManager(
                llm_factory=llm_factory,
                base_session=self.studio_session,
                owner_session_id=self.session_id,
                event_emitter=event_emitter,
                summary_sink=summary_sink,
            )
        else:
            self.team_manager.llm_factory = llm_factory
            self.team_manager.base_session = self.studio_session
            self.team_manager.owner_session_id = self.session_id
            self.team_manager.event_emitter = event_emitter
            self.team_manager.summary_sink = summary_sink
        return self.team_manager


_PREVIEW_KIND_TEXT = "text"
_PREVIEW_KIND_MARKDOWN = "markdown"
_PREVIEW_KIND_CODE = "code"
_PREVIEW_KIND_IMAGE = "image"
_PREVIEW_KIND_PDF = "pdf"
_PREVIEW_KIND_OFFICE = "office"
_PREVIEW_KIND_BINARY = "binary"

_MARKDOWN_EXTS = frozenset({".md", ".markdown", ".mdx"})
_TEXT_EXTS = frozenset({".txt", ".csv", ".log", ".jsonl", ".ndjson"})
_CODE_EXTS = frozenset(
    {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        ".sh",
        ".bash",
        ".xml",
        ".html",
        ".css",
        ".rs",
    }
)
_IMAGE_EXTS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"})
_PDF_EXTS = frozenset({".pdf"})
_OFFICE_EXTS = frozenset({".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"})

_MIME_BY_EXT: dict[str, str] = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".mdx": "text/markdown",
    ".py": "text/x-python",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".js": "text/javascript",
    ".jsx": "text/javascript",
    ".json": "application/json",
    ".jsonl": "application/jsonl",
    ".ndjson": "application/x-ndjson",
    ".log": "text/plain",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".toml": "application/toml",
    ".sh": "text/x-shellscript",
    ".bash": "text/x-shellscript",
    ".rs": "text/rust",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def _guess_preview_mime(path: Path) -> str:
    ext = path.suffix.lower()
    mime, _encoding = mimetypes.guess_type(str(path))
    if mime:
        return mime
    return _MIME_BY_EXT.get(ext, "application/octet-stream")


def _guess_preview_kind(path: Path, mime_type: str) -> str:
    ext = path.suffix.lower()
    if ext in _MARKDOWN_EXTS or mime_type == "text/markdown":
        return _PREVIEW_KIND_MARKDOWN
    if ext in _TEXT_EXTS:
        return _PREVIEW_KIND_TEXT
    if ext in _CODE_EXTS:
        return _PREVIEW_KIND_CODE
    if ext in _IMAGE_EXTS or mime_type.startswith("image/"):
        return _PREVIEW_KIND_IMAGE
    if ext in _PDF_EXTS or mime_type == "application/pdf":
        return _PREVIEW_KIND_PDF
    if ext in _OFFICE_EXTS:
        return _PREVIEW_KIND_OFFICE
    if mime_type.startswith("text/"):
        return _PREVIEW_KIND_TEXT
    if mime_type in ("application/json", "application/xml", "application/javascript"):
        return _PREVIEW_KIND_CODE
    return _PREVIEW_KIND_BINARY


def _is_textual_preview_kind(kind: str) -> bool:
    return kind in (_PREVIEW_KIND_TEXT, _PREVIEW_KIND_MARKDOWN, _PREVIEW_KIND_CODE)


def classify_taskspace_file(path: Path) -> dict[str, Any]:
    """Classify a taskspace file for workspace preview (pure helper for tests/runtime)."""
    mime_type = _guess_preview_mime(path)
    preview_kind = _guess_preview_kind(path, mime_type)
    is_binary = not _is_textual_preview_kind(preview_kind)
    preview_supported = preview_kind in (
        _PREVIEW_KIND_TEXT,
        _PREVIEW_KIND_MARKDOWN,
        _PREVIEW_KIND_CODE,
        _PREVIEW_KIND_IMAGE,
    )
    return {
        "mime_type": mime_type,
        "preview_kind": preview_kind,
        "is_binary": is_binary,
        "preview_supported": preview_supported,
    }


class SessionManager:
    _META_TASKSPACE_SCOPE = "meta"

    def __init__(self, *, ttl_seconds: int = 3600) -> None:
        self.ttl_seconds = ttl_seconds
        self._sessions: Dict[str, ManagedSession] = {}
        self._interrupt_requests: set[str] = set()
        self._session_store = SessionStore()
        self._sessions_root = os.path.join(os.path.expanduser("~"), ".agenticx", "sessions")
        self._taskspaces_root = os.path.join(os.path.expanduser("~"), ".agenticx", "taskspaces")
        self._schedule_fts_backfill()

    def _taskspace_limit(self) -> int:
        return _resolve_max_taskspaces()

    def _schedule_fts_backfill(self) -> None:
        """Fire-and-forget: index historical messages.json files on first startup."""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            return
        if loop.is_running():
            loop.create_task(self._run_fts_backfill())

    async def _run_fts_backfill(self) -> None:
        try:
            result = await self._session_store.backfill_from_sessions_root(
                self._sessions_root, overwrite=False
            )
            if result.get("indexed", 0) > 0:
                _log.info("[session_fts] backfill: %s", result)
        except Exception as exc:
            _log.debug("[session_fts] backfill error (non-fatal): %s", exc)

    def create(
        self,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        *,
        session_id: Optional[str] = None,
    ) -> ManagedSession:
        sid = (session_id or "").strip() or str(uuid.uuid4())
        studio_session = StudioSession(provider_name=provider, model_name=model)
        self._restore_persisted_state(sid, studio_session)
        managed = ManagedSession(
            session_id=sid,
            studio_session=studio_session,
        )
        self._restore_managed_metadata(sid, managed)
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        self.align_meta_session_workspace(managed)
        self._sessions[sid] = managed
        return managed

    def get(self, session_id: str, *, touch: bool = False) -> Optional[ManagedSession]:
        managed = self._sessions.get(session_id)
        if managed is None and self._session_exists_in_persistence(session_id):
            managed = self.create(session_id=session_id)
        if managed is None:
            return None
        if touch:
            managed.updated_at = time.time()
        return managed

    def get_if_loaded(self, session_id: str) -> Optional[ManagedSession]:
        """Return the in-memory session without materializing it from persistence.

        Unlike ``get()``, never triggers ``create()`` for a session that has not
        been touched yet this process — used by callers (e.g. the background
        supervisor) that must scan every historical session but only care about
        ones already resident in memory, to avoid an O(n) full-disk restore.
        """
        return self._sessions.get(session_id)

    def session_scratchpad_flag(self, session_id: str, key: str) -> bool:
        """Cheap persisted scratchpad boolean lookup, without full session restore.

        A single indexed SQLite read (``scratchpad`` table, PK session_id+key)
        instead of the multi-file ``create()``/``_restore_persisted_state()``
        pipeline (messages, todos, agent_messages, context refs, taskspace
        sync). Used to pre-filter sessions before deciding whether the full
        materialization is actually needed.
        """
        sid = str(session_id or "").strip()
        if not sid:
            return False
        try:
            data = self._session_store._load_scratchpad_sync(sid)
        except Exception:
            return False
        from agenticx.runtime.scratchpad_utils import scratchpad_truthy

        return scratchpad_truthy(data.get(key))

    def touch(self, session_id: str) -> bool:
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        managed.updated_at = time.time()
        return True

    def persist(self, session_id: str) -> bool:
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        self._persist_session_state(session_id, managed.studio_session)
        return True

    async def persist_async(self, session_id: str) -> bool:
        """Persist session state off the asyncio event loop (SQLite + FTS + snapshots)."""
        from agenticx.studio.blocking_io import run_in_persist_pool

        return await run_in_persist_pool(self.persist, session_id)

    def set_execution_state(self, session_id: str, state: str) -> None:
        """Update execution_state for a session (idle | running | interrupted | failed)."""
        managed = self._sessions.get(session_id)
        if managed is not None:
            managed.execution_state = state
            managed.updated_at = time.time()
            if state in {"idle", "interrupted", "failed"}:
                self.clear_event_hub(session_id)

    def ensure_event_hub(self, session_id: str) -> SessionEventHub:
        managed = self.get(session_id, touch=False)
        if managed is None:
            raise KeyError(f"unknown session_id: {session_id}")
        hub = managed.event_hub
        if hub is None or hub.is_closed or hub.is_runtime_done:
            managed.event_hub = SessionEventHub(session_id)
        return managed.event_hub

    def get_event_hub(self, session_id: str) -> SessionEventHub | None:
        managed = self._sessions.get(session_id)
        if managed is None:
            return None
        hub = managed.event_hub
        if hub is None or hub.is_closed:
            return None
        return hub

    def clear_event_hub(self, session_id: str) -> None:
        managed = self._sessions.get(session_id)
        if managed is None:
            return
        hub = managed.event_hub
        if hub is not None:
            hub.close()
        managed.event_hub = None

    def _normalize_execution_state_for_listing(self, session_id: str, state: Any) -> str:
        """Normalize execution_state for session list display.

        Stale ``interrupted`` metadata (no active interrupt request, or the last
        user turn already has a completed assistant reply on disk) is shown as
        ``idle`` so the history badge does not contradict a finished answer.
        """
        raw = str(state or "idle").strip().lower()
        if raw not in {"idle", "running", "interrupted", "failed"}:
            raw = "idle"
        if self.should_interrupt(session_id):
            return "interrupted"
        # Fast path: a plain ``idle`` session always normalizes back to ``idle``
        # regardless of the on-disk last-turn check below (both the completed and
        # non-completed branches return ``idle`` when raw == "idle"). Short-circuit
        # here so session listing does NOT read the full messages.json for every
        # idle session — this was the dominant O(n) cold-start disk cost.
        if raw == "idle":
            return "idle"
        if raw == "running":
            # Stale ``running`` metadata (finalize persist lag, pane switch, or
            # hub-mode off-loop timing) must not keep the history spinner after the
            # turn already produced a terminal assistant payload (followups / SQ).
            if self._last_turn_has_terminal_assistant_reply(session_id):
                return "idle"
            # When the session is NOT live in this process (no in-memory runtime /
            # active stream), a ``running`` flag is necessarily stale disk residue
            # — there is nothing actually executing. Accept a plain visible reply
            # body as terminal so a finished-but-no-followups answer does not show
            # a permanent false spinner. Live in-memory sessions keep the strict
            # check above so a mid-turn (thinking-only partial, tools still running)
            # turn is never prematurely cleared.
            if self._sessions.get(session_id) is None and self._last_turn_has_completed_reply(
                session_id
            ):
                return "idle"
            return "running"
        if raw == "failed":
            return "failed"
        if self._last_turn_has_completed_reply(session_id):
            return "idle"
        if raw == "interrupted":
            return "idle"
        return raw

    def request_interrupt(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        if not sid:
            return False
        self._interrupt_requests.add(sid)
        return True

    def clear_interrupt(self, session_id: str) -> None:
        sid = str(session_id or "").strip()
        if sid:
            self._interrupt_requests.discard(sid)

    def should_interrupt(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        return bool(sid and sid in self._interrupt_requests)

    def _messages_for_execution_state_check(self, session_id: str) -> list[dict]:
        """Prefer in-memory chat_history so listing reflects a just-finished turn."""
        managed = self._sessions.get(session_id)
        if managed is not None:
            hist = getattr(managed.studio_session, "chat_history", None) or []
            if hist:
                return [m for m in hist if isinstance(m, dict)]
        try:
            return self._load_messages_snapshot(session_id)
        except Exception:
            return []

    def _last_turn_has_terminal_assistant_reply(self, session_id: str) -> bool:
        """True when the last user turn already has a terminal assistant message.

        Uses suggested_questions or a closed ``<followups>`` block so mid-turn
        incremental persists (thinking-only partial assistant) do not clear the
        running badge while tools are still executing.
        """
        try:
            messages = self._messages_for_execution_state_check(session_id)
        except Exception:
            return False
        if not messages:
            return False
        last_user_idx = -1
        for idx, msg in enumerate(messages):
            if str(msg.get("role", "")).strip() == "user":
                last_user_idx = idx
        if last_user_idx < 0:
            return False
        for msg in messages[last_user_idx + 1:]:
            if str(msg.get("role", "")).strip() != "assistant":
                continue
            raw_sq = msg.get("suggested_questions")
            if isinstance(raw_sq, list) and any(str(x).strip() for x in raw_sq):
                return True
            content = str(msg.get("content", "") or "")
            if "</followups>" in content.lower():
                return True
        return False

    def _last_turn_has_completed_reply(self, session_id: str) -> bool:
        """True when the persisted messages show the last user turn already
        produced a visible assistant reply (reasoning stripped), suggested_questions,
        or a closed ``</followups>`` terminal marker.

        Used at startup so a session left at ``running`` in metadata (e.g. the
        client SSE was aborted on a pane switch and the off-loop finalize persist
        never flushed ``idle``) is NOT mislabeled ``interrupted`` when its answer
        was in fact written to disk — that mismatch shows a completed reply under
        a stale "已中断" badge that only a restart used to surface.
        """
        try:
            messages = self._messages_for_execution_state_check(session_id)
        except Exception:
            return False
        return _messages_last_turn_has_completed_reply(messages)

    def scan_interrupted_sessions(self) -> list[str]:
        """Scan persisted sessions for those left in 'running' state.

        Called at startup to detect sessions that were interrupted by a crash.
        Marks them as 'interrupted' and returns their session IDs. Sessions whose
        last turn already has a completed assistant reply on disk are normalized
        to 'idle' instead — they finished, only the state flag lagged.
        """
        interrupted: list[str] = []
        for row in self._iter_running_session_rows_for_scan():
            sid = str(row.get("session_id", "")).strip()
            meta = row.get("metadata")
            if not isinstance(meta, dict):
                continue
            completed = self._last_turn_has_completed_reply(sid)
            next_state = "idle" if completed else "interrupted"
            if not completed:
                interrupted.append(sid)
            try:
                self._session_store._save_session_summary_sync(
                    sid,
                    str(row.get("summary", "")),
                    {**meta, "execution_state": next_state},
                )
            except Exception:
                pass
        if interrupted:
            _log.info("Found %d interrupted sessions on startup: %s", len(interrupted), interrupted[:5])
        return interrupted

    def _iter_running_session_rows_for_scan(self) -> list[dict]:
        try:
            rows = self._session_store._list_latest_sessions_sync(limit=0)
        except Exception:
            return []
        out: list[dict] = []
        for row in rows:
            if not str(row.get("session_id", "")).strip():
                continue
            meta = row.get("metadata")
            if not isinstance(meta, dict):
                continue
            if str(meta.get("execution_state", "idle")).strip() == "running":
                out.append(row)
        return out

    def incremental_persist(self, session_id: str) -> bool:
        """Lightweight mid-turn persist: only flush messages + agent_messages.

        Skips SQLite summary / FTS / context-refs to minimize I/O overhead
        during active tool loops.  Called by AgentRuntime between tool calls
        to guard against crash data loss.
        """
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        session = managed.studio_session
        try:
            self._save_messages_snapshot(session_id, session.chat_history or [])
            self._save_agent_messages_snapshot(
                session_id, getattr(session, "agent_messages", None) or [],
            )
        except Exception:
            _log.debug("incremental_persist failed for %s (non-fatal)", session_id)
            return False
        return True

    @staticmethod
    def _close_mcp_hub_sync(managed: ManagedSession) -> None:
        """No-op: MCP children are now process-level resources owned by GlobalMcpManager.
        They are closed once at server shutdown via GlobalMcpManager.close_all()."""

    def delete(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        self._interrupt_requests.discard(sid)
        existed_in_persistence = self._session_exists_in_persistence(sid)
        managed = self._sessions.pop(sid, None)
        if managed is not None:
            if managed.event_hub is not None:
                managed.event_hub.close()
                managed.event_hub = None
            if managed.team_manager is not None:
                managed.team_manager.shutdown_now()
            # MCP hub is global; do NOT kill child processes on session delete.
        purged = self._purge_session_state(sid)
        if managed is not None and not existed_in_persistence:
            return True
        return purged and existed_in_persistence

    def list_sessions(self, avatar_id: str | None = None) -> list[dict]:
        """List sessions, optionally filtered by avatar_id."""
        result = []
        seen_session_ids: set[str] = set()
        for sid, managed in self._sessions.items():
            if getattr(managed, "archived", False):
                continue
            if avatar_id and getattr(managed, "avatar_id", None) != avatar_id:
                continue
            hist = getattr(managed.studio_session, "chat_history", None) or []
            # Lazy-create UX: hide memory-only shells until the user sends at least one message.
            if not self._session_has_listable_chat_history(hist):
                continue
            seen_session_ids.add(sid)
            result.append({
                "session_id": sid,
                "avatar_id": getattr(managed, "avatar_id", None),
                "avatar_name": getattr(managed, "avatar_name", None),
                "session_name": getattr(managed, "session_name", None),
                "updated_at": managed.updated_at,
                "created_at": getattr(managed, "created_at", managed.updated_at),
                "pinned": bool(getattr(managed, "pinned", False)),
                "archived": bool(getattr(managed, "archived", False)),
                "execution_state": self._normalize_execution_state_for_listing(
                    sid, getattr(managed, "execution_state", "idle")
                ),
                "provider": str(getattr(managed.studio_session, "provider_name", "") or ""),
                "model": str(getattr(managed.studio_session, "model_name", "") or ""),
                "session_mode": normalize_session_mode(
                    getattr(managed.studio_session, "session_mode", None)
                ),
                **_harness_list_fields(managed.studio_session),
            })
        for row in self._list_persisted_sessions():
            sid = str(row.get("session_id", "")).strip()
            if not sid or sid in seen_session_ids:
                continue
            if row.get("archived"):
                continue
            if avatar_id and row.get("avatar_id") != avatar_id:
                continue
            row["execution_state"] = self._normalize_execution_state_for_listing(
                sid, row.get("execution_state", "idle")
            )
            result.append(row)
            seen_session_ids.add(sid)
        if result:
            session_ids = [
                str(row.get("session_id", "")).strip()
                for row in result
                if str(row.get("session_id", "")).strip()
            ]
            indexed_message_ts = self._session_store._max_message_timestamps_sync(session_ids)
            summary_activity_ts = self._session_store._recover_activity_from_summaries_bulk_sync(
                session_ids
            )
            for row in result:
                sid = str(row.get("session_id", "")).strip()
                managed = self._sessions.get(sid)
                chat_history = (
                    getattr(managed.studio_session, "chat_history", None) if managed else None
                )
                row_indexed_ts = float(indexed_message_ts.get(sid, 0) or 0)
                row_summary_ts = float(summary_activity_ts.get(sid, 0) or 0)
                disk_message_ts = 0.0
                # Only fall back to a per-file messages.json read when neither the
                # batched FTS index nor the summary store supplied an activity
                # timestamp. When indexed_message_ts is present it equals the same
                # max message timestamp a disk read would derive, so this preserves
                # `_resolve_list_activity_at`'s result while removing the dominant
                # O(n) cold-start disk I/O (see FR-2 profile).
                if managed is None and row_indexed_ts <= 0 and row_summary_ts <= 0:
                    disk_message_ts = self._last_message_activity_from_disk(sid)
                row["updated_at"] = self._resolve_list_activity_at(
                    chat_history=chat_history,
                    metadata_updated_at=float(row.get("updated_at") or 0),
                    metadata_created_at=float(row.get("created_at") or 0),
                    indexed_message_ts=row_indexed_ts,
                    metadata_last_activity_at=float(row.get("last_activity_at") or 0),
                    disk_message_ts=disk_message_ts,
                    summary_activity_ts=row_summary_ts,
                    live_touch_at=float(managed.updated_at) if managed is not None else 0.0,
                )
        result.sort(
            key=lambda row: (
                1 if row.get("pinned") else 0,
                float(row.get("updated_at", 0)),
            ),
            reverse=True,
        )
        return result

    @staticmethod
    def _snippet_around_query(content: str, query: str, max_len: int = 140) -> str:
        c = str(content or "")
        q = (query or "").strip()
        if not c:
            return ""
        if not q:
            return (c[:max_len] + "…") if len(c) > max_len else c
        try:
            lower_c = c.casefold()
            lower_q = q.casefold()
        except Exception:
            lower_c = c.lower()
            lower_q = q.lower()
        idx = lower_c.find(lower_q)
        if idx < 0:
            return (c[:max_len] + "…") if len(c) > max_len else c
        start = max(0, idx - 36)
        end = min(len(c), idx + max_len)
        frag = c[start:end]
        if start > 0:
            frag = "…" + frag
        if end < len(c):
            frag = frag + "…"
        return frag

    def search_sessions_by_message_text(
        self,
        query: str,
        *,
        avatar_id: Optional[str] = None,
        limit_sessions: int = 50,
    ) -> list[dict[str, Any]]:
        """Return session_id + snippet for sessions whose messages match query (FTS, then LIKE)."""
        q = str(query or "").strip()
        if not q:
            return []
        rows = self.list_sessions(avatar_id=avatar_id)
        allowed = frozenset(
            str(r["session_id"]).strip()
            for r in rows
            if r.get("session_id") and str(r["session_id"]).strip()
        )
        if not allowed:
            return []
        lim = max(1, min(int(limit_sessions), 100))
        store = self._session_store
        by_sid: dict[str, str] = {}

        if session_fts_enabled():
            try:
                fts_hits = store._search_session_messages_sync(q, None, limit=400)
            except Exception:
                fts_hits = []
            for hit in fts_hits:
                sid = str(hit.get("session_id") or "").strip()
                if sid not in allowed or sid in by_sid:
                    continue
                snip = str(hit.get("snippet") or "").strip()
                if not snip:
                    prev = str(hit.get("content_preview") or "")
                    snip = (prev[:120] + "…") if len(prev) > 120 else prev
                by_sid[sid] = snip or "…"
                if len(by_sid) >= lim:
                    return [{"session_id": k, "snippet": v} for k, v in by_sid.items()]

        if len(by_sid) < lim:
            try:
                like_hits = store._search_session_messages_like_sync(q, allowed, limit=400)
            except Exception:
                like_hits = []
            for hit in like_hits:
                sid = str(hit.get("session_id") or "").strip()
                if sid not in allowed or sid in by_sid:
                    continue
                body = str(hit.get("content") or "")
                by_sid[sid] = self._snippet_around_query(body, q)
                if len(by_sid) >= lim:
                    break

        return [{"session_id": k, "snippet": v} for k, v in by_sid.items()]

    def rename_session(self, session_id: str, name: str) -> bool:
        """Rename an existing session. Returns True if found and renamed."""
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        managed.session_name = name
        managed.updated_at = time.time()
        self._persist_session_state(session_id, managed.studio_session)
        return True

    def set_session_model(
        self,
        session_id: str,
        *,
        provider: Optional[str],
        model: Optional[str],
    ) -> bool:
        """Update the session's active LLM provider/model and persist to disk.

        Triggered by the desktop model-picker so a session's last-used model
        survives app restarts (the UI re-applies it via list_sessions()).
        Returns True if the session exists (either in memory or persistence).
        """
        sid = str(session_id or "").strip()
        if not sid:
            return False
        managed = self.get(sid)
        if managed is None:
            return False
        prov_clean = str(provider or "").strip()
        model_clean = str(model or "").strip()
        managed.studio_session.provider_name = prov_clean
        managed.studio_session.model_name = model_clean
        managed.updated_at = time.time()
        self._persist_session_state(sid, managed.studio_session)
        return True

    @staticmethod
    def session_title_needs_auto_fill(name: Optional[str]) -> bool:
        """True if missing or a generic IM/new-chat placeholder."""
        raw = str(name or "").strip()
        if not raw:
            return True
        key = raw.casefold()
        if key in _PLACEHOLDER_SESSION_TITLE_CF:
            return True
        if key.startswith("新会话") or key.startswith("新对话"):
            return True
        if key.startswith("new session") or key.startswith("new chat"):
            return True
        return False

    def auto_title_session(self, session_id: str, first_user_message: str) -> bool:
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        if not self.session_title_needs_auto_fill(managed.session_name):
            return False
        title = self._build_auto_title(first_user_message)
        if not title:
            return False
        managed.session_name = title
        managed.updated_at = time.time()
        self._persist_session_state(session_id, managed.studio_session)
        return True

    @staticmethod
    def _text_from_chat_history_item(item: Any) -> str:
        if not isinstance(item, dict):
            return ""
        raw = item.get("content")
        if isinstance(raw, str):
            return raw.strip()
        if isinstance(raw, list):
            parts: list[str] = []
            for block in raw:
                if isinstance(block, dict) and str(block.get("type") or "") == "text":
                    parts.append(str(block.get("text") or ""))
            return "".join(parts).strip()
        return ""

    def session_has_user_and_assistant_for_llm_title(self, session: StudioSession) -> bool:
        hist = getattr(session, "chat_history", None) or []
        has_user = False
        has_asst = False
        for item in hist:
            role = str(item.get("role") or "")
            text = self._text_from_chat_history_item(item)
            if not text:
                continue
            if role == "user":
                has_user = True
            elif role == "assistant":
                has_asst = True
        return has_user and has_asst

    def claim_llm_title_slot(self, session_id: str, snapshot_session_name: str) -> bool:
        """Reserve one-shot LLM title upgrade; returns True if background job should run."""
        sid = str(session_id or "").strip()
        if not sid:
            return False
        managed = self._sessions.get(sid)
        if managed is None:
            return False
        session = managed.studio_session
        sp = session.scratchpad
        if not isinstance(sp, dict):
            session.scratchpad = {}
            sp = session.scratchpad
        if sp.get(LLM_TITLE_SCRATCH_KEY):
            return False
        if not self.session_has_user_and_assistant_for_llm_title(session):
            return False
        cur = str(managed.session_name or "").strip()
        snap = str(snapshot_session_name or "").strip()
        if snap and cur != snap:
            return False
        sp[LLM_TITLE_SCRATCH_KEY] = True
        self._persist_session_state(sid, session)
        return True

    @staticmethod
    def _sanitize_llm_session_title(raw: Any) -> str | None:
        s = str(raw or "").strip()
        if not s:
            return None
        s = s.splitlines()[0].strip()
        for ch in ('"', "'", "「", "」", "『", "』", "《", "》"):
            s = s.replace(ch, "")
        s = s.strip(" \t.:：。；;，,")
        if len(s) > 40:
            s = s[:40].rstrip()
        return s or None

    def apply_llm_suggested_session_title(self, session_id: str, raw_title: str | None) -> None:
        sid = str(session_id or "").strip()
        if not sid:
            return
        cleaned = self._sanitize_llm_session_title(raw_title)
        if cleaned:
            self.rename_session(sid, cleaned)
        else:
            self.persist(sid)

    def pin_session(self, session_id: str, pinned: bool) -> bool:
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        managed.pinned = bool(pinned)
        managed.updated_at = time.time()
        self._persist_session_state(session_id, managed.studio_session)
        return True

    def fork_session(self, session_id: str) -> Optional[ManagedSession]:
        source = self._sessions.get(session_id)
        if source is None:
            return None
        forked = self.create(
            provider=source.studio_session.provider_name,
            model=source.studio_session.model_name,
        )
        forked.avatar_id = source.avatar_id
        forked.avatar_name = source.avatar_name
        forked.session_name = self._build_fork_name(source.session_name)
        forked.studio_session.workspace_dir = source.studio_session.workspace_dir
        forked.studio_session.chat_history = deepcopy(source.studio_session.chat_history or [])
        forked.studio_session.agent_messages = deepcopy(getattr(source.studio_session, "agent_messages", []) or [])
        forked.studio_session.context_files = deepcopy(source.studio_session.context_files or {})
        forked.studio_session.scratchpad = deepcopy(source.studio_session.scratchpad or {})
        forked.studio_session.artifacts = deepcopy(source.studio_session.artifacts or {})
        forked.updated_at = time.time()
        self._persist_session_state(forked.session_id, forked.studio_session)
        return forked

    def archive_sessions_before(self, session_id: str, avatar_id: str | None = None) -> int:
        target = self._sessions.get(session_id)
        if target is None:
            return -1
        target_avatar = avatar_id if avatar_id is not None else target.avatar_id
        target_updated_at = float(target.updated_at)
        archived_count = 0
        for sid, managed in self._sessions.items():
            if sid == session_id:
                continue
            if managed.archived:
                continue
            if managed.avatar_id != target_avatar:
                continue
            if float(managed.updated_at) < target_updated_at:
                managed.archived = True
                managed.updated_at = time.time()
                self._persist_session_state(sid, managed.studio_session)
                archived_count += 1
        return archived_count

    def get_messages(self, session_id: str) -> list[dict]:
        """Return normalized chat messages for session."""
        raw = self._get_raw_messages_list(session_id)
        return self._normalize_messages(raw)

    def _get_raw_messages_list(self, session_id: str) -> list[dict]:
        """Return raw chat_history rows before normalization."""
        managed = self._sessions.get(session_id)
        if managed is not None:
            raw = getattr(managed.studio_session, "chat_history", []) or []
        else:
            raw = self._load_messages_snapshot(session_id)
        return [item for item in raw if isinstance(item, dict)]

    @staticmethod
    def _tail_start_index_for_rounds(raw: list[dict], tail_rounds: int) -> int:
        """Index of the earliest message included in the last *tail_rounds* user turns."""
        if not raw:
            return 0
        n = max(1, int(tail_rounds))
        user_seen = 0
        for idx in range(len(raw) - 1, -1, -1):
            role = str(raw[idx].get("role", "assistant"))
            if role != "user":
                continue
            user_seen += 1
            if user_seen >= n:
                return idx
        return 0

    @staticmethod
    def _last_user_index(raw: list[dict]) -> int:
        last = -1
        for idx, item in enumerate(raw):
            if str(item.get("role", "")).strip() == "user":
                last = idx
        return last

    @staticmethod
    def _apply_tail_message_limit(
        window: list[dict],
        abs_start: int,
        total_count: int,
        tail_limit: int | None,
        *,
        full_raw: list[dict] | None = None,
        round_anchor_abs: int | None = None,
        last_user_abs_index: int = -1,
    ) -> tuple[list[dict], int]:
        if not tail_limit or len(window) <= tail_limit:
            out_start = abs_start
            out_window = window
        else:
            trimmed = window[-max(1, int(tail_limit)) :]
            out_start = max(0, total_count - len(trimmed))
            out_window = trimmed

        # tail_limit must not drop the last user turn (or tail_rounds anchor) —
        # otherwise desktop stall detection reads "no completed reply" on an
        # idle session and loops futile resume cards after session switch.
        anchor = out_start
        if round_anchor_abs is not None:
            anchor = min(anchor, max(0, int(round_anchor_abs)))
        if last_user_abs_index >= 0:
            anchor = min(anchor, last_user_abs_index)
        if anchor < out_start and full_raw is not None:
            out_start = anchor
            out_window = full_raw[out_start:]
        return out_window, out_start

    def get_messages_page(
        self,
        session_id: str,
        *,
        tail_rounds: int | None = None,
        before_index: int | None = None,
        limit: int = 20,
        tail_limit: int | None = None,
    ) -> dict[str, Any]:
        """Return a normalized message window with pagination metadata."""
        if tail_rounds is not None:
            meta = self._load_messages_tail_snapshot(session_id)
            if meta is not None:
                raw_full = self._get_raw_messages_list(session_id)
                last_user = self._last_user_index(raw_full)
                raw_tail = meta["messages"]
                total_count = int(meta["total_count"])
                base_index = int(meta["start_index"])
                rel_start = self._tail_start_index_for_rounds(raw_tail, tail_rounds)
                window = raw_tail[rel_start:]
                abs_start = base_index + rel_start
                window, abs_start = self._apply_tail_message_limit(
                    window,
                    abs_start,
                    total_count,
                    tail_limit,
                    full_raw=raw_full,
                    round_anchor_abs=abs_start,
                    last_user_abs_index=last_user,
                )
                return {
                    "messages": self._normalize_messages(window),
                    "start_index": abs_start,
                    "total_count": total_count,
                    "has_older": abs_start > 0,
                }

        raw = self._get_raw_messages_list(session_id)
        total_count = len(raw)
        last_user = self._last_user_index(raw)

        if tail_rounds is not None:
            start_index = self._tail_start_index_for_rounds(raw, tail_rounds)
            window = raw[start_index:]
            window, start_index = self._apply_tail_message_limit(
                window,
                start_index,
                total_count,
                tail_limit,
                full_raw=raw,
                round_anchor_abs=start_index,
                last_user_abs_index=last_user,
            )
            self._ensure_messages_tail_snapshot(session_id, raw)
        elif before_index is not None:
            end_index = max(0, min(int(before_index), total_count))
            page_limit = max(1, min(int(limit), 100))
            start_index = max(0, end_index - page_limit)
            window = raw[start_index:end_index]
            self._diagnose_page_source(
                session_id,
                requested_before_index=int(before_index),
                in_memory=self._sessions.get(session_id) is not None,
                raw=raw,
                window=window,
                window_start=start_index,
            )
        else:
            start_index = 0
            window = raw

        return {
            "messages": self._normalize_messages(window),
            "start_index": start_index,
            "total_count": total_count,
            "has_older": start_index > 0,
        }

    def _diagnose_page_source(
        self,
        session_id: str,
        *,
        requested_before_index: int,
        in_memory: bool,
        raw: list[dict],
        window: list[dict],
        window_start: int,
    ) -> None:
        """One-shot diagnostic: detect cross-session contamination on scroll-up.

        Compares the served before_index window against the on-disk messages.json
        for the SAME session. Any window row whose (role, content-prefix) does not
        appear on disk is a candidate "leaked" row (in-memory source diverged from
        the persisted file). Logs role/content fingerprints so we can confirm
        whether the leak originates from in-memory chat_history or the snapshot.

        Diagnostic only -- no behavior change. Remove once root cause is confirmed.
        """
        try:
            disk_rows = self._load_messages_snapshot(session_id)
            disk_keys: dict[str, int] = {}
            for item in disk_rows:
                if not isinstance(item, dict):
                    continue
                role = str(item.get("role", "")).strip()
                content = str(item.get("content", "")).strip()[:160]
                key = f"{role}::{content}"
                disk_keys[key] = disk_keys.get(key, 0) + 1

            leaked: list[dict[str, Any]] = []
            for offset, item in enumerate(window):
                if not isinstance(item, dict):
                    continue
                role = str(item.get("role", "")).strip()
                content = str(item.get("content", "")).strip()[:160]
                key = f"{role}::{content}"
                if disk_keys.get(key, 0) > 0:
                    disk_keys[key] -= 1
                    continue
                leaked.append(
                    {
                        "abs_index": window_start + offset,
                        "role": role,
                        "content_prefix": content[:80],
                    }
                )

            _log.warning(
                "[page-diag] session=%s before_index=%d in_memory=%s "
                "raw_len=%d disk_len=%d window_len=%d leaked_rows=%d",
                session_id,
                requested_before_index,
                in_memory,
                len(raw),
                len(disk_rows),
                len(window),
                len(leaked),
            )
            if leaked:
                _log.warning(
                    "[page-diag] session=%s LEAK candidates (in-memory has rows "
                    "absent from messages.json): %s",
                    session_id,
                    leaked[:8],
                )
        except Exception as exc:  # pragma: no cover - diagnostic must never break paging
            _log.warning("[page-diag] session=%s diagnostic failed: %s", session_id, exc)

    def _ensure_messages_tail_snapshot(self, session_id: str, raw: list[dict]) -> None:
        if not raw:
            return
        if os.path.exists(self._messages_tail_path(session_id)):
            return
        self._save_messages_tail_snapshot(session_id, raw)

    def list_taskspaces(self, session_id: str) -> list[dict[str, str]]:
        managed = self.get(session_id, touch=False)
        if managed is None:
            return []
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        return [dict(item) for item in managed.taskspaces]

    def add_taskspace(
        self,
        session_id: str,
        *,
        path: str | None = None,
        label: str | None = None,
    ) -> dict[str, str]:
        managed = self.get(session_id, touch=False)
        if managed is None:
            raise KeyError("session not found")
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        scope_key = self._taskspace_scope_key_for_managed(managed)
        default_taskspace = self._get_taskspace(managed, "default")
        resolved_path = (
            self._resolve_taskspace_path(path)
            if path and str(path).strip()
            else str(Path(default_taskspace["path"]).resolve(strict=False))
        )
        for item in managed.taskspaces:
            if item.get("path") == resolved_path:
                return dict(item)
        globals_rows = self._load_global_taskspaces(scope_key=scope_key)
        limit = self._taskspace_limit()
        if len(globals_rows) >= max(0, limit - 1):
            raise ValueError(f"taskspace limit reached ({limit})")
        clean_label = (label or "").strip() or Path(resolved_path).name or "taskspace"
        taskspace = {
            "id": f"ts-{uuid.uuid4().hex[:8]}",
            "label": clean_label,
            "path": resolved_path,
        }
        globals_rows.append(taskspace)
        self._save_global_taskspaces(globals_rows, scope_key=scope_key)
        self._sync_all_sessions_from_global(scope_key=scope_key)
        for sid, each in self._sessions.items():
            if self._taskspace_scope_key_for_managed(each) != scope_key:
                continue
            # Persist the new taskspace list but do NOT bump updated_at: workspace
            # mutations are scope-level config changes, not session activity. Touching
            # updated_at here would bulk-pollute Today bucketing for all sibling
            # sessions (see plan 2026-05-28-near-history-bucket-taskspace-pollution).
            self._persist_session_state(sid, each.studio_session)
        return dict(taskspace)

    def remove_taskspace(self, session_id: str, taskspace_id: str) -> bool:
        managed = self.get(session_id, touch=False)
        if managed is None:
            return False
        if str(taskspace_id).strip() == "default":
            return False
        scope_key = self._taskspace_scope_key_for_managed(managed)
        globals_rows = self._load_global_taskspaces(scope_key=scope_key)
        before = len(globals_rows)
        globals_rows = [item for item in globals_rows if item.get("id") != taskspace_id]
        if len(globals_rows) == before:
            return False
        self._save_global_taskspaces(globals_rows, scope_key=scope_key)
        self._sync_all_sessions_from_global(scope_key=scope_key)
        for sid, each in self._sessions.items():
            if self._taskspace_scope_key_for_managed(each) != scope_key:
                continue
            # See add_taskspace: workspace mutation must not bump updated_at,
            # otherwise every sibling session would be shoved into Today.
            self._persist_session_state(sid, each.studio_session)
        return True

    def list_taskspace_files(
        self,
        session_id: str,
        taskspace_id: str,
        rel_path: str = ".",
    ) -> list[dict[str, Any]]:
        managed = self.get(session_id, touch=False)
        if managed is None:
            raise KeyError("session not found")
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        taskspace = self._get_taskspace(managed, taskspace_id)
        if taskspace is None:
            raise KeyError("taskspace not found")
        root = Path(taskspace["path"]).expanduser().resolve(strict=False)
        target = self._resolve_inside_root(root, rel_path, expect_dir=True)
        rows: list[dict[str, Any]] = []
        for entry in sorted(target.iterdir(), key=lambda p: (0 if p.is_dir() else 1, p.name.lower())):
            stat = entry.stat()
            rows.append(
                {
                    "name": entry.name,
                    "type": "dir" if entry.is_dir() else "file",
                    "path": str(entry.relative_to(root)),
                    "size": int(stat.st_size),
                    "modified": float(stat.st_mtime),
                }
            )
        return rows

    def read_taskspace_file(
        self,
        session_id: str,
        taskspace_id: str,
        rel_path: str,
        *,
        max_bytes: int = 512 * 1024,
    ) -> dict[str, Any]:
        managed = self.get(session_id, touch=False)
        if managed is None:
            raise KeyError("session not found")
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        taskspace = self._get_taskspace(managed, taskspace_id)
        if taskspace is None:
            raise KeyError("taskspace not found")
        root = Path(taskspace["path"]).expanduser().resolve(strict=False)
        target = self._resolve_inside_root(root, rel_path, expect_dir=False)
        if target.is_dir():
            raise IsADirectoryError(str(target))
        size = int(target.stat().st_size)
        classification = classify_taskspace_file(target)
        result: dict[str, Any] = {
            "name": target.name,
            "path": str(target.relative_to(root)),
            "absolute_path": str(target),
            "size": size,
            **classification,
        }
        if _is_textual_preview_kind(str(classification["preview_kind"])):
            data = target.read_bytes()
            truncated = False
            if len(data) > max_bytes:
                data = data[:max_bytes]
                truncated = True
            result["content"] = data.decode("utf-8", errors="replace")
            result["truncated"] = truncated
        else:
            result["truncated"] = False
        return result

    def cleanup_expired(self) -> None:
        now = time.time()
        expired = [
            sid
            for sid, session in self._sessions.items()
            if (now - session.updated_at) > self.ttl_seconds
        ]
        for sid in expired:
            managed = self._sessions.get(sid)
            if managed is None:
                self._sessions.pop(sid, None)
                continue
            # Persist BEFORE removing from _sessions so _persist_session_state
            # can still look up the managed ref via self._sessions.get(sid) and
            # write all metadata fields (session_name, avatar_id, etc.) correctly.
            self._persist_session_state(sid, managed.studio_session)
            self._sessions.pop(sid, None)
            if managed.team_manager is not None:
                managed.team_manager.shutdown_now()
            # MCP hub is global; do NOT kill child processes on session cleanup.

    def _restore_persisted_state(self, session_id: str, session: StudioSession) -> None:
        try:
            metadata = self._session_store._load_latest_session_metadata_sync(session_id)
            if isinstance(metadata, dict) and "session_mode" in metadata:
                session.session_mode = normalize_session_mode(str(metadata.get("session_mode")))
        except Exception:
            pass
        try:
            todos = self._session_store._load_todos_sync(session_id)
            if todos:
                session.todo_manager.load_payload(todos)
            scratchpad = self._session_store._load_scratchpad_sync(session_id)
            if scratchpad:
                from agenticx.runtime.scratchpad_utils import normalize_scratchpad_loaded

                session.scratchpad = normalize_scratchpad_loaded(dict(scratchpad))
            messages = self._load_messages_snapshot(session_id)
            if messages:
                from agenticx.studio.chat_attachments import (
                    materialize_message_lists_image_uploads,
                )

                if materialize_message_lists_image_uploads(session_id, [messages]):
                    try:
                        atomic_write_json(self._messages_path(session_id), messages)
                    except Exception:
                        pass
                session.chat_history = self._normalize_messages(messages)
        except Exception:
            pass

        try:
            raw = self._load_agent_messages_snapshot(session_id)
            if raw:
                from agenticx.runtime.agent_runtime import _sanitize_context_messages
                from agenticx.studio.chat_attachments import (
                    materialize_message_lists_image_uploads,
                    sync_agent_messages_attachments_from_chat_history,
                )

                materialize_message_lists_image_uploads(session_id, [raw])
                sync_agent_messages_attachments_from_chat_history(
                    raw, getattr(session, "chat_history", None) or []
                )
                session.agent_messages = _sanitize_context_messages(raw)
        except Exception:
            pass

        try:
            self._load_context_refs(session_id, session)
        except Exception:
            pass

    def _restore_managed_metadata(self, session_id: str, managed: ManagedSession) -> None:
        try:
            metadata = self._session_store._load_latest_session_metadata_sync(session_id)
        except Exception:
            metadata = {}
        if not isinstance(metadata, dict):
            return
        raw_name = metadata.get("session_name")
        if raw_name is not None:
            session_name = str(raw_name).strip()
            if session_name and session_name != "None":
                managed.session_name = session_name
        # Last resort: if DB history also had no valid name, derive from chat_history
        # which was already loaded by _restore_persisted_state before this method.
        if self.session_title_needs_auto_fill(managed.session_name):
            first = self._first_user_text_from_chat_history(
                getattr(managed.studio_session, "chat_history", None) or []
            )
            if first:
                managed.session_name = self._build_auto_title(first)
        managed.created_at = self._to_float(metadata.get("created_at"), managed.created_at)
        # Restore last-activity timestamp from persisted metadata so the desktop
        # history panel can correctly bucket sessions into Today / Previous 7 days
        # after restart or on-demand reload. Without this, ManagedSession defaults
        # to time.time() and every loaded session looks like it was just active.
        restored_updated_at = self._to_float(metadata.get("updated_at"), 0.0)
        if restored_updated_at > 0:
            managed.updated_at = restored_updated_at
        elif managed.created_at > 0:
            managed.updated_at = managed.created_at
        managed.pinned = bool(metadata.get("pinned", False))
        managed.archived = bool(metadata.get("archived", False))
        managed.taskspaces = self._sanitize_taskspaces(session_id, metadata.get("taskspaces"))

        if "avatar_id" in metadata:
            raw_av = metadata.get("avatar_id")
            managed.avatar_id = (
                None if raw_av is None else normalize_session_avatar_binding(str(raw_av))
            )
        if "avatar_name" in metadata:
            raw_name = metadata.get("avatar_name")
            managed.avatar_name = (
                None if raw_name is None else (str(raw_name).strip() or None)
            )
        if "execution_state" in metadata:
            raw_state = str(metadata.get("execution_state", "idle")).strip().lower()
            if raw_state in ("idle", "running", "interrupted", "failed"):
                managed.execution_state = raw_state
            else:
                managed.execution_state = "idle"
        if "session_mode" in metadata:
            managed.studio_session.session_mode = normalize_session_mode(
                str(metadata.get("session_mode"))
            )

    def _persist_session_state(self, session_id: str, session: StudioSession) -> None:
        self._ensure_session_title_from_chat_history(session_id, session)
        try:
            todos = session.todo_manager.to_payload()
            scratchpad = dict(getattr(session, "scratchpad", {}) or {})
            self._session_store._save_todos_sync(session_id, todos)
            self._session_store._save_scratchpad_sync(session_id, scratchpad)
            summary = self._build_session_summary(session)
            managed_ref = self._sessions.get(session_id)
            metadata_updated_at = float(getattr(managed_ref, "updated_at", time.time()) or time.time())
            metadata_created_at = float(getattr(managed_ref, "created_at", time.time()) or time.time())
            last_activity_at = self._resolve_list_activity_at(
                chat_history=getattr(session, "chat_history", None),
                metadata_updated_at=metadata_updated_at,
                metadata_created_at=metadata_created_at,
            )
            metadata = {
                "provider": session.provider_name or "",
                "model": session.model_name or "",
                "chat_messages": len(session.chat_history),
                "artifacts": len(session.artifacts),
                "session_name": getattr(managed_ref, "session_name", None),
                "avatar_id": getattr(managed_ref, "avatar_id", None),
                "avatar_name": getattr(managed_ref, "avatar_name", None),
                "created_at": metadata_created_at,
                "updated_at": metadata_updated_at,
                "last_activity_at": last_activity_at,
                "pinned": bool(getattr(managed_ref, "pinned", False)),
                "archived": bool(getattr(managed_ref, "archived", False)),
                "taskspaces": list(getattr(managed_ref, "taskspaces", []) or []),
                "execution_state": getattr(managed_ref, "execution_state", "idle"),
                "session_mode": normalize_session_mode(
                    getattr(session, "session_mode", None)
                ),
                **_harness_list_fields(session),
            }
            self._session_store._save_session_summary_sync(session_id, summary, metadata)
            try:
                from agenticx.studio.chat_attachments import materialize_message_lists_image_uploads

                materialize_message_lists_image_uploads(
                    session_id,
                    [
                        session.chat_history or [],
                        getattr(session, "agent_messages", None) or [],
                    ],
                )
            except Exception:
                pass
            self._save_messages_snapshot(session_id, session.chat_history or [])
            self._session_store._index_session_messages_sync(session_id, session.chat_history or [])
            self._save_agent_messages_snapshot(session_id, getattr(session, "agent_messages", None) or [])
            self._save_context_refs(session_id, session)
        except Exception:
            return

    def _messages_path(self, session_id: str) -> str:
        return os.path.join(self._sessions_root, session_id, "messages.json")

    def _save_messages_snapshot(self, session_id: str, messages: list[dict]) -> None:
        path = self._messages_path(session_id)
        # Stamp ms-epoch timestamp on messages missing one (in-memory + disk).
        now_ms = int(time.time() * 1000)
        for item in messages:
            if not isinstance(item, dict):
                continue
            if not item.get("timestamp"):
                item["timestamp"] = now_ms
        atomic_write_json(path, messages)
        self._save_messages_tail_snapshot(session_id, messages)

    _TAIL_SNAPSHOT_MAX = 120

    def _messages_tail_path(self, session_id: str) -> str:
        return os.path.join(self._sessions_root, session_id, "messages_tail.json")

    def _save_messages_tail_snapshot(self, session_id: str, messages: list[dict]) -> None:
        if not messages:
            return
        total = len(messages)
        tail_rows = [item for item in messages[-self._TAIL_SNAPSHOT_MAX :] if isinstance(item, dict)]
        if not tail_rows:
            return
        start_index = max(0, total - len(tail_rows))
        atomic_write_json(
            self._messages_tail_path(session_id),
            {
                "total_count": total,
                "start_index": start_index,
                "messages": tail_rows,
            },
        )

    def _load_messages_tail_snapshot(self, session_id: str) -> dict[str, Any] | None:
        path = self._messages_tail_path(session_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        rows = self._parse_messages_json_payload(data.get("messages"))
        if not rows:
            return None
        total_count = int(data.get("total_count", len(rows)))
        start_index = int(data.get("start_index", max(0, total_count - len(rows))))
        return {
            "total_count": total_count,
            "start_index": start_index,
            "messages": rows,
        }

    @staticmethod
    def _parse_messages_json_payload(data: Any) -> list[dict]:
        """Accept Studio list snapshots or legacy ``{\"messages\": [...]}`` wrappers."""
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            inner = data.get("messages") or data.get("chat_history")
            rows = inner if isinstance(inner, list) else []
        else:
            rows = []
        return [item for item in rows if isinstance(item, dict)]

    def _load_messages_snapshot(self, session_id: str) -> list[dict]:
        path = self._messages_path(session_id)
        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        rows = self._parse_messages_json_payload(data)
        if rows and not os.path.exists(self._messages_tail_path(session_id)):
            self._save_messages_tail_snapshot(session_id, rows)
        return rows

    def _derive_session_name_from_disk_messages(self, session_id: str) -> str | None:
        """Build a list title from on-disk messages when metadata has no session_name."""
        first = self._first_user_text_from_chat_history(
            self._load_messages_snapshot(session_id)
        )
        if not first:
            return None
        title = self._build_auto_title(first)
        return title or None

    def _agent_messages_path(self, session_id: str) -> str:
        return os.path.join(self._sessions_root, session_id, "agent_messages.json")

    def _save_agent_messages_snapshot(self, session_id: str, messages: list[dict]) -> None:
        if not messages:
            return
        tail = messages[-40:]
        path = self._agent_messages_path(session_id)
        atomic_write_json(path, tail)

    def _load_agent_messages_snapshot(self, session_id: str) -> list[dict]:
        path = self._agent_messages_path(session_id)
        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    def _context_refs_path(self, session_id: str) -> str:
        return os.path.join(self._sessions_root, session_id, "context_files_refs.json")

    def _save_context_refs(self, session_id: str, session: StudioSession) -> None:
        ctx = getattr(session, "context_files", None)
        if not ctx:
            return
        paths = list(ctx.keys())
        path = self._context_refs_path(session_id)
        atomic_write_json(path, paths)

    def _load_context_refs(self, session_id: str, session: StudioSession) -> None:
        path = self._context_refs_path(session_id)
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as fh:
            paths = json.load(fh)
        if not isinstance(paths, list):
            return
        for fpath in paths:
            if not isinstance(fpath, str) or not os.path.isfile(fpath):
                continue
            with open(fpath, "r", encoding="utf-8") as fh:
                session.context_files[fpath] = fh.read()

    def _normalize_messages(self, messages: list[dict]) -> list[dict]:
        max_data_url = 8_000_000
        normalized: list[dict] = []
        for item in messages:
            role = str(item.get("role", "assistant"))
            if role not in {"user", "assistant", "tool"}:
                role = "assistant"
            raw_timestamp = item.get("timestamp")
            try:
                parsed_timestamp = int(raw_timestamp) if raw_timestamp is not None else None
            except (TypeError, ValueError):
                parsed_timestamp = None
            row: dict[str, Any] = {
                "id": str(item.get("id", "")),
                "role": role,
                "content": str(item.get("content", "")),
                "agent_id": str(item.get("agent_id", "meta") or "meta"),
                "avatar_name": str(item.get("avatar_name", "") or ""),
                "avatar_url": str(item.get("avatar_url", "") or ""),
                "provider": str(item.get("provider", "") or ""),
                "model": str(item.get("model", "") or ""),
                "quoted_message_id": str(item.get("quoted_message_id", "") or ""),
                "quoted_content": str(item.get("quoted_content", "") or ""),
                "timestamp": parsed_timestamp,
                "forwarded_history": item.get("forwarded_history"),
            }
            raw_meta = item.get("metadata")
            if isinstance(raw_meta, dict) and raw_meta:
                row["metadata"] = dict(raw_meta)
            if role == "tool":
                tool_call_id = str(
                    item.get("tool_call_id", item.get("toolCallId", "")) or ""
                ).strip()
                tool_name = str(item.get("tool_name", item.get("toolName", "")) or "").strip()
                tool_status = str(
                    item.get("tool_status", item.get("toolStatus", "")) or ""
                ).strip()
                tool_group_id = str(
                    item.get("tool_group_id", item.get("toolGroupId", "")) or ""
                ).strip()
                if tool_call_id:
                    row["tool_call_id"] = tool_call_id
                if tool_name:
                    row["tool_name"] = tool_name
                raw_tool_args = item.get("tool_args", item.get("toolArgs"))
                if isinstance(raw_tool_args, dict):
                    row["tool_args"] = raw_tool_args
                if tool_status in {"pending", "running", "done", "error", "cancelled"}:
                    row["tool_status"] = tool_status
                raw_elapsed = item.get("tool_elapsed_sec", item.get("toolElapsedSec"))
                try:
                    elapsed = int(raw_elapsed) if raw_elapsed is not None else None
                except (TypeError, ValueError):
                    elapsed = None
                if elapsed is not None and elapsed >= 0:
                    row["tool_elapsed_sec"] = elapsed
                preview = str(
                    item.get("tool_result_preview", item.get("toolResultPreview", "")) or ""
                ).strip()
                if preview:
                    row["tool_result_preview"] = preview
                if tool_group_id:
                    row["tool_group_id"] = tool_group_id
                raw_stream = item.get("tool_stream_lines", item.get("toolStreamLines"))
                if isinstance(raw_stream, list):
                    row["tool_stream_lines"] = [str(line) for line in raw_stream[:200]]
            raw_atts = item.get("attachments")
            if isinstance(raw_atts, list) and raw_atts:
                clean_atts: list[dict[str, Any]] = []
                image_n = 0
                file_n = 0
                for a in raw_atts[:24]:
                    if not isinstance(a, dict):
                        continue
                    du = str(a.get("data_url", "")).strip()
                    kind = str(a.get("kind", "") or "").strip()
                    is_context = kind == "context_file"
                    if du.startswith("data:image/") and len(du) <= max_data_url:
                        if image_n >= 4:
                            continue
                        mime = str(a.get("mime_type", "") or "").strip()
                        if not mime and du.startswith("data:"):
                            semi = du.find(";")
                            if semi > 5:
                                mime = du[5:semi]
                        if not mime:
                            mime = "image/png"
                        try:
                            sz = int(a.get("size", 0) or 0)
                        except (TypeError, ValueError):
                            sz = 0
                        clean_atts.append(
                            {
                                "name": str(a.get("name", "") or "").strip() or "image",
                                "mime_type": mime,
                                "size": sz,
                                "data_url": du,
                                **(
                                    {"storage_path": sp}
                                    if (sp := str(a.get("storage_path", "") or "").strip())
                                    else {}
                                ),
                            }
                        )
                        image_n += 1
                        continue
                    if is_context or (not du and str(a.get("name", "") or "").strip()):
                        name = str(a.get("name", "") or "").strip()
                        if not name:
                            continue
                        if file_n >= 8:
                            continue
                        sp = str(a.get("source_path", "") or "").strip()
                        rt = bool(a.get("reference_token", False))
                        crl = str(a.get("composer_ref_label", "") or "").strip()
                        mime = str(a.get("mime_type", "") or "").strip() or "application/octet-stream"
                        try:
                            sz = int(a.get("size", 0) or 0)
                        except (TypeError, ValueError):
                            sz = 0
                        att_dict = {
                            "name": name,
                            "mime_type": mime,
                            "size": sz,
                            "source_path": sp,
                            "reference_token": rt,
                            "kind": "context_file",
                        }
                        if crl:
                            att_dict["composer_ref_label"] = crl
                        line_start = a.get("line_start")
                        line_end = a.get("line_end")
                        if isinstance(line_start, int) and isinstance(line_end, int):
                            att_dict["line_start"] = line_start
                            att_dict["line_end"] = line_end
                        snippet_ref = str(a.get("snippet_ref", "") or "").strip()
                        if snippet_ref:
                            att_dict["snippet_ref"] = snippet_ref
                        sheet = str(a.get("sheet", "") or "").strip()
                        a1 = str(a.get("a1", "") or "").strip()
                        if sheet and a1:
                            att_dict["sheet"] = sheet
                            att_dict["a1"] = a1
                        clean_atts.append(att_dict)
                        file_n += 1
                if clean_atts:
                    row["attachments"] = clean_atts
            raw_visual = item.get("visual_attachments")
            if isinstance(raw_visual, list) and raw_visual:
                clean_visual: list[dict[str, Any]] = []
                for a in raw_visual[:4]:
                    if not isinstance(a, dict):
                        continue
                    du = str(a.get("data_url", "")).strip()
                    if not du.startswith("data:image/") or len(du) > max_data_url:
                        continue
                    mime = str(a.get("mime_type", "") or "").strip() or "image/png"
                    try:
                        sz = int(a.get("size", 0) or 0)
                    except (TypeError, ValueError):
                        sz = 0
                    clean_visual.append(
                        {
                            "name": str(a.get("name", "") or "").strip() or "image",
                            "mime_type": mime,
                            "size": sz,
                            "data_url": du,
                            "source": str(a.get("source", "") or "").strip(),
                        }
                    )
                if clean_visual:
                    row["visual_attachments"] = clean_visual
            if role == "assistant":
                raw_sq = item.get("suggested_questions")
                if isinstance(raw_sq, list) and raw_sq:
                    row["suggested_questions"] = [
                        str(x).strip() for x in raw_sq[:5] if str(x).strip()
                    ]
                raw_refs = item.get("references")
                if isinstance(raw_refs, list) and raw_refs:
                    clean_refs: list[dict[str, Any]] = []
                    for ref in raw_refs[:50]:
                        if not isinstance(ref, dict):
                            continue
                        rid = ref.get("id")
                        title = str(ref.get("title", "") or "").strip()
                        url = str(ref.get("url", "") or "").strip()
                        if not title and not url:
                            continue
                        entry: dict[str, Any] = {
                            "id": int(rid) if rid is not None else len(clean_refs) + 1,
                            "title": title or url,
                            "url": url,
                            "snippet": str(ref.get("snippet", "") or "").strip()[:240],
                            "source": str(ref.get("source", "") or "web").strip() or "web",
                        }
                        provider = str(ref.get("provider", "") or "").strip()
                        domain = str(ref.get("domain", "") or "").strip()
                        if provider:
                            entry["provider"] = provider
                        if domain:
                            entry["domain"] = domain
                        clean_refs.append(entry)
                    if clean_refs:
                        row["references"] = clean_refs
                raw_queries = item.get("searched_queries")
                if isinstance(raw_queries, list) and raw_queries:
                    row["searched_queries"] = [
                        str(x).strip() for x in raw_queries[:20] if str(x).strip()
                    ]
                raw_reasoning = item.get("reasoning")
                if isinstance(raw_reasoning, str) and raw_reasoning.strip():
                    row["reasoning"] = raw_reasoning.strip()[:16384]
                raw_reasoning_seconds = item.get("reasoning_seconds")
                try:
                    reasoning_seconds = int(raw_reasoning_seconds) if raw_reasoning_seconds is not None else None
                except (TypeError, ValueError):
                    reasoning_seconds = None
                if reasoning_seconds is not None and reasoning_seconds >= 1:
                    row["reasoning_seconds"] = reasoning_seconds
            normalized.append(row)
        return self._collapse_repeated_assistant_in_turn(normalized)

    @staticmethod
    def _collapse_repeated_assistant_in_turn(rows: list[dict]) -> list[dict]:
        """Drop assistant rows that exactly repeat an earlier assistant reply
        within the same user turn.

        A single turn's reply must never appear twice. Spurious re-runs
        (e.g. a false-stall auto-nudge re-answering a completed turn) or
        in-memory/disk merge races can append identical assistant copies that
        then accumulate across restarts. Repeats across *different* user turns
        are legitimate (the user asked the same thing twice) and are kept: the
        per-turn seen-set is cleared whenever a user message is encountered.
        Empty (tool-call-only) assistant rows carry no visible text and are
        never deduped.
        """
        deduped: list[dict] = []
        seen_in_turn: set[str] = set()
        for row in rows:
            role = row.get("role")
            if role == "user":
                seen_in_turn.clear()
            elif role == "assistant":
                key = str(row.get("content", "") or "").strip()
                if key:
                    if key in seen_in_turn:
                        continue
                    seen_in_turn.add(key)
            deduped.append(row)
        return deduped

    def _build_session_summary(self, session: StudioSession) -> str:
        last_user = ""
        last_assistant = ""
        for item in reversed(session.chat_history[-20:]):
            role = str(item.get("role", ""))
            content = str(item.get("content", ""))
            if role == "assistant" and not last_assistant:
                last_assistant = content
            if role == "user" and not last_user:
                last_user = content
            if last_user and last_assistant:
                break
        return (
            f"last_user={last_user[:300]}\n"
            f"last_assistant={last_assistant[:300]}\n"
            f"todos={session.todo_manager.render()[:600]}"
        )

    def _build_auto_title(self, message: str) -> str:
        compact = " ".join(str(message or "").split())
        if not compact:
            return ""
        return compact[:48]

    @staticmethod
    def _first_user_text_from_chat_history(chat_history: list) -> str:
        for item in chat_history or []:
            if not isinstance(item, dict):
                continue
            if str(item.get("role", "")).strip() != "user":
                continue
            content = str(item.get("content", "")).strip()
            if content:
                return content
        return ""

    def _ensure_session_title_from_chat_history(self, session_id: str, session: StudioSession) -> None:
        managed = self._sessions.get(session_id)
        if managed is None:
            return
        if not self.session_title_needs_auto_fill(managed.session_name):
            return
        first = self._first_user_text_from_chat_history(getattr(session, "chat_history", None) or [])
        if not first:
            return
        managed.session_name = self._build_auto_title(first)

    @staticmethod
    def _session_has_listable_chat_history(chat_history: list | None) -> bool:
        """True when the session has at least one visible user/assistant message."""
        for item in chat_history or []:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role", "")).strip().lower()
            if role not in {"user", "assistant"}:
                continue
            if str(item.get("content", "")).strip():
                return True
        return False

    @staticmethod
    def _normalize_epoch_seconds(value: Any) -> float:
        try:
            ts = float(value)
        except (TypeError, ValueError):
            return 0.0
        if ts <= 0:
            return 0.0
        if ts > 1e11:
            ts /= 1000.0
        return ts

    @classmethod
    def _last_message_activity_from_history(cls, chat_history: list | None) -> float:
        best = 0.0
        for item in chat_history or []:
            if not isinstance(item, dict):
                continue
            for key in ("timestamp", "created_at", "ts"):
                ts = cls._normalize_epoch_seconds(item.get(key))
                if ts > best:
                    best = ts
        return best

    def _last_message_activity_from_disk(self, session_id: str) -> float:
        sid = str(session_id or "").strip()
        if not sid:
            return 0.0
        path = self._messages_path(sid)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return 0.0
        cached = getattr(self, "_disk_activity_cache", {}).get(sid)
        if cached and cached[0] == mtime:
            return cached[1]
        activity = self._last_message_activity_from_history(self._load_messages_snapshot(sid))
        cache = getattr(self, "_disk_activity_cache", None)
        if cache is None:
            cache = {}
            setattr(self, "_disk_activity_cache", cache)
        cache[sid] = (mtime, activity)
        return activity

    @classmethod
    def _resolve_list_activity_at(
        cls,
        *,
        chat_history: list | None,
        metadata_updated_at: float,
        metadata_created_at: float,
        indexed_message_ts: float = 0.0,
        metadata_last_activity_at: float = 0.0,
        disk_message_ts: float = 0.0,
        summary_activity_ts: float = 0.0,
        live_touch_at: float = 0.0,
    ) -> float:
        """Pick the best last-activity timestamp for session list bucketing."""
        message_based = max(
            cls._last_message_activity_from_history(chat_history),
            cls._normalize_epoch_seconds(indexed_message_ts),
            cls._normalize_epoch_seconds(disk_message_ts),
        )
        touch_at = cls._normalize_epoch_seconds(live_touch_at)
        if message_based > 0:
            # Real chat timestamps are the source of truth. We deliberately ignore
            # touch_at here even when it's larger, because historically taskspace
            # mutations and other non-activity code paths bulk-bumped updated_at
            # and shoved unrelated sessions into Today. The "just sent, no message
            # written yet" case is covered by the frontend sessionHistoryHints
            # optimistic bump, not by touch_at on the backend.
            return message_based
        summary_based = cls._normalize_epoch_seconds(summary_activity_ts)
        if summary_based > 0:
            if touch_at > summary_based:
                return touch_at
            return summary_based
        meta_last = cls._normalize_epoch_seconds(metadata_last_activity_at)
        if meta_last > 0:
            if touch_at > meta_last:
                return touch_at
            return meta_last
        if touch_at > 0:
            return touch_at
        if metadata_updated_at > 0:
            return metadata_updated_at
        if metadata_created_at > 0:
            return metadata_created_at
        return 0.0

    def _build_fork_name(self, base_name: Optional[str]) -> str:
        text = str(base_name or "").strip()
        if not text:
            return "Fork Chat"
        return f"{text} (Fork)"

    def _to_float(self, value: Any, fallback: float) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return fallback
        if parsed <= 0:
            return fallback
        return parsed

    @staticmethod
    def _sanitize_session_name(raw: Any) -> str | None:
        if raw is None:
            return None
        s = str(raw).strip()
        if not s or s == "None":
            return None
        return s

    def _list_persisted_sessions(self) -> list[dict]:
        rows: list[dict] = []
        try:
            latest = self._session_store._list_latest_sessions_sync(limit=0)
        except Exception:
            latest = []
        for item in latest:
            sid = str(item.get("session_id", "")).strip()
            if not sid:
                continue
            metadata = item.get("metadata", {})
            if not isinstance(metadata, dict):
                metadata = {}
            chat_count = 0
            try:
                chat_count = int(metadata.get("chat_messages", 0))
            except (TypeError, ValueError):
                pass
            if chat_count <= 0:
                # 元数据可能略滞后于磁盘 messages.json；有消息则仍应出现在会话列表中。
                try:
                    mp = Path(self._messages_path(sid))
                    raw = mp.read_text(encoding="utf-8").strip()
                    if raw and raw != "[]":
                        chat_count = 1
                except Exception:
                    pass
            if chat_count <= 0:
                continue
            created_at = self._to_float(metadata.get("created_at"), self._iso_to_epoch(item.get("created_at")))
            updated_at = self._to_float(metadata.get("updated_at"), self._iso_to_epoch(item.get("created_at")))
            last_activity_at = self._to_float(metadata.get("last_activity_at"), updated_at)
            sess_nm = self._sanitize_session_name(metadata.get("session_name"))
            if self.session_title_needs_auto_fill(sess_nm):
                derived = self._derive_session_name_from_disk_messages(sid)
                if derived:
                    sess_nm = derived
            rows.append(
                {
                    "session_id": sid,
                    "avatar_id": metadata.get("avatar_id"),
                    "avatar_name": metadata.get("avatar_name"),
                    "session_name": sess_nm,
                    "updated_at": updated_at,
                    "created_at": created_at,
                    "last_activity_at": last_activity_at,
                    "pinned": bool(metadata.get("pinned", False)),
                    "archived": bool(metadata.get("archived", False)),
                    "execution_state": str(metadata.get("execution_state", "idle") or "idle"),
                    "provider": str(metadata.get("provider", "") or ""),
                    "model": str(metadata.get("model", "") or ""),
                }
            )
        known = {str(row.get("session_id", "")) for row in rows}
        root = Path(self._sessions_root)
        if root.exists():
            for child in root.iterdir():
                if not child.is_dir():
                    continue
                sid = child.name
                if sid in known:
                    continue
                messages_path = child / "messages.json"
                if not messages_path.exists():
                    continue
                try:
                    content = messages_path.read_text(encoding="utf-8").strip()
                    if not content or content == "[]":
                        continue
                except Exception:
                    continue
                mtime = float(messages_path.stat().st_mtime)
                fs_meta: dict[str, Any] = {}
                try:
                    loaded = self._session_store._load_latest_session_metadata_sync(sid)
                    if isinstance(loaded, dict):
                        fs_meta = loaded
                except Exception:
                    fs_meta = {}
                raw_av = fs_meta.get("avatar_id")
                av_norm = (
                    None
                    if raw_av is None
                    else normalize_session_avatar_binding(str(raw_av))
                )
                raw_nm = fs_meta.get("avatar_name")
                av_name = None if raw_nm is None else (str(raw_nm).strip() or None)
                sess_nm = self._sanitize_session_name(fs_meta.get("session_name"))
                if self.session_title_needs_auto_fill(sess_nm):
                    derived = self._derive_session_name_from_disk_messages(sid)
                    if derived:
                        sess_nm = derived
                rows.append(
                    {
                        "session_id": sid,
                        "avatar_id": av_norm,
                        "avatar_name": av_name,
                        "session_name": sess_nm,
                        "updated_at": mtime,
                        "created_at": mtime,
                        "pinned": False,
                        "archived": False,
                        "execution_state": str(fs_meta.get("execution_state", "idle") or "idle"),
                        "provider": str(fs_meta.get("provider", "") or ""),
                        "model": str(fs_meta.get("model", "") or ""),
                    }
                )
        return rows

    def _purge_session_state(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        if not sid:
            return False
        db_ok = False
        try:
            self._session_store._purge_session_sync(sid)
            db_ok = not self._session_store._session_exists_sync(sid)
        except Exception:
            db_ok = False
        fs_ok = True
        session_dir = Path(self._sessions_root) / sid
        if session_dir.exists():
            try:
                shutil.rmtree(session_dir, ignore_errors=False)
            except Exception:
                fs_ok = False
            else:
                fs_ok = not session_dir.exists()
        taskspace_ok = True
        default_taskspace_dir = Path(self._taskspaces_root) / sid
        if default_taskspace_dir.exists():
            try:
                shutil.rmtree(default_taskspace_dir, ignore_errors=False)
            except Exception:
                taskspace_ok = False
            else:
                taskspace_ok = not default_taskspace_dir.exists()
        return db_ok and fs_ok and taskspace_ok

    def _session_exists_in_persistence(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        if not sid:
            return False
        try:
            metadata = self._session_store._load_latest_session_metadata_sync(sid)
            if isinstance(metadata, dict) and metadata:
                return True
        except Exception:
            pass
        messages_path = Path(self._messages_path(sid))
        return messages_path.exists()

    def _iso_to_epoch(self, value: Any) -> float:
        text = str(value or "").strip()
        if not text:
            return time.time()
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
        except Exception:
            return time.time()

    def _ensure_default_taskspace(self, managed: ManagedSession) -> None:
        for existing in managed.taskspaces:
            if existing.get("id") == "default" and existing.get("path"):
                existing["path"] = str(Path(existing["path"]).resolve(strict=False))
                existing["label"] = existing.get("label") or "默认工作区"
                return
        session_ws = getattr(managed.studio_session, "workspace_dir", None)
        default_path = (
            session_ws
            if session_ws and str(session_ws).strip()
            else self._resolve_taskspace_root(managed.session_id, None)
        )
        resolved = Path(default_path).resolve(strict=False)
        resolved.mkdir(parents=True, exist_ok=True)
        managed.taskspaces = [{
            "id": "default",
            "label": "默认工作区",
            "path": str(resolved),
        }] + [item for item in managed.taskspaces if item.get("id") != "default"]

    def _sync_taskspaces_with_global(
        self, managed: ManagedSession, *, limit: int | None = None
    ) -> None:
        """Re-derive a session's taskspace list from the scope's global config.

        ``limit`` should be precomputed by the caller when syncing multiple sessions
        in a loop (see ``_sync_all_sessions_from_global``): resolving the limit reads
        and parses ``config.yaml`` from disk, so recomputing it per-session (or per-row)
        turns an O(1) lookup into O(sessions x rows) disk I/O.
        """
        effective_limit = limit if limit is not None else self._taskspace_limit()
        self._ensure_default_taskspace(managed)
        globals_rows = self._load_global_taskspaces(
            scope_key=self._taskspace_scope_key_for_managed(managed)
        )
        default_item = self._get_taskspace(managed, "default")
        if default_item is None:
            return
        merged: list[dict[str, str]] = [dict(default_item)]
        seen_paths: set[str] = {default_item["path"]}
        for row in globals_rows:
            path = str(row.get("path", "")).strip()
            if not path or path in seen_paths:
                continue
            merged.append(
                {
                    "id": str(row.get("id", "")).strip(),
                    "label": str(row.get("label", "")).strip() or Path(path).name or "taskspace",
                    "path": path,
                }
            )
            seen_paths.add(path)
            if len(merged) >= effective_limit:
                break
        managed.taskspaces = merged

    def _sync_all_sessions_from_global(self, scope_key: str | None = None) -> None:
        limit = self._taskspace_limit()
        for managed in self._sessions.values():
            if (
                scope_key is not None
                and self._taskspace_scope_key_for_managed(managed) != scope_key
            ):
                continue
            self._sync_taskspaces_with_global(managed, limit=limit)

    def _global_taskspaces_path(self) -> str:
        return os.path.join(self._taskspaces_root, "global_workspaces.json")

    @staticmethod
    def _taskspace_scope_key_from_avatar_id(avatar_id: Optional[str]) -> str:
        normalized = normalize_session_avatar_binding(avatar_id)
        if normalized is None:
            return SessionManager._META_TASKSPACE_SCOPE
        return f"avatar:{normalized}"

    def _taskspace_scope_key_for_managed(self, managed: ManagedSession) -> str:
        return self._taskspace_scope_key_from_avatar_id(getattr(managed, "avatar_id", None))

    def _normalize_global_taskspace_rows(self, payload: Any) -> list[dict[str, str]]:
        if not isinstance(payload, list):
            return []
        rows: list[dict[str, str]] = []
        seen_paths: set[str] = set()
        for item in payload:
            if not isinstance(item, dict):
                continue
            taskspace_id = str(item.get("id", "")).strip()
            raw_path = str(item.get("path", "")).strip()
            if not taskspace_id or not raw_path:
                continue
            resolved_path = self._resolve_taskspace_path(raw_path)
            if resolved_path in seen_paths:
                continue
            rows.append(
                {
                    "id": taskspace_id,
                    "label": str(item.get("label", "")).strip()
                    or Path(resolved_path).name
                    or "taskspace",
                    "path": resolved_path,
                }
            )
            seen_paths.add(resolved_path)
            if len(rows) >= max(0, self._taskspace_limit() - 1):
                break
        return rows

    def _load_global_taskspace_scopes(self) -> dict[str, list[dict[str, str]]]:
        path = self._global_taskspaces_path()
        if not os.path.exists(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception:
            return {}

        # Backward compatibility: old payload was a plain list shared by all sessions.
        if isinstance(payload, list):
            return {
                self._META_TASKSPACE_SCOPE: self._normalize_global_taskspace_rows(payload)
            }

        if not isinstance(payload, dict):
            return {}
        raw_scopes = payload.get("scopes", payload)
        if not isinstance(raw_scopes, dict):
            return {}

        scopes: dict[str, list[dict[str, str]]] = {}
        for key, rows in raw_scopes.items():
            scope_key = str(key or "").strip()
            if not scope_key:
                continue
            normalized_rows = self._normalize_global_taskspace_rows(rows)
            if normalized_rows:
                scopes[scope_key] = normalized_rows
        return scopes

    def _load_global_taskspaces(self, scope_key: str | None = None) -> list[dict[str, str]]:
        key = (scope_key or "").strip() or self._META_TASKSPACE_SCOPE
        scopes = self._load_global_taskspace_scopes()
        return [dict(item) for item in scopes.get(key, [])]

    def _save_global_taskspaces(
        self,
        rows: list[dict[str, str]],
        scope_key: str | None = None,
    ) -> None:
        key = (scope_key or "").strip() or self._META_TASKSPACE_SCOPE
        scopes = self._load_global_taskspace_scopes()
        normalized_rows = self._normalize_global_taskspace_rows(rows)
        if normalized_rows:
            scopes[key] = normalized_rows
        else:
            scopes.pop(key, None)
        path = self._global_taskspaces_path()
        atomic_write_json(path, {"scopes": scopes})

    def _resolve_taskspace_path(self, path: str) -> str:
        root = Path(str(path).strip()).expanduser()
        resolved = root.resolve(strict=False)
        resolved.mkdir(parents=True, exist_ok=True)
        return str(resolved)

    def _resolve_taskspace_root(self, session_id: str, path: str | None) -> str:
        if path and str(path).strip():
            return self._resolve_taskspace_path(path)
        root = Path(self._taskspaces_root) / session_id / "default"
        resolved = root.resolve(strict=False)
        resolved.mkdir(parents=True, exist_ok=True)
        return str(resolved)

    def rebind_default_taskspace_to_workspace(self, managed: ManagedSession) -> None:
        """Re-point the 'default' taskspace to the session's workspace_dir (call after workspace_dir is set)."""
        ws = getattr(managed.studio_session, "workspace_dir", None)
        if not ws or not str(ws).strip():
            return
        resolved = str(Path(ws).resolve(strict=False))
        for ts in managed.taskspaces:
            if ts.get("id") == "default":
                if ts["path"] != resolved:
                    Path(resolved).mkdir(parents=True, exist_ok=True)
                    ts["path"] = resolved
                return

    def apply_session_workspace_dir(
        self,
        managed: ManagedSession,
        *,
        avatar_workspace_dir: str | None = None,
    ) -> None:
        """Set session workspace_dir from avatar override or global config default."""
        from agenticx.workspace.loader import resolve_default_session_workspace_dir

        resolved = resolve_default_session_workspace_dir(
            avatar_workspace_dir=avatar_workspace_dir,
        )
        managed.studio_session.workspace_dir = str(resolved)
        self.rebind_default_taskspace_to_workspace(managed)

    def align_meta_session_workspace(self, managed: ManagedSession) -> None:
        """Keep meta-agent sessions on the configured default workspace, not legacy home/cwd."""
        if str(getattr(managed, "avatar_id", "") or "").strip():
            return
        from agenticx.workspace.loader import resolve_default_session_workspace_dir

        canonical = resolve_default_session_workspace_dir()
        current_raw = str(getattr(managed.studio_session, "workspace_dir", "") or "").strip()
        if not current_raw:
            managed.studio_session.workspace_dir = str(canonical)
            self.rebind_default_taskspace_to_workspace(managed)
            return
        try:
            current = Path(current_raw).expanduser().resolve(strict=False)
            canonical_res = canonical.resolve(strict=False)
        except Exception:
            return
        if current == canonical_res:
            return
        home = Path.home().resolve(strict=False)
        if current == home:
            managed.studio_session.workspace_dir = str(canonical_res)
            self.rebind_default_taskspace_to_workspace(managed)

    def apply_avatar_binding(
        self,
        managed: ManagedSession,
        *,
        avatar_id: Optional[str],
        avatar_name: Optional[str] = None,
    ) -> None:
        """Bind session avatar identity and immediately rescope taskspaces.

        New sessions are created before avatar_id is known in some API flows. If we only
        set avatar_id later without re-sync, taskspaces can stay in the wrong scope.
        """
        managed.avatar_id = normalize_session_avatar_binding(avatar_id)
        managed.avatar_name = (str(avatar_name).strip() or None) if avatar_name is not None else None
        self._sync_taskspaces_with_global(managed)

    def _sanitize_taskspaces(self, session_id: str, payload: Any) -> list[dict[str, str]]:
        limit = self._taskspace_limit()
        rows: list[dict[str, str]] = []
        if isinstance(payload, list):
            for item in payload:
                if not isinstance(item, dict):
                    continue
                taskspace_id = str(item.get("id", "")).strip()
                label = str(item.get("label", "")).strip()
                path = str(item.get("path", "")).strip()
                if not taskspace_id or not path:
                    continue
                resolved_path = self._resolve_taskspace_root(session_id, path)
                rows.append(
                    {
                        "id": taskspace_id,
                        "label": label or Path(resolved_path).name or "taskspace",
                        "path": resolved_path,
                    }
                )
                if len(rows) >= limit:
                    break
        if not rows:
            return []
        dedup: list[dict[str, str]] = []
        seen_paths: set[str] = set()
        for row in rows:
            row_path = row["path"]
            if row_path in seen_paths:
                continue
            dedup.append(row)
            seen_paths.add(row_path)
            if len(dedup) >= limit:
                break
        return dedup

    def _get_taskspace(self, managed: ManagedSession, taskspace_id: str) -> Optional[dict[str, str]]:
        for item in managed.taskspaces:
            if item.get("id") == taskspace_id:
                return item
        return None

    def _resolve_inside_root(self, root: Path, rel_path: str, *, expect_dir: bool) -> Path:
        clean_rel = str(rel_path or ".").strip() or "."
        target = (root / clean_rel).resolve(strict=False)
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ValueError("path escapes taskspace root") from exc
        if not target.exists():
            raise FileNotFoundError(str(target))
        if expect_dir and not target.is_dir():
            raise NotADirectoryError(str(target))
        return target
