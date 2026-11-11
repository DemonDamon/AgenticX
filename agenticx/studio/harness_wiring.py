#!/usr/bin/env python3
"""Studio-side harness wiring (SP5b): turn routing + mid-session switch.

This module is the integration layer between the studio AppThread
(StudioSession + SessionManager) and the unified harness control surface
(SP1 protocol + SP4 handoff engine), running in-process:

- ``run_external_harness_turn``: sessions bound to an external harness
  execute their turns through the bound adapter (spawn/adopt/reuse the
  unified-surface session), with results appended to chat_history as
  harness-attributed messages (Run metadata).
- ``switch_harness``: mid-session switch with context handoff. Boundaries
  are recorded as system-notice messages (visible markers) and bindings
  persist across cold restarts; on failure the session stays on its
  current harness (fail closed).
- ``snapshot_from_session``: assembles the engine's AppThreadSnapshot from
  the studio session (canonical chat_history + SP3 binding + handoff
  store records).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.utils.agx_home import agx_home
from agenticx.harness.registry import HarnessRegistry, default_registry
from agenticx.harness.types import TurnRequest, TurnResult
from agenticx.studio.harness_turn_text import format_external_harness_assistant_content
from agenticx.harness.handoff import (
    AppThreadSnapshot,
    HandoffEngine,
    HandoffError,
    HandoffPlanError,
    HandoffStore,
    HistoryMessage,
    RunRecord,
    STRATEGY_FULL,
    STRATEGY_MANUAL,
    ThreadBinding,
)
from agenticx.harness.handoff.types import HandoffSummary
from agenticx.harness.spawn_options import adapter_spawn_options
from agenticx.studio.session_manager import require_safe_session_id

_TURN_WAIT_SECONDS = 240.0

_BUILTIN_HARNESS_IDS = frozenset({"", "python-agent", "builtin", "agenticx"})

# Harnesses whose spawn() already accepts a native ``model`` option.
# codebuddy CLI exposes ``--model`` (verified via ``codebuddy --help``);
# keep this set in sync with desktop HARNESSES_WITH_NATIVE_MODEL_OPTION.
_HARNESSES_WITH_MODEL_OPTION = frozenset(
    {"claude-code", "codex", "opencode", "codebuddy"}
)
_CODEX_HARNESS_ID = "codex"

# Codex CLI base_instructions are English-only, and the AGENTICX CONTEXT
# HANDOFF wrapper is marked non-executable reference. This policy must sit
# *outside* that block and on every Codex outbound turn (first turn, fresh
# surface / model-switch inject, and same-thread resume). Language-matching,
# not Chinese-only — unlike the CC/CodeBuddy subagent "使用中文。" suffix.
_HANDOFF_FOOTER = "===== AGENTICX CONTEXT HANDOFF (END) ====="
CODEX_REPLY_LANGUAGE_POLICY = (
    "Reply in the same language as the user's latest message "
    "(the text after any handoff block). If they wrote in Chinese, "
    "reply in Chinese. Do not switch to English just because system "
    "instructions, tool results, or web search snippets are in English, "
    "unless the user explicitly asks for another language. When using "
    "web search, prefer a query in the user's language, or at least keep "
    "this reply-language rule even if the snippets come back in English."
)


def attach_codex_reply_language_policy(text: str) -> str:
    """Place the reply-language policy outside the non-executable handoff.

    After a handoff wrapper, the policy is inserted after the footer and
    immediately before the user's latest message. With no handoff (a first
    turn or a same-thread resume) it is prepended to the outbound user text.
    Idempotent when the policy is already present outside the handoff block.
    """
    outbound = str(text or "")
    footer_idx = outbound.rfind(_HANDOFF_FOOTER)
    if footer_idx >= 0:
        prefix_end = footer_idx + len(_HANDOFF_FOOTER)
        head = outbound[:prefix_end]
        tail = outbound[prefix_end:].lstrip("\n")
        if CODEX_REPLY_LANGUAGE_POLICY not in outbound[prefix_end:]:
            if tail:
                return head + "\n\n" + CODEX_REPLY_LANGUAGE_POLICY + "\n\n" + tail
            return head + "\n\n" + CODEX_REPLY_LANGUAGE_POLICY
        return outbound
    if CODEX_REPLY_LANGUAGE_POLICY in outbound:
        return outbound
    body = outbound.strip("\n")
    if not body:
        return CODEX_REPLY_LANGUAGE_POLICY
    return CODEX_REPLY_LANGUAGE_POLICY + "\n\n" + body


_lock = threading.Lock()
_registry: Optional[HarnessRegistry] = None
_engine: Optional[HandoffEngine] = None

# In-flight external-harness turns, keyed by studio session id. Guards
# same-process mutual exclusion: a second /api/chat (or a mid-turn
# switch) must fail fast while an adapter turn is still running.
_inflight_turns: Dict[str, float] = {}
_inflight_lock = threading.Lock()


class HarnessTurnBusyError(RuntimeError):
    """A turn is already in flight for this studio session."""


def is_turn_inflight(session_id: str) -> bool:
    sid = str(session_id or "").strip()
    if not sid:
        return False
    with _inflight_lock:
        return sid in _inflight_turns


def _begin_inflight(session_id: str) -> bool:
    sid = str(session_id or "").strip()
    if not sid:
        return False
    with _inflight_lock:
        if sid in _inflight_turns:
            return False
        _inflight_turns[sid] = time.time()
        return True


def _end_inflight(session_id: str) -> None:
    sid = str(session_id or "").strip()
    with _inflight_lock:
        _inflight_turns.pop(sid, None)


def harness_registry() -> HarnessRegistry:
    """Process-level registry singleton (studio in-process adapters)."""
    global _registry
    with _lock:
        if _registry is None:
            _registry = default_registry()
        return _registry


def _handoff_store() -> HandoffStore:
    root = Path(agx_home()) / "handoffs"
    return HandoffStore(str(root))


def handoff_engine() -> HandoffEngine:
    global _engine
    engine = _engine
    if engine is not None:
        return engine
    # Build collaborators BEFORE taking _lock: harness_registry() uses the
    # same non-reentrant lock and must never be called while holding it
    # (nested acquisition self-deadlocks on first construction).
    registry = harness_registry()
    store = _handoff_store()
    with _lock:
        if _engine is None:
            _engine = HandoffEngine(registry, store)
        return _engine


def harness_display_name(harness_id: Optional[str]) -> str:
    if not harness_id or harness_id in _BUILTIN_HARNESS_IDS:
        return "agenticx"
    try:
        descriptor = harness_registry().describe(harness_id)
        return descriptor.display_name if descriptor else harness_id
    except Exception:
        return harness_id


def is_external_harness(harness_id: Optional[str]) -> bool:
    return bool(harness_id) and harness_id not in _BUILTIN_HARNESS_IDS


_STICKY_BUILTIN_NAMES = frozenset({"", "python-agent", "builtin", "agenticx"})


def _sticky_external_id(raw: Optional[str]) -> Optional[str]:
    text = str(raw or "").strip()
    if not text or text.lower() in _STICKY_BUILTIN_NAMES:
        return None
    return text


def derive_sticky_harness_id(
    history: Optional[List[Dict[str, Any]]],
    bound: Optional[str],
) -> Optional[str]:
    """Last harness this conversation actually used.

    A persisted external binding wins. When the session field is missing or
    still the builtin null, the latest user/assistant ``metadata.harness``
    is the backfill. A harness-switch row only wins when it is newer than
    every stamped turn (an explicit switch that has not been followed by a
    message yet). Builtin / empty ids stay None.
    """
    bound_external = _sticky_external_id(bound)
    if bound_external:
        return bound_external
    if not isinstance(history, list):
        return None

    latest_stamp_idx: Optional[int] = None
    latest_stamp: Optional[str] = None
    latest_switch_idx: Optional[int] = None
    latest_switch_to: Optional[str] = None

    for index, item in enumerate(history):
        if not isinstance(item, dict):
            continue
        meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        if meta.get("kind") == "harness_switch":
            latest_switch_idx = index
            to_raw = meta.get("to_harness")
            strategy = str(meta.get("strategy") or "")
            to_text = str(to_raw or "").strip()
            if (
                strategy == "builtin"
                or not to_text
                or to_text.lower() in _STICKY_BUILTIN_NAMES
            ):
                latest_switch_to = None
            else:
                latest_switch_to = to_text
            continue
        if item.get("role") not in {"user", "assistant"}:
            continue
        stamped = _sticky_external_id(
            meta.get("harness") or meta.get("harness_id") or meta.get("harnessId")
        )
        if stamped:
            latest_stamp_idx = index
            latest_stamp = stamped

    if latest_switch_idx is not None and (
        latest_stamp_idx is None or latest_switch_idx > latest_stamp_idx
    ):
        return latest_switch_to
    return latest_stamp


def restamp_tail_user_harness(
    history: Optional[List[Dict[str, Any]]],
    harness_id: Optional[str],
    *,
    expected_text: Optional[str] = None,
) -> bool:
    """Rewrite the trailing user row's harness stamp. No new row.

    Returns True when metadata changed. A text mismatch leaves history
    untouched and returns False.
    """
    canonical = str(harness_id or "").strip()
    if not canonical or not isinstance(history, list):
        return False
    for item in reversed(history):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        if expected_text is not None and str(item.get("content") or "").strip() != expected_text.strip():
            return False
        meta = item.get("metadata")
        if not isinstance(meta, dict):
            meta = {}
            item["metadata"] = meta
        changed = meta.get("harness") != canonical or meta.get("harness_id") != canonical
        meta["harness"] = canonical
        meta["harness_id"] = canonical
        return changed
    return False


def _tail_user_text(history: Optional[List[Dict[str, Any]]]) -> str:
    if not isinstance(history, list):
        return ""
    for item in reversed(history):
        if isinstance(item, dict) and item.get("role") == "user":
            return str(item.get("content") or "").strip()
    return ""


def persist_derived_harness(manager: Any, session_id: str, harness_id: str) -> bool:
    """Write a backfilled external id without clearing an existing thread."""
    existing = manager.get_session_harness(session_id) or {}
    kwargs: Dict[str, Any] = {"harness_id": harness_id}
    thread_id = existing.get("harness_thread_id")
    if thread_id:
        kwargs["thread_id"] = thread_id
    options = existing.get("harness_options")
    if isinstance(options, dict):
        kwargs["options"] = options
    surface = existing.get("harness_session_id")
    if surface:
        kwargs["surface_session_id"] = surface
    return bool(manager.set_session_harness(session_id, **kwargs))


# ----------------------------------------------------------------------
# snapshot assembly
# ----------------------------------------------------------------------
def snapshot_from_session(
    manager: Any,
    session_id: str,
    *,
    pending_user_message: str = "",
) -> AppThreadSnapshot:
    """Assemble the engine's AppThreadSnapshot from a studio session."""
    sid = require_safe_session_id(session_id)
    managed = manager.get(sid, touch=False)
    if managed is None:
        raise ValueError(f"session not found: {sid}")
    session = managed.studio_session
    binding = manager.get_session_harness(sid) or {}

    history: List[HistoryMessage] = []
    for row in list(session.chat_history or []):
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "").strip()
        if role not in ("user", "assistant"):
            continue  # system notices are boundaries, not context
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        history.append(
            HistoryMessage(
                role=role,
                content=content,
                run_id=str(metadata.get("run_id") or ""),
                harness=str(metadata.get("harness") or "") or "python-agent",
            )
        )
    if pending_user_message.strip():
        history.append(
            HistoryMessage(
                role="user",
                content=pending_user_message.strip(),
                harness=binding.get("harness_id") or "python-agent",
            )
        )

    runs: List[RunRecord] = []
    position = 0
    for row in list(session.chat_history or []):
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "").strip()
        if role not in ("user", "assistant"):
            continue
        position += 1
        if role != "assistant":
            continue
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        run_id = str(metadata.get("run_id") or f"run-{position}")
        runs.append(
            RunRecord(
                run_id=run_id,
                harness=str(metadata.get("harness") or "") or "python-agent",
                end_position=position,
                changed_files=list(metadata.get("changed_files") or []),
                commands=list(metadata.get("commands") or []),
                status="completed",
            )
        )

    threads: List[ThreadBinding] = []
    current = binding.get("harness_id")
    if current and is_external_harness(current):
        threads.append(
            ThreadBinding(
                harness=current,
                native_thread_id=binding.get("harness_thread_id"),
                last_seen_position=len(history),
                last_active_run_id=(runs[-1].run_id if runs else ""),
            )
        )
    # Prior harnesses the thread has switched away from (from handoff
    # records) so A->B->A can resume A's own native thread. The record's
    # source_native_thread_id is the source side's thread; target ids
    # belong to the target harness and must NOT be rebound here.
    try:
        for row in handoff_engine().audit_view(sid):
            handoff = row.get("handoff") or {}
            if row.get("status") != "active":
                continue
            from_harness = str(handoff.get("from_harness") or "")
            native = handoff.get("source_native_thread_id")
            if (
                from_harness
                and is_external_harness(from_harness)
                and from_harness != current
                and native
            ):
                threads.append(
                    ThreadBinding(
                        harness=from_harness,
                        native_thread_id=str(native),
                        last_seen_position=int(
                            handoff.get("source_end_position") or 0
                        ),
                    )
                )
    except Exception:
        pass

    todos = ""
    try:
        todo_manager = getattr(session, "todo_manager", None)
        if todo_manager is not None:
            todos = str(getattr(todo_manager, "render_markdown", lambda: "")())
    except Exception:
        todos = ""

    cwd = str(getattr(session, "workspace_dir", "") or "")
    if not cwd:
        cwd = str(Path.cwd())

    return AppThreadSnapshot(
        app_thread_id=sid,
        current_harness=current,
        cwd=cwd,
        history=history,
        runs=runs,
        threads=threads,
        memory_snapshot=str(getattr(session, "scratchpad", "") or ""),
        knowledge_snapshot="",
        todos=todos,
    )


