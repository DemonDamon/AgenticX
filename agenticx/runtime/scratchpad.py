#!/usr/bin/env python3
"""Session scratchpad for reusable intermediate results.

Author: Damon Li
"""

from __future__ import annotations

from typing import Dict, List, Tuple

MAX_SCRATCHPAD_KEYS = 50
MAX_VALUE_CHARS = 10_000


class Scratchpad:
    """In-memory key-value scratchpad with size constraints."""

    def __init__(self) -> None:
        self._store: Dict[str, str] = {}

    def to_dict(self) -> Dict[str, str]:
        """Return a copy for persistence."""
        return dict(self._store)

    def load_dict(self, payload: Dict[str, str]) -> None:
        """Load values from persistence payload."""
        self._store = {}
        for key, value in payload.items():
            if not key:
                continue
            self._store[str(key)] = str(value)[:MAX_VALUE_CHARS]

    def write(self, key: str, value: str) -> str:
        """Write one key-value pair."""
        key = str(key).strip()
        if not key:
            return "ERROR: key is required"
        if key not in self._store and len(self._store) >= MAX_SCRATCHPAD_KEYS:
            return f"ERROR: scratchpad key limit exceeded ({MAX_SCRATCHPAD_KEYS})"
        normalized = str(value)
        if len(normalized) > MAX_VALUE_CHARS:
            normalized = normalized[:MAX_VALUE_CHARS] + f"\n... (truncated to {MAX_VALUE_CHARS} chars)"
        self._store[key] = normalized
        return f"OK: scratchpad[{key}] updated"

    def read(self, key: str) -> str:
        """Read one key value."""
        key = str(key).strip()
        if not key:
            return "ERROR: key is required"
        if key not in self._store:
            return f"ERROR: key not found: {key}"
        return self._store[key]

    def list_keys(self) -> List[str]:
        """List keys in alphabetical order."""
        return sorted(self._store.keys())

    def items_preview(self, max_chars: int = 200) -> List[Tuple[str, str]]:
        """Build key/value previews for prompt context."""
        rows: List[Tuple[str, str]] = []
        for key in self.list_keys():
            raw = self._store.get(key, "")
            preview = raw if len(raw) <= max_chars else raw[:max_chars] + "..."
            rows.append((key, preview.replace("\n", "\\n")))
        return rows
