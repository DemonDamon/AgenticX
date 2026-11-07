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
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.utils.agx_home import agx_home
from agenticx.harness.registry import HarnessRegistry, default_registry
from agenticx.harness.types import TurnRequest, TurnResult
from agenticx.harness.handoff import (
    AppThreadSnapshot,
    HandoffEngine,
    HandoffError,
    HandoffPlanError,
    HandoffStore,
    HistoryMessage,
    RunRecord,
    STRATEGY_MANUAL,
    ThreadBinding,
)
from agenticx.harness.handoff.types import HandoffSummary
from agenticx.studio.session_manager import require_safe_session_id

_TURN_WAIT_SECONDS = 240.0

_BUILTIN_HARNESS_IDS = frozenset({"", "python-agent"})

# Harnesses whose spawn() already accepts a native ``model`` option.
# codebuddy CLI exposes ``--model`` (verified via ``codebuddy --help``);
# keep this set in sync with desktop HARNESSES_WITH_NATIVE_MODEL_OPTION.
_HARNESSES_WITH_MODEL_OPTION = frozenset(
    {"claude-code", "codex", "opencode", "codebuddy"}
)

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
        return "python-agent"
    try:
        descriptor = harness_registry().describe(harness_id)
        return descriptor.display_name if descriptor else harness_id
    except Exception:
        return harness_id


def is_external_harness(harness_id: Optional[str]) -> bool:
    return bool(harness_id) and harness_id not in _BUILTIN_HARNESS_IDS


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


# ----------------------------------------------------------------------
# unified-surface session lifecycle
# ----------------------------------------------------------------------
def ensure_harness_session(
    manager: Any, session_id: str, harness_id: str
) -> str:
    """Return the unified-surface session id for a bound studio session.

    Reuses the live adapter session when present; on cold start (adapter
    session gone) re-spawns and re-adopts the persisted native thread
    (resume) when one survives in the binding.

    If the live session reports a spawn ``model`` that differs from the
    binding's ``harness_options.model``, stop and re-spawn so the Near
    model picker takes effect (spawn-time CLI flag).
    """
    adapter = harness_registry().require(harness_id)
    sid = require_safe_session_id(session_id)
    binding = manager.get_session_harness(sid) or {}
    surface_sid = str(binding.get("harness_session_id") or "").strip()
    options = dict(binding.get("harness_options") or {})
    desired_model = str(options.get("model") or "").strip() or None

    if surface_sid:
        view = adapter.describe(surface_sid)
        if view is not None:
            live_model = None
            raw = view.get("raw") if isinstance(view, dict) else None
            if isinstance(raw, dict):
                live_model = str(raw.get("model") or "").strip() or None
            if live_model is None and isinstance(view, dict):
                live_model = str(view.get("model") or "").strip() or None
            # Only enforce mismatch when we have a desired model and the
            # adapter surfaces a spawn model (CC bridge). Exec CLIs that
            # do not report model on describe keep the live session.
            if (
                desired_model is not None
                and live_model is not None
                and live_model != desired_model
            ):
                try:
                    adapter.stop(surface_sid)
                except Exception:
                    pass
                surface_sid = ""
            else:
                return surface_sid

    cwd = snapshot_from_session(manager, sid).cwd
    view = adapter.spawn(cwd, options=dict(options))
    surface_sid = str(view["session_id"])
    native_thread = str(binding.get("harness_thread_id") or "").strip()
    if native_thread and adapter.capabilities().resume:
        try:
            adapter.adopt_thread(surface_sid, native_thread)
        except Exception:
            pass  # stale native thread: fresh one via the next turn
    manager.set_session_harness(
        sid,
        harness_id=harness_id,
        thread_id=native_thread or None,
        options=dict(options) or None,
        surface_session_id=surface_sid,
    )
    return surface_sid