# ----------------------------------------------------------------------
# chat model → harness spawn options
# ----------------------------------------------------------------------
def apply_run_mode_to_harness_options(
    manager: Any,
    session_id: str,
    harness_id: str,
) -> None:
    """Fold Near confirm strategy (run_mode) into harness spawn options.

    Claude Code: ``auto`` → auto_allow; ``ask``/``allowlist`` → queue prompts.
    CodeBuddy: ``auto`` → permission_mode=acceptEdits (no interactive channel).
    Does not stop a live surface session solely for a policy change mid-turn;
    new options apply on the next spawn/ensure when the surface is cold.
    """
    from agenticx.studio.harness_permissions import harness_spawn_options_for_run_mode

    sid = require_safe_session_id(session_id)
    hid = str(harness_id or "").strip()
    run_mode = ""
    try:
        from agenticx.cli.config_manager import ConfigManager

        run_mode = str(ConfigManager.get_value("run_mode") or "").strip()
        if not run_mode:
            run_mode = str(ConfigManager.get_value("confirm_strategy") or "").strip()
    except Exception:
        run_mode = ""
    extras = harness_spawn_options_for_run_mode(hid, run_mode)
    if not extras:
        return
    binding = manager.get_session_harness(sid) or {}
    options = dict(binding.get("harness_options") or {})
    changed = False
    for key, value in extras.items():
        if options.get(key) != value:
            options[key] = value
            changed = True
    if not changed:
        return
    manager.set_session_harness(
        sid,
        harness_id=hid,
        thread_id=binding.get("harness_thread_id"),
        options=options,
        surface_session_id=binding.get("harness_session_id"),
    )


