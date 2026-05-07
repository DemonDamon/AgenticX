#!/usr/bin/env python3
"""Per-task token totals using last-reported deltas (avoid double counting).

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple


@dataclass
class TokenLedger:
    total_input: int = 0
    total_output: int = 0
    last_reported_input: int = 0
    last_reported_output: int = 0

    def absorb(self, *, input_tokens: int, output_tokens: int) -> Tuple[int, int]:
        in_delta = max(0, int(input_tokens) - int(self.last_reported_input))
        out_delta = max(0, int(output_tokens) - int(self.last_reported_output))
        self.total_input += in_delta
        self.total_output += out_delta
        self.last_reported_input = int(input_tokens)
        self.last_reported_output = int(output_tokens)
        return in_delta, out_delta


@dataclass
class TaskTokenAccountant:
    _ledgers: Dict[str, TokenLedger] = field(default_factory=dict)

    def absorb(self, task_id: str, *, input_tokens: int, output_tokens: int) -> Tuple[int, int]:
        ledger = self._ledgers.setdefault(str(task_id), TokenLedger())
        return ledger.absorb(input_tokens=input_tokens, output_tokens=output_tokens)

    def snapshot(self, task_id: str) -> TokenLedger:
        return self._ledgers.get(str(task_id), TokenLedger())

    def forget(self, task_id: str) -> None:
        self._ledgers.pop(str(task_id), None)