# ----------------------------------------------------------------------
# external harness turn execution (chat routing)
# ----------------------------------------------------------------------
def run_external_harness_turn(
    manager: Any,
    session_id: str,
    user_text: str,
    *,
    chat_model: Optional[str] = None,
) -> TurnResult:
    """Execute one turn on the bound external harness and record it in
    chat_history (user + harness-attributed assistant message).

    Same-process single-flight: raises :class:`HarnessTurnBusyError` when a
    turn is already running for this studio session.

    ``chat_model`` (Near ``ChatRequest.model``) is folded into harness
    spawn options for adapters that already expose a native model knob.
    """
    sid = require_safe_session_id(session_id)
    if not _begin_inflight(sid):
        raise HarnessTurnBusyError(
            f"session {sid} already has an external-harness turn in flight"
        )
    try:
        return _run_external_harness_turn_body(
            manager, sid, user_text, chat_model=chat_model
        )
    finally:
        _end_inflight(sid)


def _run_external_harness_turn_body(
    manager: Any,
    session_id: str,
    user_text: str,
    *,
    chat_model: Optional[str] = None,
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
    apply_chat_model_to_harness_options(
        manager, sid, harness_id, chat_model
    )
    # Near confirm strategy → CC auto_allow / CB permission_mode.
    apply_run_mode_to_harness_options(manager, sid, harness_id)
    binding = manager.get_session_harness(sid) or {}

    adapter = harness_registry().require(harness_id)
    surface_sid = ensure_harness_session(manager, sid, harness_id)

    user_text = str(user_text or "").strip()
    if user_text:
        session.chat_history.append(
            {
                "role": "user",
                "content": user_text,
                "metadata": {"harness": harness_id},
            }
        )

    request = TurnRequest(text=user_text or "(continue)", wait_seconds=_TURN_WAIT_SECONDS)
    result = adapter.turn(surface_sid, request)

    native_thread = None
    if isinstance(result.detail, dict):
        native_thread = result.detail.get("native_thread_id")
    assistant_content = str(result.result_text or "").strip()
    if not result.ok:
        assistant_content = (
            f"[harness {harness_id} turn {result.status}] "
            f"{str(result.result_text or '').strip()[:500]}"
        )
    session.chat_history.append(
        {
            "role": "assistant",
            "content": assistant_content,
            "metadata": {
                "harness": harness_id,
                "harness_status": result.status,
                "native_thread_id": native_thread,
            },
        }
    )
    # Keep the binding's native-thread handle fresh for resume/handoff.
    if native_thread:
        manager.set_session_harness(
            sid,
            harness_id=harness_id,
            thread_id=str(native_thread),
            options=binding.get("harness_options"),
            surface_session_id=surface_sid,
        )
    managed.updated_at = time.time()
    try:
        manager._persist_session_state(sid, session)
    except Exception:
        pass
    return result



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

    # Switching back to the builtin python-agent runtime: the canonical
    # chat_history IS its context, so only the boundary marker + rebind
    # are needed (isomorphic switch; no engine handoff required).
    if not is_external_harness(target):
        _append_switch_boundary(
            manager,
            session,
            sid,
            from_harness=current,
            to_harness=None,
            strategy="builtin",
            handoff_id=None,
            notes=[],
        )
        manager.set_session_harness(sid, harness_id=None)
        return {
            "ok": True,
            "strategy": "builtin",
            "from": current,
            "to": None,
            "handoff_id": None,
            "notes": [],
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
) -> TurnResult:
    """Async wrapper: adapter turns block for the whole turn, so run them
    on a worker thread to keep the event loop responsive."""
    return await asyncio.to_thread(
        run_external_harness_turn,
        manager,
        session_id,
        user_text,
        chat_model=chat_model,
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
    "is_external_harness",
    "is_turn_inflight",
    "run_external_harness_turn",
    "run_external_harness_turn_async",
    "snapshot_from_session",
    "switch_harness",
    "switch_harness_async",
]