def apply_chat_model_to_harness_options(
    manager: Any,
    session_id: str,
    harness_id: str,
    chat_model: Optional[str],
) -> None:
    """Fold Near ``ChatRequest.model`` into ``harness_options`` when native.

    Policy: only harnesses listed in ``_HARNESSES_WITH_MODEL_OPTION`` receive
    ``model`` (they already expose a CLI/API model knob). Empty/omitted chat
    model leaves existing options untouched. When a live surface session was
    spawned under a *different non-empty* model, stop it and clear
    ``harness_session_id`` so ``ensure_harness_session`` re-spawns with the
    picker value on the next turn (CLI ``--model`` / ``-m`` is spawn-time).
    Filling an empty ``options.model`` after handoff inject keeps the
    injected surface session.
    """
    desired = str(chat_model or "").strip()
    if not desired:
        return
    hid = str(harness_id or "").strip()
    if hid not in _HARNESSES_WITH_MODEL_OPTION:
        return
    sid = require_safe_session_id(session_id)
    binding = manager.get_session_harness(sid) or {}
    options = dict(binding.get("harness_options") or {})
    prev = str(options.get("model") or "").strip() or None
    surface_sid = str(binding.get("harness_session_id") or "").strip() or None
    options["model"] = desired

    # Mid-session picker change → respawn so the new model reaches argv.
    # Filling an *empty* spawn model (common after handoff inject, which
    # often started with options=None) must NOT kill the injected surface:
    # the next turn would otherwise spawn a blank CLI session and lose
    # the handoff context ("这是第一条消息").
    if surface_sid and prev and prev != desired:
        adapter = harness_registry().require(hid)
        try:
            adapter.stop(surface_sid)
        except Exception:
            pass
        surface_sid = None

    manager.set_session_harness(
        sid,
        harness_id=hid,
        thread_id=binding.get("harness_thread_id"),
        options=options,
        surface_session_id=surface_sid,
    )



def _sanitized_codex_provider_id(provider_name: Optional[str]) -> Optional[str]:
    """Near provider name → Codex ``model_providers`` id, or None if unknown."""
    raw = str(provider_name or "").strip()
    if not raw:
        return None
    try:
        from agenticx.harness.codex_settings import sanitize_codex_provider_id

        return sanitize_codex_provider_id(raw)
    except Exception:
        return None


def current_intended_codex_provider_id(
    manager: Any,
    session_id: str,
    *,
    chat_provider: Optional[str] = None,
) -> Optional[str]:
    """Intended Codex provider id at turn start (Near picker → sanitize).

    ``chat_provider`` (the ChatRequest provider, same source as
    ``maybe_sync_harness_settings``) wins; otherwise the session's
    ``provider_name`` is used. Does not read config.toml or token files.
    """
    intended = _sanitized_codex_provider_id(chat_provider)
    if intended:
        return intended
    try:
        managed = manager.get(session_id, touch=False)
    except TypeError:
        managed = manager.get(session_id)
    except Exception:
        managed = None
    if managed is None:
        return None
    session = getattr(managed, "studio_session", None)
    return _sanitized_codex_provider_id(
        getattr(session, "provider_name", None) if session is not None else None
    )


