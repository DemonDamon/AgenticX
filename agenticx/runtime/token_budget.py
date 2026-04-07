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
from typing import Any, Dict, Optional

_log = logging.getLogger(__name__)


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


class TokenBudgetGuard:
    """Per-session token budget with tiered enforcement.

    Thresholds (fraction of max_tokens_per_session):
      - 80%: WARNING  -> inject convergence hint
      - 95%: COMPRESS -> force context compaction
      - 100%: EXCEEDED -> terminate turn and output current results
    """

    def __init__(
        self,
        max_tokens_per_session: int = 0,
        max_tokens_per_turn: int = 0,
    ) -> None:
        self.max_session = max_tokens_per_session or _env_int("AGX_MAX_TOKENS_PER_SESSION", 500_000)
        self.max_turn = max_tokens_per_turn or _env_int("AGX_MAX_TOKENS_PER_TURN", 100_000)
        self.enforce_turn_limit = str(os.environ.get("AGX_ENFORCE_TURN_TOKEN_BUDGET", "0")).strip() == "1"
        self.cumulative_input: int = 0
        self.cumulative_output: int = 0
        self.turn_input: int = 0
        self.turn_output: int = 0

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

    def check_session(self) -> BudgetLevel:
        """Check cumulative session budget."""
        if self.max_session <= 0:
            return BudgetLevel.OK
        ratio = self.cumulative_total / self.max_session
        if ratio >= 1.0:
            return BudgetLevel.EXCEEDED
        if ratio >= 0.95:
            return BudgetLevel.COMPRESS
        if ratio >= 0.80:
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
            "max_session": self.max_session,
            "max_turn": self.max_turn,
        }

    @classmethod
    def from_metadata(cls, data: Dict[str, Any]) -> "TokenBudgetGuard":
        """Restore from persisted metadata."""
        guard = cls(
            max_tokens_per_session=int(data.get("max_session", 500_000) or 500_000),
            max_tokens_per_turn=int(data.get("max_turn", 100_000) or 100_000),
        )
        guard.cumulative_input = int(data.get("cumulative_input", 0) or 0)
        guard.cumulative_output = int(data.get("cumulative_output", 0) or 0)
        return guard
