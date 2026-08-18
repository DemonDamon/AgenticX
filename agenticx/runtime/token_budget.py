#!/usr/bin/env python3
"""Token budget guard for session-level and turn-level spending limits.

Tracks cumulative token usage per session and enforces configurable
thresholds with tiered responses (warn -> compress -> terminate).

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
MIN_MAX_TOKENS_PER_TURN = 50_000
MAX_MAX_TOKENS_PER_TURN = 1_000_000
TOKEN_BUDGET_SCRATCHPAD_KEY = "_token_budget_usage_v1"


class BudgetLevel(str, Enum):
    OK = "ok"
    WARNING = "warning"
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


def resolve_token_budget_limits(
    *,
    max_tokens_per_session: Optional[int] = None,
    max_tokens_per_turn: Optional[int] = None,
) -> Tuple[int, int]:
    """Resolve session/turn token limits: explicit args > config > env > defaults."""
    session_limit = max_tokens_per_session
    turn_limit = max_tokens_per_turn

    if session_limit is None or turn_limit is None:
        try:
            from agenticx.cli.config_manager import ConfigManager

            global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
            project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
            merged = ConfigManager._deep_merge(global_data, project_data)
            tb = ConfigManager._get_nested(merged, "runtime.token_budget")
            if isinstance(tb, dict):
                if session_limit is None:
                    raw_session = tb.get("max_tokens_per_session")
                    if raw_session is not None:
                        session_limit = int(raw_session)
                if turn_limit is None:
                    raw_turn = tb.get("max_tokens_per_turn")
                    if raw_turn is not None:
                        turn_limit = int(raw_turn)
        except Exception as exc:
            _log.debug("token budget config read skipped: %s", exc)

    if session_limit is None:
        session_limit = _env_int("AGX_MAX_TOKENS_PER_SESSION", DEFAULT_MAX_TOKENS_PER_SESSION)
    if turn_limit is None:
        turn_limit = _env_int("AGX_MAX_TOKENS_PER_TURN", DEFAULT_MAX_TOKENS_PER_TURN)

    session_limit = _clamp_int(int(session_limit), MIN_MAX_TOKENS_PER_SESSION, MAX_MAX_TOKENS_PER_SESSION)
    turn_limit = _clamp_int(int(turn_limit), MIN_MAX_TOKENS_PER_TURN, MAX_MAX_TOKENS_PER_TURN)
    return session_limit, turn_limit


class TokenBudgetGuard:
    """Per-session token budget with tiered enforcement.

    Session thresholds:
      - fixed 500,000 tokens: WARNING -> notify and inject convergence hint
      - 95%: COMPRESS -> force context compaction
      - 100%: EXCEEDED -> reject the next turn; the current paid turn may finish
    """

    def __init__(
        self,
        max_tokens_per_session: int = 0,
        max_tokens_per_turn: int = 0,
    ) -> None:
        if max_tokens_per_session > 0:
            self.max_session = int(max_tokens_per_session)
        else:
            self.max_session = resolve_token_budget_limits()[0]
        if max_tokens_per_turn > 0:
            self.max_turn = int(max_tokens_per_turn)
        else:
            self.max_turn = resolve_token_budget_limits()[1]
        self.enforce_turn_limit = str(os.environ.get("AGX_ENFORCE_TURN_TOKEN_BUDGET", "0")).strip() == "1"
        self.cumulative_input: int = 0
        self.cumulative_output: int = 0
        self.turn_input: int = 0
        self.turn_output: int = 0
        self.warning_emitted: bool = False

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
        self.warning_emitted = bool(payload.get("warning_emitted", False))
        self.reset_turn()

    def check_session(self) -> BudgetLevel:
        """Check cumulative session budget."""
        if self.max_session <= 0:
            return BudgetLevel.OK
        if self.cumulative_total >= self.max_session:
            return BudgetLevel.EXCEEDED
        ratio = self.cumulative_total / self.max_session
        if ratio >= 0.95:
            return BudgetLevel.COMPRESS
        if self.cumulative_total >= DEFAULT_WARNING_TOKENS_PER_SESSION:
            return BudgetLevel.WARNING
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
        severity = [BudgetLevel.OK, BudgetLevel.WARNING, BudgetLevel.COMPRESS, BudgetLevel.EXCEEDED]
        return max(session_level, turn_level, key=lambda x: severity.index(x))

    def check_with_source(self) -> tuple[BudgetLevel, str, int, int]:
        """Return (level, source, current, max_allowed) with dominant source."""
        session_level = self.check_session()
        turn_level = self.check_turn()
        severity = [BudgetLevel.OK, BudgetLevel.WARNING, BudgetLevel.COMPRESS, BudgetLevel.EXCEEDED]
        if severity.index(session_level) >= severity.index(turn_level):
            return session_level, "session", self.cumulative_total, self.max_session
        return turn_level, "turn", self.turn_total, self.max_turn

    def convergence_hint(self) -> str:
        """System hint injected when budget reaches WARNING level."""
        pct = (
            int(100 * self.cumulative_total / self.max_session)
            if self.max_session > 0 else 0
        )
        return (
            f"<budget_warning>Token budget at {pct}% ({self.cumulative_total}/{self.max_session}). "
            "Please wrap up: summarize findings, skip optional exploration, and converge to final answer."
            "</budget_warning>"
        )

    def to_metadata(self) -> Dict[str, Any]:
        """Serialize for session persistence."""
        return {
            "cumulative_input": self.cumulative_input,
            "cumulative_output": self.cumulative_output,
            "warning_emitted": self.warning_emitted,
            "max_session": self.max_session,
            "max_turn": self.max_turn,
        }

    @classmethod
    def from_metadata(cls, data: Dict[str, Any]) -> "TokenBudgetGuard":
        """Restore from persisted metadata."""
        guard = cls(
            max_tokens_per_session=int(data.get("max_session", DEFAULT_MAX_TOKENS_PER_SESSION) or DEFAULT_MAX_TOKENS_PER_SESSION),
            max_tokens_per_turn=int(data.get("max_turn", DEFAULT_MAX_TOKENS_PER_TURN) or DEFAULT_MAX_TOKENS_PER_TURN),
        )
        guard.restore_usage(data)
        return guard


def session_token_budget_preflight(
    scratchpad: Any,
    *,
    max_tokens_per_session: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Return a terminal error payload when persisted usage blocks the next turn.

    Only cumulative usage is restored from the session. The active configuration
    remains authoritative, so increasing the hard cap immediately unlocks a session.
    """
    guard = TokenBudgetGuard(max_tokens_per_session=int(max_tokens_per_session or 0))
    persisted = (
        scratchpad.get(TOKEN_BUDGET_SCRATCHPAD_KEY)
        if isinstance(scratchpad, dict)
        else None
    )
    guard.restore_usage(persisted if isinstance(persisted, dict) else None)
    if guard.check_session() != BudgetLevel.EXCEEDED:
        return None
    return {
        "text": (
            "本会话已达到 Token 上限 "
            f"（{guard.cumulative_total}/{guard.max_session}）。"
            "请新建会话，或在开发者设置提高上限后继续。"
        ),
        "detector": "token_budget",
        "budget_exceeded": True,
        "budget_source": "session",
        "current": guard.cumulative_total,
        "max_allowed": guard.max_session,
        "blocked_before_model": True,
    }