def _stamped_harness_provider_id(options: Optional[Dict[str, Any]]) -> Optional[str]:
    if not isinstance(options, dict):
        return None
    text = str(options.get("model_provider") or "").strip()
    return text or None


def _provider_mismatch_requires_fresh_thread(
    stamped_provider_id: Optional[str],
    intended_provider_id: Optional[str],
) -> bool:
    """True when a stamped native thread belongs to a different provider."""
    stamped = str(stamped_provider_id or "").strip()
    intended = str(intended_provider_id or "").strip()
    return bool(stamped and intended and stamped != intended)


def _turn_error_haystack(result: TurnResult) -> str:
    parts = [
        str(getattr(result, "result_text", "") or ""),
        str(getattr(result, "tail", "") or ""),
        str(getattr(result, "status", "") or ""),
    ]
    detail = result.detail if isinstance(getattr(result, "detail", None), dict) else {}
    for key in ("error", "error_visible_text", "terminal_detail", "type"):
        parts.append(str(detail.get(key) or ""))
    return "\n".join(parts)


def is_codex_model_provider_mismatch(result: TurnResult) -> bool:
    """Detect Codex refusing to resume a thread bound to another provider."""
    if getattr(result, "ok", False):
        return False
    lowered = _turn_error_haystack(result).lower().replace("_", "")
    return (
        "modelprovidermismat" in lowered
        or "thread/resume failed" in lowered
        or "but your current provider is" in lowered
    )


# ----------------------------------------------------------------------
# unified-surface session lifecycle
# ----------------------------------------------------------------------
@dataclass(frozen=True)
class HarnessSessionLease:
    """Result of ensuring the live CLI / surface session.

    ``started_blank`` is True when this call spawned a new CLI thread
    that does *not* resume a prior native thread. The next user turn
    must then carry recent chat history or the model sees a fresh
    session (Near model-switch respawns because ``--model`` is spawn-time).
    """

    surface_session_id: str
    started_blank: bool


def ensure_harness_session(
    manager: Any, session_id: str, harness_id: str
) -> str:
    """Return the unified-surface session id for a bound studio session."""
    return ensure_harness_session_lease(manager, session_id, harness_id).surface_session_id


def ensure_harness_session_lease(
    manager: Any,
    session_id: str,
    harness_id: str,
    *,
    intended_provider_id: Optional[str] = None,
) -> HarnessSessionLease:
    """Reuse or spawn the unified-surface session and report if it is blank.

    Reuses the live adapter session when present; on cold start (adapter
    session gone) re-spawns and re-adopts the persisted native thread
    (resume) when one survives in the binding.

    If the live session reports a spawn ``model`` that differs from the
    binding's ``harness_options.model``, stop and re-spawn so the Near
    model picker takes effect (spawn-time CLI flag).

    Codex (and any binding that stamps ``harness_options.model_provider``)
    also refuses to resume a native thread when that stamp differs from
    the current intended provider. Same-provider model changes still
    resume; a provider switch starts a blank surface so the caller can
    inject history.
    """
    adapter = harness_registry().require(harness_id)
    sid = require_safe_session_id(session_id)
    binding = manager.get_session_harness(sid) or {}
    surface_sid = str(binding.get("harness_session_id") or "").strip()
    options = dict(binding.get("harness_options") or {})
    desired_model = str(options.get("model") or "").strip() or None
    native_thread = str(binding.get("harness_thread_id") or "").strip()
    intended = str(intended_provider_id or "").strip() or None
    if intended is None:
        intended = current_intended_codex_provider_id(manager, sid)
    provider_mismatch = _provider_mismatch_requires_fresh_thread(
        _stamped_harness_provider_id(options), intended
    )

    if surface_sid:
        view = adapter.describe(surface_sid)
        if view is not None:
            live_model = None
            raw = view.get("raw") if isinstance(view, dict) else None
            if isinstance(raw, dict):
                live_model = str(raw.get("model") or "").strip() or None
            if live_model is None and isinstance(view, dict):
                live_model = str(view.get("model") or "").strip() or None
            # Only enforce model mismatch when we have a desired model and
            # the adapter surfaces a spawn model (CC bridge). Exec CLIs
            # that do not report model on describe keep the live session
            # unless the stamped provider no longer matches.
            model_mismatch = (
                desired_model is not None
                and live_model is not None
                and live_model != desired_model
            )
            if model_mismatch or provider_mismatch:
                try:
                    adapter.stop(surface_sid)
                except Exception:
                    pass
                surface_sid = ""
            else:
                return HarnessSessionLease(surface_sid, started_blank=False)

    if provider_mismatch:
        native_thread = ""

    cwd = snapshot_from_session(manager, sid).cwd
    # Persist the full binding (including internal stamps) but never
    # forward those stamps as adapter spawn/CLI options.
    view = adapter.spawn(cwd, options=adapter_spawn_options(options))
    surface_sid = str(view["session_id"])
    resumed = False
    if native_thread and adapter.capabilities().resume:
        try:
            adapter.adopt_thread(surface_sid, native_thread)
            resumed = True
        except Exception:
            pass  # stale native thread: fresh one via the next turn
    manager.set_session_harness(
        sid,
        harness_id=harness_id,
        thread_id=native_thread or None,
        options=dict(options) or None,
        surface_session_id=surface_sid,
    )
    return HarnessSessionLease(surface_sid, started_blank=not resumed)


_CODEBUDDY_HARNESS_ID = "codebuddy"


