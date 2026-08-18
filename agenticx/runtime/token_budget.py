#!/usr/bin/env python3
"""Token budget guard for session-level notices and turn-level safety limits.

Tracks cumulative token usage per session and emits configurable yellow/red
notices without interrupting work.  The explicit per-turn safety budget keeps
its existing warn/compress/optional-stop semantics.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
from enum import Enum
from typing import Any, Dict, Optional, Tuple

_log = logging.getLogger(__name__)

DEFAULT_MAX_TOKENS_PER_SESSION = 1_000_000
DEFAULT_WARNING_TOKENS_PER_SESSION = 500_000
DEFAULT_MAX_TOKENS_PER_TURN = 100_000
MIN_MAX_TOKENS_PER_SESSION = 100_000
MAX_MAX_TOKENS_PER_SESSION = 5_000_000
MIN_WARNING_TOKENS_PER_SESSION = 50_000
MAX_WARNING_TOKENS_PER_SESSION = MAX_MAX_TOKENS_PER_SESSION - 1
MIN_MAX_TOKENS_PER_TURN = 50_000
MAX_MAX_TOKENS_PER_TURN = 1_000_000
TOKEN_BUDGET_SCRATCHPAD_KEY = "_token_budget_usage_v1"


class BudgetLevel(str, Enum):
    OK = "ok"
    YELLOW = "warning"
    # Backward-compatible alias used by the per-turn budget path.
    WARNING = "warning"
    RED = "red"
    COMPRESS = "compress"
    EXCEEDED = "exceeded"


def _env_int(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return default


def _clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def _optional_int(value: Any) -> Optional[int]:
    """Parse a persisted integer without letting one corrupt field discard its siblings."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return None


def resolve_token_budget_settings(
    *,
    max_tokens_per_session: Optional[int] = None,
    warning_tokens_per_session: Optional[int] = None,
    max_tokens_per_turn: Optional[int] = None,
) -> Tuple[int, int, int]:
    """Resolve red/yellow/turn thresholds from explicit, managed, and local policy.

    Enterprise policy is active only for an authenticated enterprise session. It
    overrides the local developer settings without rewriting them, so signing out
    naturally restores the user's self-managed limits.
    """
    session_limit = max_tokens_per_session
    warning_limit = warning_tokens_per_session
    turn_limit = max_tokens_per_turn

    if session_limit is None or warning_limit is None or turn_limit is None:
        try:
            from agenticx.cli.config_manager import ConfigManager

            global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
            project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
            merged = ConfigManager._deep_merge(global_data, project_data)
            enterprise = merged.get("enterprise") if isinstance(merged, dict) else None
            enterprise_active = (
                isinstance(enterprise, dict)
                and enterprise.get("enabled") is True
                and bool(str(enterprise.get("token") or "").strip())
            )
            managed_tb = (
                ConfigManager._get_nested(merged, "enterprise.policy.token_budget")
                if enterprise_active
                else None
            )
            local_tb = ConfigManager._get_nested(merged, "runtime.token_budget")

            def _configured_value(key: str) -> Optional[int]:
                if isinstance(managed_tb, dict):
                    managed_value = _optional_int(managed_tb.get(key))
                    if managed_value is not None:
                        return managed_value
                if isinstance(local_tb, dict):
                    return _optional_int(local_tb.get(key))
                return None

            if session_limit is None:
                session_limit = _configured_value("max_tokens_per_session")
            if warning_limit is None:
                warning_limit = _configured_value("warning_tokens_per_session")
            if turn_limit is None:
                turn_limit = _configured_value("max_tokens_per_turn")
        except Exception as exc:
            _log.debug("token budget config read skipped: %s", exc)

    if session_limit is None:
        session_limit = _env_int("AGX_MAX_TOKENS_PER_SESSION", DEFAULT_MAX_TOKENS_PER_SESSION)
    if warning_limit is None:
        warning_limit = _env_int(
            "AGX_WARNING_TOKENS_PER_SESSION",
            DEFAULT_WARNING_TOKENS_PER_SESSION,
        )
    if turn_limit is None:
        turn_limit = _env_int("AGX_MAX_TOKENS_PER_TURN", DEFAULT_MAX_TOKENS_PER_TURN)

    session_limit = _clamp_int(int(session_limit), MIN_MAX_TOKENS_PER_SESSION, MAX_MAX_TOKENS_PER_SESSION)
    warning_limit = _clamp_int(
        int(warning_limit),
        MIN_WARNING_TOKENS_PER_SESSION,
        min(MAX_WARNING_TOKENS_PER_SESSION, session_limit - 1),
    )
    turn_limit = _clamp_int(int(turn_limit), MIN_MAX_TOKENS_PER_TURN, MAX_MAX_TOKENS_PER_TURN)
    return session_limit, warning_limit, turn_limit


