#!/usr/bin/env python3
"""Dispatch-time side-effect guard for the product AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Iterable, Literal

from agenticx.reliability.call_identity import canonical_call_key, canonical_payload
from agenticx.reliability.call_ledger import CallLedger
from agenticx.runtime.replay_ledger.effects import classify_tool_effect

logger = logging.getLogger(__name__)

PROCESS_START_TS: float = time.time()
PRIOR_MAX_AGE_SECONDS: float = 24 * 3600

_GUARDED_UNKNOWN_TOOLS = frozenset({"bash_exec", "bash_bg_start", "mcp_call"})
_GUARDED_UNKNOWN_PREFIXES = ("computer_", "near_browser_click", "near_browser_type")
_RUNTIME_ARG_KEYS = frozenset({"__tool_call_id", "__agent_id"})
_TRUE_TOKENS = frozenset({"1", "true", "yes", "on"})
_FALSE_TOKENS = frozenset({"0", "false", "no", "off"})

ORPHAN_TEXT = (
    "未执行：同一操作在上次运行中已发出，但应用在拿到结果前退出，结果未知。"
    "请先用只读方式核验它是否已经生效（例如查看消息、远端仓库或目标系统）。"
    "如果确认没有生效、且用户仍要执行，再调用一次即可，下一次会正常执行。"
)
REUSED_PREFIX = "[已复用中断前完成的结果，本次未重复执行]\n"
LEDGER_FAIL_TEXT = (
    "未执行：执行外部操作前写入副作用账本失败，为避免崩溃后重复执行已跳过。"
    "请检查磁盘空间或 ~/.agenticx/sessions 权限后重试。"
)

_interrupted_lock = threading.Lock()
_INTERRUPTED_SESSIONS: set[str] = set()


def register_interrupted_sessions(session_ids: Iterable[str]) -> None:
    """Union startup-interrupted session ids. Repeat calls are harmless."""
    with _interrupted_lock:
        for session_id in session_ids:
            text = str(session_id or "").strip()
            if text:
                _INTERRUPTED_SESSIONS.add(text)


def is_interrupted_at_startup(session_id: str) -> bool:
    """True when the startup scan marked this session interrupted."""
    with _interrupted_lock:
        return str(session_id or "").strip() in _INTERRUPTED_SESSIONS


def _token_bool(value: str) -> bool | None:
    text = value.strip().lower()
    if text in _TRUE_TOKENS:
        return True
    if text in _FALSE_TOKENS:
        return False
    return None


def effect_guard_enabled() -> bool:
    """``AGX_EFFECT_GUARD`` / ``runtime.effect_guard``. Default True."""
    env = _token_bool(os.environ.get("AGX_EFFECT_GUARD", ""))
    if env is not None:
        return env
    cfg: Any = None
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg = ConfigManager.get_value("runtime.effect_guard")
    except Exception:
        cfg = None
    if isinstance(cfg, bool):
        return cfg
    if isinstance(cfg, str):
        parsed = _token_bool(cfg)
        if parsed is not None:
            return parsed
    if isinstance(cfg, int) and not isinstance(cfg, bool):
        if cfg == 0:
            return False
        if cfg == 1:
            return True
    return True


def is_guarded_call(tool_name: str, arguments: dict[str, Any]) -> bool:
    """True for external writes and a small set of unknown side-effect tools."""
    effect = classify_tool_effect(tool_name, arguments)
    if effect == "external_write":
        return True
    if effect != "unknown":
        return False
    return tool_name in _GUARDED_UNKNOWN_TOOLS or tool_name.startswith(
        _GUARDED_UNKNOWN_PREFIXES
    )


def resolve_session_id(session: Any) -> str:
    """``_session_id`` then ``_owner_session_id`` then ``session_id``."""
    return str(
        getattr(session, "_session_id", "")
        or getattr(session, "_owner_session_id", "")
        or getattr(session, "session_id", "")
        or ""
    ).strip()


@dataclass(frozen=True)
class GuardDecision:
    action: Literal["dispatch", "prefilled"]
    text: str | None = None
    ledger_call_id: str | None = None


def _decision_after_ledger_error() -> GuardDecision:
    """Strict posture skips the call; legacy logs and continues unrecorded."""
    from agenticx.runtime.harden_flags import reliability_posture

    if reliability_posture() == "strict":
        return GuardDecision("prefilled", text=LEDGER_FAIL_TEXT)
    logger.warning(
        "effect guard ledger write failed; continuing without a ledger record",
        exc_info=True,
    )
    return GuardDecision("dispatch")


class EffectGuard:
    """Per-session guard that blocks duplicate external writes after a crash."""

    def __init__(self, session_id: str, *, root: str | None = None) -> None:
        self._ledger = CallLedger(session_id, root=root)
        self.session_id = self._ledger.session_id
        self._pending_meta: dict[str, tuple[str, str]] = {}

    def before_dispatch(
        self, *, tool_call_id: str, tool_name: str, arguments: dict[str, Any]
    ) -> GuardDecision:
        """Decide whether to run a tool call or return a prefilled result."""
        if not is_guarded_call(tool_name, arguments):
            return GuardDecision("dispatch")
        clean = {k: v for k, v in arguments.items() if k not in _RUNTIME_ARG_KEYS}
        key = canonical_call_key(tool_name, clean)
        digest = hashlib.sha256(canonical_payload(clean).encode("utf-8")).hexdigest()
        try:
            prior = self._ledger.find_prior_by_canonical_key(
                key,
                dispatched_before=PROCESS_START_TS,
                max_age_seconds=PRIOR_MAX_AGE_SECONDS,
            )
        except Exception:
            return _decision_after_ledger_error()
        if prior is not None and prior.state == "dispatched":
            try:
                self._ledger.mark_reconciled(prior.call_id, "orphan_intercepted")
            except Exception:
                return _decision_after_ledger_error()
            self._emit_guard_audit(
                kind="effect_intercepted",
                outcome="orphan_blocked",
                tool_name=tool_name,
                args_digest=digest,
            )
            return GuardDecision("prefilled", text=ORPHAN_TEXT)
        if (
            prior is not None
            and prior.state == "completed"
            and prior.result_payload is not None
            and is_interrupted_at_startup(self.session_id)
        ):
            try:
                self._ledger.mark_reconciled(prior.call_id, "completed_reused")
            except Exception:
                return _decision_after_ledger_error()
            self._emit_guard_audit(
                kind="effect_intercepted",
                outcome="completed_reused",
                tool_name=tool_name,
                args_digest=digest,
            )
            return GuardDecision(
                "prefilled", text=REUSED_PREFIX + prior.result_payload
            )
        # Providers reuse ids such as "call_0" across rounds; the suffix keeps
        # each dispatch on its own ledger row.
        ledger_call_id = f"{tool_call_id or 'call'}:{uuid.uuid4().hex[:8]}"
        try:
            self._ledger.record_dispatch(
                ledger_call_id,
                tool_name,
                clean,
                replay_safety=classify_tool_effect(tool_name, arguments),
            )
        except Exception:
            return _decision_after_ledger_error()
        self._pending_meta[ledger_call_id] = (tool_name, digest)
        return GuardDecision("dispatch", ledger_call_id=ledger_call_id)

    def after_result(
        self, ledger_call_id: str, result: str, *, is_error: bool
    ) -> None:
        """Record success or failure. Ledger errors are logged and swallowed."""
        meta = self._pending_meta.pop(str(ledger_call_id), None)
        try:
            text = str(result)
            if is_error:
                self._ledger.record_failure(ledger_call_id, text[:2000])
            else:
                self._ledger.record_result(ledger_call_id, text)
        except Exception:
            logger.warning(
                "effect guard failed to record result call_id=%s",
                ledger_call_id,
                exc_info=True,
            )
        if meta is None:
            return
        tool_name, digest = meta
        self._emit_guard_audit(
            kind="external_effect",
            outcome="failed" if is_error else "completed",
            tool_name=tool_name,
            args_digest=digest,
        )

    def _emit_guard_audit(
        self,
        *,
        kind: str,
        outcome: str,
        tool_name: str,
        args_digest: str,
    ) -> None:
        """Best-effort audit. A missing outbox must not change the guard decision."""
        try:
            from agenticx.runtime.action_audit import emit_action_audit
        except Exception:
            logger.debug("action audit import failed", exc_info=True)
            return
        emit_action_audit(
            {
                "kind": kind,
                "outcome": outcome,
                "tool_name": tool_name,
                "args_digest": args_digest,
                "session_id": self.session_id,
                "decision_source": "",
                "summary": "",
            }
        )