def refresh_codebuddy_harness_after_oauth(
    manager: Any,
    studio_session_id: str,
) -> Dict[str, Any]:
    """Stop live CodeBuddy CLI children after Tencent OAuth so the next turn respawns.

    OAuth runs ``codebuddy login`` in a separate subprocess; the long-lived
    headless ``codebuddy --print`` harness child keeps stale auth until exit.
    """
    sid = require_safe_session_id(studio_session_id)
    adapter = harness_registry().require(_CODEBUDDY_HARNESS_ID)
    stopped: List[str] = []
    for row in adapter.list_sessions():
        if not isinstance(row, dict):
            continue
        surface = str(row.get("session_id") or "").strip()
        if not surface:
            raw = row.get("raw")
            if isinstance(raw, dict):
                surface = str(raw.get("session_id") or "").strip()
        if not surface:
            continue
        try:
            if adapter.stop(surface):
                stopped.append(surface)
        except Exception:
            pass
    binding = manager.get_session_harness(sid) or {}
    hid = str(binding.get("harness_id") or "").strip() or None
    if not hid:
        managed = manager.get(sid, touch=False)
        history = None
        if managed is not None:
            history = getattr(managed.studio_session, "chat_history", None)
        hid = derive_sticky_harness_id(history, None)
    refreshed_binding = False
    if hid == _CODEBUDDY_HARNESS_ID:
        manager.set_session_harness(
            sid,
            harness_id=_CODEBUDDY_HARNESS_ID,
            thread_id=binding.get("harness_thread_id"),
            options=dict(binding.get("harness_options") or {}),
            surface_session_id=None,
        )
        refreshed_binding = True
    return {
        "ok": True,
        "stopped_surface_ids": stopped,
        "refreshed_binding": refreshed_binding,
    }



def _append_cc_subagent_cluster_anchor(
    session: Any,
    cc_payload: Dict[str, Any],
) -> bool:
    """Persist swarm tool rows + Agent-swarm anchor for Near-orchestrated children.

    Also writes synthetic ``spawn_subagent`` tool rows so Desktop reload shows
    the same ``调用 N 次 · N 次 spawn_subagent`` group + 「Agent 蜂群」 card as
    native spawn (live turns get those via mid-turn SSE).
    """
    if not isinstance(cc_payload, dict):
        return False
    history = getattr(session, "chat_history", None)
    if not isinstance(history, list):
        return False
    cluster_id = str(cc_payload.get("cluster_id") or "").strip()
    run_ids = [
        str(item).strip()
        for item in (cc_payload.get("run_ids") or [])
        if str(item).strip()
    ]
    if not run_ids:
        run_ids = [
            str(row.get("run_id") or "").strip()
            for row in (cc_payload.get("results") or [])
            if isinstance(row, dict) and str(row.get("run_id") or "").strip()
        ]
    if not cluster_id or not run_ids:
        return False
    created_at = cc_payload.get("cluster_created_at")
    try:
        created_at_f = float(created_at) if created_at is not None else time.time()
    except (TypeError, ValueError):
        created_at_f = time.time()
    title = str(cc_payload.get("cluster_title") or "").strip()
    if not title:
        title = f"Agent 蜂群 · {len(run_ids)} 个并行任务"
    anchor = {
        "cluster_id": cluster_id,
        "run_ids": run_ids,
        "title": title,
        "created_at": created_at_f,
    }

    # Synthetic spawn_subagent rows (idempotent by tool_call_id).
    try:
        from agenticx.harness.near_cross_harness_swarm_ui import (
            collect_spawn_tool_rows_from_payload,
            spawn_tool_call_id,
        )

        existing_tids = {
            str(row.get("tool_call_id") or "").strip()
            for row in history
            if isinstance(row, dict) and str(row.get("tool_call_id") or "").strip()
        }
        tool_rows = [
            row
            for row in collect_spawn_tool_rows_from_payload(cc_payload)
            if str(row.get("tool_call_id") or "").strip() not in existing_tids
        ]
    except Exception:
        tool_rows = []

    anchor_row = {
        "role": "assistant",
        "content": "",
        "metadata": {"subagent_cluster": anchor},
        "timestamp": created_at_f,
        "source_tool_call_id": str(cc_payload.get("batch_source_id") or "").strip() or None,
    }

    # Update existing anchor in place when present.
    for row in history:
        if not isinstance(row, dict):
            continue
        meta = row.get("metadata")
        if not isinstance(meta, dict):
            continue
        existing = meta.get("subagent_cluster")
        if not isinstance(existing, dict):
            continue
        if str(existing.get("cluster_id", "") or "").strip() != cluster_id:
            continue
        changed = existing != anchor
        meta["subagent_cluster"] = anchor
        if tool_rows:
            # Insert missing tool rows just before this anchor.
            try:
                idx = history.index(row)
            except ValueError:
                idx = len(history)
            for offset, tool_row in enumerate(tool_rows):
                history.insert(idx + offset, tool_row)
            changed = True
        return changed

    # Prefer tools + cluster card *before* the just-appended harness assistant
    # summary so reload matches native mid-turn ordering.
    insert_at = len(history)
    if history:
        tail = history[-1]
        if (
            isinstance(tail, dict)
            and str(tail.get("role") or "") == "assistant"
            and isinstance(tail.get("metadata"), dict)
            and str((tail.get("metadata") or {}).get("harness") or "").strip()
            and "subagent_cluster" not in (tail.get("metadata") or {})
        ):
            insert_at = len(history) - 1
    for offset, tool_row in enumerate(tool_rows):
        history.insert(insert_at + offset, tool_row)
    history.insert(insert_at + len(tool_rows), anchor_row)
    return True


# ----------------------------------------------------------------------
# external harness turn execution (chat routing)
# ----------------------------------------------------------------------
def run_external_harness_turn(
    manager: Any,
    session_id: str,
    user_text: str,
    *,
    chat_model: Optional[str] = None,
    chat_provider: Optional[str] = None,
    skip_user_history: bool = False,
) -> TurnResult:
    """Execute one turn on the bound external harness and record it in
    chat_history (user + harness-attributed assistant message).

    Same-process single-flight: raises :class:`HarnessTurnBusyError` when a
    turn is already running for this studio session.

    ``chat_model`` (Near ``ChatRequest.model``) is folded into harness
    spawn options for adapters that already expose a native model knob.
    ``chat_provider`` (Near ``ChatRequest.provider``) is the same source
    settings sync uses to compute the Codex ``model_provider`` id.
    """
    sid = require_safe_session_id(session_id)
    if not _begin_inflight(sid):
        raise HarnessTurnBusyError(
            f"session {sid} already has an external-harness turn in flight"
        )
    try:
        return _run_external_harness_turn_body(
            manager,
            sid,
            user_text,
            chat_model=chat_model,
            chat_provider=chat_provider,
            skip_user_history=skip_user_history,
        )
    finally:
        _end_inflight(sid)



def _history_has_assistant(history: Any) -> bool:
    """True when the visible transcript already has an assistant reply."""
    for row in list(history or []):
        if not isinstance(row, dict):
            continue
        if row.get("system_notice"):
            continue
        if str(row.get("role") or "").strip() != "assistant":
            continue
        if str(row.get("content") or "").strip():
            return True
    return False