def resolve_token_budget_limits(
    *,
    max_tokens_per_session: Optional[int] = None,
    max_tokens_per_turn: Optional[int] = None,
) -> Tuple[int, int]:
    """Backward-compatible resolver for callers that only need red/turn thresholds."""
    session_limit, _warning_limit, turn_limit = resolve_token_budget_settings(
        max_tokens_per_session=max_tokens_per_session,
        max_tokens_per_turn=max_tokens_per_turn,
    )
    return session_limit, turn_limit


class TokenBudgetGuard:
    """Cumulative session notices plus an independent per-turn safety budget.

    Session thresholds:
      - ``warning_tokens_per_session`` (default 500,000): yellow notice once
      - ``max_tokens_per_session`` (default 1,000,000): red notice once

    The historical configuration keys remain stable on the wire, but neither
    session threshold is a hard limit.  Session usage never triggers compaction,
    convergence prompts, or rejection of a later turn.
    """

    def __init__(
        self,
        max_tokens_per_session: int = 0,
        warning_tokens_per_session: int = 0,
        max_tokens_per_turn: int = 0,
    ) -> None:
        resolved_session, resolved_warning, resolved_turn = resolve_token_budget_settings()
        if max_tokens_per_session > 0:
            self.red_session = int(max_tokens_per_session)
        else:
            self.red_session = resolved_session
        if warning_tokens_per_session > 0:
            self.yellow_session = int(warning_tokens_per_session)
        else:
            self.yellow_session = resolved_warning
        self.yellow_session = max(1, min(self.yellow_session, self.red_session - 1))
        if max_tokens_per_turn > 0:
            self.max_turn = int(max_tokens_per_turn)
        else:
            self.max_turn = resolved_turn
        self.enforce_turn_limit = str(os.environ.get("AGX_ENFORCE_TURN_TOKEN_BUDGET", "0")).strip() == "1"
        self.cumulative_input: int = 0
        self.cumulative_output: int = 0
        self.turn_input: int = 0
        self.turn_output: int = 0
        self.yellow_emitted: bool = False
        self.red_emitted: bool = False

    @property
    def max_session(self) -> int:
        """Compatibility alias for the historical red-threshold wire name."""
        return self.red_session

    @property
    def warning_session(self) -> int:
        """Compatibility alias for the historical yellow-threshold wire name."""
        return self.yellow_session

    @property
    def warning_emitted(self) -> bool:
        """Compatibility alias for persisted yellow-notice state."""
        return self.yellow_emitted

    @warning_emitted.setter
    def warning_emitted(self, value: bool) -> None:
        self.yellow_emitted = bool(value)

    @property
    def cumulative_total(self) -> int:
        return self.cumulative_input + self.cumulative_output

    @property
    def turn_total(self) -> int:
        return self.turn_input + self.turn_output

    def reset_turn(self) -> None:
        """Call at the start of each run_turn."""
        self.turn_input = 0
        self.turn_output = 0

    def record(self, usage: Optional[Dict[str, int]]) -> None:
        """Record token usage from one LLM call."""
        if not usage:
            return
        inp = int(usage.get("input_tokens", 0) or 0)
        out = int(usage.get("output_tokens", 0) or 0)
        self.cumulative_input += inp
        self.cumulative_output += out
        self.turn_input += inp
        self.turn_output += out

    def restore_usage(self, data: Optional[Dict[str, Any]]) -> None:
        """Restore cumulative usage without replacing the active configured limits."""
        payload = data if isinstance(data, dict) else {}
        self.cumulative_input = max(0, int(payload.get("cumulative_input", 0) or 0))
        self.cumulative_output = max(0, int(payload.get("cumulative_output", 0) or 0))
        yellow_at_present = "yellow_emitted_at" in payload or "warning_emitted_at" in payload
        yellow_at_raw = payload.get("yellow_emitted_at", payload.get("warning_emitted_at"))
        try:
            yellow_at = max(0, int(yellow_at_raw or 0))
        except (TypeError, ValueError, OverflowError):
            yellow_at = 0
        if yellow_at_present:
            self.yellow_emitted = yellow_at == self.yellow_session
        else:
            # Metadata written before threshold-aware latches only carried a bool.
            self.yellow_emitted = bool(
                payload.get("yellow_emitted", payload.get("warning_emitted", False))
            )

        red_at_present = "red_emitted_at" in payload
        red_at_raw = payload.get("red_emitted_at")
        try:
            red_at = max(0, int(red_at_raw or 0))
        except (TypeError, ValueError, OverflowError):
            red_at = 0
        if red_at_present:
            self.red_emitted = red_at == self.red_session
        else:
            self.red_emitted = bool(payload.get("red_emitted", False))
        # A red notice subsumes the yellow notice even if persisted metadata was
        # partially written or came from an older build.
        if self.red_emitted:
            self.yellow_emitted = True
        self.reset_turn()

    def check_session(self) -> BudgetLevel:
        """Return the current non-blocking session notice level."""
        if self.red_session <= 0:
            return BudgetLevel.OK
        if self.cumulative_total >= self.red_session:
            return BudgetLevel.RED
        if self.cumulative_total >= self.yellow_session:
            return BudgetLevel.YELLOW
        return BudgetLevel.OK

    def check_turn(self) -> BudgetLevel:
        """Check per-turn budget."""
        if self.max_turn <= 0:
            return BudgetLevel.OK
        ratio = self.turn_total / self.max_turn
        if ratio >= 1.0:
            # By default, do not hard-stop solely on per-turn budget because
            # long-running tasks can legitimately exceed this threshold.
            return BudgetLevel.EXCEEDED if self.enforce_turn_limit else BudgetLevel.COMPRESS
        if ratio >= 0.95:
            return BudgetLevel.COMPRESS
        if ratio >= 0.80:
            return BudgetLevel.WARNING
        return BudgetLevel.OK

    def check(self) -> BudgetLevel:
        """Return the highest severity level from session + turn checks."""
        session_level = self.check_session()
        turn_level = self.check_turn()
        severity = [
            BudgetLevel.OK,
            BudgetLevel.YELLOW,
            BudgetLevel.RED,
            BudgetLevel.COMPRESS,
            BudgetLevel.EXCEEDED,
        ]
        return max(session_level, turn_level, key=lambda x: severity.index(x))

    def check_with_source(self) -> tuple[BudgetLevel, str, int, int]:
        """Return (level, source, current, max_allowed) with dominant source."""
        session_level = self.check_session()
        turn_level = self.check_turn()
        severity = [
            BudgetLevel.OK,
            BudgetLevel.YELLOW,
            BudgetLevel.RED,
            BudgetLevel.COMPRESS,
            BudgetLevel.EXCEEDED,
        ]
        if severity.index(session_level) >= severity.index(turn_level):
            return session_level, "session", self.cumulative_total, self.red_session
        return turn_level, "turn", self.turn_total, self.max_turn

    def turn_convergence_hint(self) -> str:
        """System hint used only by the independent per-turn safety budget."""
        pct = (
            int(100 * self.turn_total / self.max_turn)
            if self.max_turn > 0 else 0
        )
        return (
            f"<budget_warning>Current turn token budget at {pct}% "
            f"({self.turn_total}/{self.max_turn}). "
            "Please wrap up: summarize findings, skip optional exploration, and converge to final answer."
            "</budget_warning>"
        )

    def to_metadata(self) -> Dict[str, Any]:
        """Serialize for session persistence."""
        return {
            "cumulative_input": self.cumulative_input,
            "cumulative_output": self.cumulative_output,
            "yellow_emitted": self.yellow_emitted,
            "yellow_emitted_at": self.yellow_session if self.yellow_emitted else 0,
            "red_emitted": self.red_emitted,
            "red_emitted_at": self.red_session if self.red_emitted else 0,
            # Legacy metadata remains readable by older Desktop/runtime builds.
            "warning_emitted": self.yellow_emitted,
            "warning_emitted_at": self.yellow_session if self.yellow_emitted else 0,
            "warning_tokens_per_session": self.yellow_session,
            "max_tokens_per_session": self.red_session,
            "max_session": self.red_session,
            "max_turn": self.max_turn,
        }

    @classmethod
    def from_metadata(cls, data: Dict[str, Any]) -> "TokenBudgetGuard":
        """Restore from persisted metadata."""
        guard = cls(
            max_tokens_per_session=int(data.get("max_session", DEFAULT_MAX_TOKENS_PER_SESSION) or DEFAULT_MAX_TOKENS_PER_SESSION),
            warning_tokens_per_session=int(
                data.get("warning_tokens_per_session", DEFAULT_WARNING_TOKENS_PER_SESSION)
                or DEFAULT_WARNING_TOKENS_PER_SESSION
            ),
            max_tokens_per_turn=int(data.get("max_turn", DEFAULT_MAX_TOKENS_PER_TURN) or DEFAULT_MAX_TOKENS_PER_TURN),
        )
        guard.restore_usage(data)
        return guard