def _outbound_text_for_fresh_surface(
    manager: Any,
    session_id: str,
    harness_id: str,
    *,
    user_text: str,
    started_blank: bool,
    history: Any,
) -> str:
    """First turn on a blank CLI must carry recent history, not just the new prompt.

    Same-harness model changes and cold starts without resume otherwise look
    like a brand-new session to CodeBuddy / Claude Code. The visible
    ``chat_history`` user row stays the raw prompt; only the outbound CLI
    text is wrapped. Resume-capable re-adopts skip injection.

    Codex turns also receive :data:`CODEX_REPLY_LANGUAGE_POLICY` outside
    the non-executable handoff block, including first turns and same-thread
    resumes that do not re-inject history.
    """
    pending = user_text or "(continue)"
    if not started_blank or not _history_has_assistant(history):
        text = pending
    else:
        try:
            snapshot = snapshot_from_session(manager, session_id)
            text = handoff_engine().build_injection_text(
                snapshot,
                harness_id,
                pending_user_message=pending,
                user_strategy=STRATEGY_FULL,
            )
        except Exception:
            text = pending
        text = text or pending
    if harness_id == _CODEX_HARNESS_ID:
        return attach_codex_reply_language_policy(text)
    return text


def _retry_turn_after_provider_mismatch(
    manager: Any,
    session_id: str,
    harness_id: str,
    adapter: Any,
    surface_sid: str,
    *,
    user_text: str,
    session: Any,
    intended_provider_id: Optional[str],
) -> tuple[str, TurnResult]:
    """Drop a provider-bound native thread and retry once on a blank surface."""
    sid = session_id
    binding = manager.get_session_harness(sid) or {}
    options = dict(binding.get("harness_options") or {})
    try:
        if surface_sid:
            adapter.stop(surface_sid)
    except Exception:
        pass
    manager.set_session_harness(
        sid,
        harness_id=harness_id,
        thread_id=None,
        options=options or None,
        surface_session_id=None,
    )
    lease = ensure_harness_session_lease(
        manager,
        sid,
        harness_id,
        intended_provider_id=intended_provider_id,
    )
    outbound = _outbound_text_for_fresh_surface(
        manager,
        sid,
        harness_id,
        user_text=user_text,
        started_blank=True,
        history=session.chat_history,
    )
    request = TurnRequest(
        text=outbound,
        wait_seconds=_TURN_WAIT_SECONDS,
        owner_session_id=sid,
        studio_session_id=sid,
    )
    result = adapter.turn(lease.surface_session_id, request)
    return lease.surface_session_id, result


def _run_external_harness_turn_body(
    manager: Any,
    session_id: str,
    user_text: str,
    *,
    chat_model: Optional[str] = None,
    chat_provider: Optional[str] = None,
    skip_user_history: bool = False,
) -> TurnResult:
    sid = require_safe_session_id(session_id)
    managed = manager.get(sid)
    if managed is None:
        raise ValueError(f"session not found: {sid}")
    session = managed.studio_session
    binding = manager.get_session_harness(sid) or {}
    harness_id = str(binding.get("harness_id") or "")
    if not is_external_harness(harness_id):
        raise ValueError(f"session {sid} is not bound to an external harness")

    # Near model picker → harness_options before ensure/spawn.
    # A mid-session model change stops the live CLI (``--model`` is
    # spawn-time) and clears harness_session_id; the lease below then
    # reports started_blank so we can inject recent history.
    apply_chat_model_to_harness_options(
        manager, sid, harness_id, chat_model
    )
    # Near confirm strategy → CC auto_allow / CB permission_mode.
    apply_run_mode_to_harness_options(manager, sid, harness_id)
    provider = str(chat_provider or "").strip()
    if provider:
        session.provider_name = provider
    intended = current_intended_codex_provider_id(
        manager, sid, chat_provider=provider or chat_provider
    )

    adapter = harness_registry().require(harness_id)
    lease = ensure_harness_session_lease(
        manager, sid, harness_id, intended_provider_id=intended
    )
    surface_sid = lease.surface_session_id

    user_text = str(user_text or "").strip()
    outbound = _outbound_text_for_fresh_surface(
        manager,
        sid,
        harness_id,
        user_text=user_text,
        started_blank=lease.started_blank,
        history=session.chat_history,
    )
    if user_text:
        # Regenerate keeps the existing user row and only updates its harness
        # stamp. A missing tail still appends, matching the builtin path.
        if skip_user_history and _tail_user_text(session.chat_history) == user_text:
            restamp_tail_user_harness(
                session.chat_history, harness_id, expected_text=user_text
            )
        else:
            session.chat_history.append(
                {
                    "role": "user",
                    "content": user_text,
                    "metadata": {"harness": harness_id, "harness_id": harness_id},
                }
            )

    request = TurnRequest(
        text=outbound,
        wait_seconds=_TURN_WAIT_SECONDS,
        owner_session_id=sid,
        studio_session_id=sid,
    )
    result = adapter.turn(surface_sid, request)
    retried_mismatch = False
    if is_codex_model_provider_mismatch(result):
        # Unstamped (or missed) provider-bound threads: never leave the
        # stale native id in the binding, and never switch config.toml
        # back to the old provider. Retry once on a blank surface with
        # history injection; persist only the retry result.
        surface_sid, result = _retry_turn_after_provider_mismatch(
            manager,
            sid,
            harness_id,
            adapter,
            surface_sid,
            user_text=user_text,
            session=session,
            intended_provider_id=intended,
        )
        retried_mismatch = True

    native_thread = None
    if isinstance(result.detail, dict):
        native_thread = result.detail.get("native_thread_id")
    assistant_content = format_external_harness_assistant_content(harness_id, result)
    assistant_metadata: Dict[str, Any] = {
        "harness": harness_id,
        "harness_status": result.status,
        "native_thread_id": native_thread,
    }
    if isinstance(result.detail, dict) and result.detail.get("codebuddy_login_required") is True:
        assistant_metadata["codebuddy_login_required"] = True
    session.chat_history.append(
        {
            "role": "assistant",
            "content": assistant_content,
            "metadata": assistant_metadata,
            **turn_assistant_model_fields(session, chat_model),
        }
    )
    # CB→CC / CC→CB: register swarm card under the Near studio session (not surface_sid).
    if isinstance(result.detail, dict):
        cc_payload = result.detail.get("near_cc_subagents")
        if isinstance(cc_payload, dict):
            try:
                _append_cc_subagent_cluster_anchor(session, cc_payload)
            except Exception:
                pass
        cb_payload = result.detail.get("near_cb_subagents")
        if isinstance(cb_payload, dict):
            try:
                _append_cc_subagent_cluster_anchor(session, cb_payload)
            except Exception:
                pass
    latest = manager.get_session_harness(sid) or {}
    options = dict(latest.get("harness_options") or {})
    if harness_id == _CODEX_HARNESS_ID and intended and result.ok:
        options["model_provider"] = intended
    if retried_mismatch and not (result.ok and native_thread):
        thread_for_binding = None
    elif result.ok and native_thread:
        thread_for_binding = str(native_thread)
    elif retried_mismatch:
        thread_for_binding = None
    elif native_thread:
        thread_for_binding = str(native_thread)
    else:
        thread_for_binding = latest.get("harness_thread_id")
    if (
        retried_mismatch
        or native_thread
        or (result.ok and harness_id == _CODEX_HARNESS_ID and intended)
    ):
        manager.set_session_harness(
            sid,
            harness_id=harness_id,
            thread_id=thread_for_binding,
            options=options or None,
            surface_session_id=surface_sid,
        )
    managed.updated_at = time.time()
    try:
        manager._persist_session_state(sid, session)
    except Exception:
        pass
    return result



def turn_assistant_model_fields(
    session: Any,
    chat_model: Optional[str] = None,
) -> Dict[str, Any]:
    """Per-turn model stamp for harness assistant rows (UI ModelBadge).

    Matches builtin ``AgentRuntime`` finalize: ``model``, ``provider``, and
    ``model_selection="manual"``. Never backfills from a later session switch.
    """
    model = (
        str(chat_model or "").strip()
        or str(getattr(session, "model_name", "") or "").strip()
    )
    provider = str(getattr(session, "provider_name", "") or "").strip()
    fields: Dict[str, Any] = {"model_selection": "manual"}
    if model:
        fields["model"] = model
    if provider:
        fields["provider"] = provider
    return fields


def _session_chat_model(manager: Any, session_id: str) -> Optional[str]:
    """Near session model picker value (``StudioSession.model_name``)."""
    try:
        managed = manager.get(session_id, touch=False)
    except TypeError:
        managed = manager.get(session_id)
    except Exception:
        return None
    if managed is None:
        return None
    session = getattr(managed, "studio_session", None)
    if session is None:
        return None
    model = str(getattr(session, "model_name", "") or "").strip()
    return model or None


def _handoff_spawn_options(
    manager: Any,
    session_id: str,
    target_harness: str,
    binding: Dict[str, Any],
    *,
    same_harness: bool,
) -> Optional[Dict[str, Any]]:
    """Options for the handoff target spawn.

    Same-harness rebinds keep existing options. Cross-harness switches
    start fresh but fold in the current Near chat model when the target
    exposes a native ``model`` knob — so the injected surface already
    has the right ``--model`` and the next turn will not respawn.
    """
    options: Dict[str, Any] = {}
    if same_harness:
        options = dict(binding.get("harness_options") or {})
    hid = str(target_harness or "").strip()
    if hid in _HARNESSES_WITH_MODEL_OPTION:
        model = _session_chat_model(manager, session_id)
        if model:
            options["model"] = model
    return options or None


# ----------------------------------------------------------------------
# mid-session switch
# ----------------------------------------------------------------------

def sync_builtin_agent_messages_from_chat_history(session: Any) -> int:
    """Project UI ``chat_history`` into ``agent_messages`` for agenticx/builtin.

    External harness turns only write ``chat_history``. Builtin ``run_turn``
    reads ``agent_messages``. Hot-switch back to agenticx must rebuild the
    model context from the visible transcript or the next turn looks empty.
    System-notice switch markers are skipped.
    """
    history = list(getattr(session, "chat_history", None) or [])
    projected: List[Dict[str, Any]] = []
    for row in history:
        if not isinstance(row, dict):
            continue
        if row.get("system_notice"):
            continue
        role = str(row.get("role") or "").strip()
        if role not in ("user", "assistant", "system"):
            continue
        content = row.get("content")
        if content is None:
            continue
        if isinstance(content, str) and not content.strip() and role == "user":
            continue
        entry: Dict[str, Any] = {"role": role, "content": content}
        meta = row.get("metadata")
        if isinstance(meta, dict) and meta:
            slim = {
                key: meta[key]
                for key in ("harness", "harness_id")
                if key in meta and meta[key] is not None
            }
            if slim:
                entry["metadata"] = slim
        projected.append(entry)
    session.agent_messages = projected
    return len(projected)


def switch_harness(
    manager: Any,
    session_id: str,
    target_harness: str,
    *,
    strategy: Optional[str] = None,
    manual_context: Optional[str] = None,
) -> Dict[str, Any]:
    """Switch a session to another harness with context handoff.

    Returns ``{ok, strategy, from, to, handoff_id, notes, ...}`` on
    success. Raises :class:`HandoffError` / :class:`HandoffPlanError` /
    ``ValueError`` on failure -- in every failure case the session keeps
    its previous binding (fail closed).
    """
    target = str(target_harness or "").strip()
    if not target:
        raise ValueError("target harness is required")
    sid = require_safe_session_id(session_id)
    managed = manager.get(sid)
    if managed is None:
        raise ValueError(f"session not found: {sid}")
    session = managed.studio_session
    # Never mutate bindings / chat_history while a turn is appending to it.
    if is_turn_inflight(sid):
        raise HarnessTurnBusyError(
            f"session {sid} has a harness turn in flight; "
            "switch after it settles"
        )
    binding = manager.get_session_harness(sid) or {}
    current = str(binding.get("harness_id") or "")

    # Same-harness rebind is a no-op (idempotent switch).
    if (target or None) == (current or None) or (
        not is_external_harness(target) and not is_external_harness(current)
    ):
        return {
            "ok": True,
            "strategy": "noop",
            "from": current,
            "to": target,
            "handoff_id": None,
            "notes": ["already bound"],
        }

    user_strategy = None
    if strategy and str(strategy).strip() and str(strategy).strip() != "auto":
        user_strategy = str(strategy).strip()

    # Switching back to the builtin/agenticx runtime.
    # External harness turns only append to chat_history; builtin run_turn
    # reads agent_messages. Sync the visible transcript into agent_messages
    # before unbind, otherwise the next agenticx turn has empty context
    # (repro: session 88c93d1c after claude-code → AgenticX).
    if not is_external_harness(target):
        synced = sync_builtin_agent_messages_from_chat_history(session)
        notes = [f"synced {synced} turns into agent_messages"] if synced else []
        _append_switch_boundary(
            manager,
            session,
            sid,
            from_harness=current,
            to_harness=None,
            strategy="builtin",
            handoff_id=None,
            notes=notes,
        )
        manager.set_session_harness(sid, harness_id=None)
        try:
            manager._persist_session_state(sid, session)
        except Exception:
            pass
        return {
            "ok": True,
            "strategy": "builtin",
            "from": current,
            "to": None,
            "handoff_id": None,
            "notes": notes,
            "synced_agent_messages": synced,
        }

    engine = handoff_engine()
    adapter = harness_registry().require(target)  # raises UnknownHarnessError
    if not adapter.available():
        raise HandoffError(f"harness {target} is not available on this machine")

    snapshot = snapshot_from_session(manager, sid)
    if user_strategy == STRATEGY_MANUAL and not (manual_context or "").strip():
        raise HandoffError("manual_context strategy requires manual context text")

    # Fresh-session fast path: nothing to hand off — plain rebind with no
    # boundary marker and no injection turn (the next user message starts
    # the target harness organically).
    has_conversation = any(
        str(row.get("role", "")) in ("user", "assistant")
        for row in session.chat_history
    )
    if not has_conversation:
        manager.set_session_harness(
            sid,
            harness_id=target,
            thread_id=None,
            options=None,
            surface_session_id=None,
        )
        return {
            "ok": True,
            "from": current or None,
            "to": target,
            "strategy": "noop",
            "handoff_id": None,
            "native_thread_id": None,
            "notes": "fresh session: bound without handoff",
        }

    spawn_options = _handoff_spawn_options(
        manager,
        sid,
        target,
        binding,
        same_harness=(target == current),
    )
    result = engine.execute_handoff(
        snapshot,
        target,
        user_strategy=user_strategy,
        manual_context=manual_context,
        pending_user_message="",
        spawn_options=spawn_options,
    )

    native_thread = result.handoff.resumed_native_thread_id or (
        result.handoff.target_native_thread_id
    )
    manager.set_session_harness(
        sid,
        harness_id=target,
        thread_id=str(native_thread or "") or None,
        options=spawn_options,
        surface_session_id=result.detail.get("target_session_id"),
    )
    _append_switch_boundary(
        manager,
        session,
        sid,
        from_harness=current,
        to_harness=target,
        strategy=result.plan.strategy,
        handoff_id=result.handoff.handoff_id,
        notes=list(result.plan.notes or []),
    )
    return {
        "ok": True,
        "strategy": result.plan.strategy,
        "from": current,
        "to": target,
        "handoff_id": result.handoff.handoff_id,
        "target_session_id": result.detail.get("target_session_id"),
        "native_thread_id": native_thread,
        "notes": list(result.plan.notes or []),
        "reason": result.plan.reason,
        "turn_status": result.turn.status if result.turn else None,
        "turn_result_text": (result.turn.result_text[:500] if result.turn else ""),
    }


def _append_switch_boundary(
    manager: Any,
    session: Any,
    session_id: str,
    *,
    from_harness: Optional[str],
    to_harness: Optional[str],
    strategy: str,
    handoff_id: Optional[str],
    notes: List[str],
) -> None:
    """Record the visible switch boundary as a system-notice message."""
    sid = require_safe_session_id(session_id)
    from_name = harness_display_name(from_harness)
    to_name = harness_display_name(to_harness)
    notes_text = ""
    if notes:
        notes_text = "（" + "；".join(str(n) for n in notes[:3]) + "）"
    content = (
        f"已切换执行引擎：{from_name} → {to_name}"
        f"（策略 {strategy}）{notes_text}"
    )
    metadata: Dict[str, Any] = {
        "kind": "harness_switch",
        "from_harness": from_harness,
        "to_harness": to_harness,
        "strategy": strategy,
    }
    if handoff_id:
        metadata["handoff_id"] = handoff_id
    session.chat_history.append(
        {
            "role": "system",
            "content": content,
            "system_notice": True,
            "metadata": metadata,
        }
    )
    try:
        manager._persist_session_state(sid, session)
    except Exception:
        pass


def handoff_audit(session_id: str) -> List[Dict[str, Any]]:
    """Audit view of every handoff record for a session."""
    return handoff_engine().audit_view(require_safe_session_id(session_id))


async def run_external_harness_turn_async(
    manager: Any,
    session_id: str,
    user_text: str,
    *,
    chat_model: Optional[str] = None,
    chat_provider: Optional[str] = None,
    skip_user_history: bool = False,
) -> TurnResult:
    """Async wrapper: adapter turns block for the whole turn, so run them
    on a worker thread to keep the event loop responsive."""
    return await asyncio.to_thread(
        run_external_harness_turn,
        manager,
        session_id,
        user_text,
        chat_model=chat_model,
        chat_provider=chat_provider,
        skip_user_history=skip_user_history,
    )


async def switch_harness_async(
    manager: Any,
    session_id: str,
    target_harness: str,
    *,
    strategy: Optional[str] = None,
    manual_context: Optional[str] = None,
) -> Dict[str, Any]:
    return await asyncio.to_thread(
        switch_harness,
        manager,
        session_id,
        target_harness,
        strategy=strategy,
        manual_context=manual_context,
    )


__all__ = [
    "HandoffError",
    "HandoffPlanError",
    "HandoffSummary",
    "HarnessTurnBusyError",
    "handoff_audit",
    "handoff_engine",
    "harness_display_name",
    "harness_registry",
    "apply_chat_model_to_harness_options",
    "turn_assistant_model_fields",
    "is_external_harness",
    "is_turn_inflight",
    "run_external_harness_turn",
    "run_external_harness_turn_async",
    "snapshot_from_session",
    "switch_harness",
    "sync_builtin_agent_messages_from_chat_history",
    "switch_harness_async",
]
