#!/usr/bin/env python3
"""Replace known secret values in events, streams, and log records.

Values shorter than 8 characters are ignored, matching credential_store.

Author: Damon Li
"""

from __future__ import annotations

import logging
import re
import threading
import traceback
from typing import Any, Iterable, Mapping

REDACT_MIN_LEN = 8


class SecretRedactor:
    """Replace known secret values with ``[REDACTED:<label>]``.

    Longer values are replaced first so a shorter secret that is a prefix of
    a longer one does not split it.
    """

    def __init__(self, secrets: Mapping[str, str]) -> None:
        self._load((str(label), value) for label, value in secrets.items())

    @classmethod
    def from_pairs(cls, pairs: Iterable[tuple[str, str]]) -> SecretRedactor:
        redactor = cls({})
        redactor._load(pairs)
        return redactor

    def _load(self, pairs: Iterable[tuple[str, str]]) -> None:
        by_value: dict[str, str] = {}
        for label, value in pairs:
            if isinstance(value, str) and len(value) >= REDACT_MIN_LEN:
                by_value.setdefault(value, str(label))
        ordered = sorted(by_value.items(), key=lambda item: -len(item[0]))
        self._by_value = dict(ordered)
        self._entries = tuple((label, value) for value, label in ordered)
        if ordered:
            self._pattern: re.Pattern[str] | None = re.compile(
                "|".join(re.escape(value) for value, _label in ordered)
            )
        else:
            self._pattern = None

    @property
    def empty(self) -> bool:
        return not self._entries

    @property
    def values(self) -> tuple[str, ...]:
        return tuple(value for _label, value in self._entries)

    @property
    def entries(self) -> tuple[tuple[str, str], ...]:
        """``(label, value)`` pairs, longest value first."""
        return self._entries

    def redact(self, text: str) -> str:
        if not text or self._pattern is None:
            return text
        return self._pattern.sub(
            lambda match: f"[REDACTED:{self._by_value[match.group(0)]}]",
            text,
        )

    def redact_obj(self, obj: Any) -> Any:
        """Deep-copy ``obj``, redacting every string. Dict keys are kept."""
        if isinstance(obj, str):
            return self.redact(obj)
        if isinstance(obj, list):
            return [self.redact_obj(item) for item in obj]
        if isinstance(obj, tuple):
            return tuple(self.redact_obj(item) for item in obj)
        if isinstance(obj, dict):
            return {key: self.redact_obj(value) for key, value in obj.items()}
        return obj


class StreamRedactor:
    """Redact a text stream without leaking a secret split across deltas."""

    def __init__(self, redactor: SecretRedactor) -> None:
        self._redactor = redactor
        self._buf = ""

    def feed(self, delta: str) -> str:
        if not delta:
            return ""
        self._buf += delta
        tail = self._held_suffix_length(self._buf)
        if tail:
            emit = self._buf[: len(self._buf) - tail]
            self._buf = self._buf[-tail:]
        else:
            emit = self._buf
            self._buf = ""
        return self._redactor.redact(emit)

    def flush(self) -> str:
        emit = self._redactor.redact(self._buf)
        self._buf = ""
        return emit

    def _held_suffix_length(self, buf: str) -> int:
        best = 0
        for secret in self._redactor.values:
            limit = min(len(secret) - 1, len(buf))
            for length in range(limit, 0, -1):
                if length <= best:
                    break
                if buf.endswith(secret[:length]):
                    best = length
                    break
        return best


class ProcessSecretRegistry:
    """Union of secrets of all live managed sessions, used by the log factory."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, SecretRedactor] = {}

    def register(self, key: str, redactor: SecretRedactor) -> None:
        with self._lock:
            self._items[key] = redactor

    def unregister(self, key: str) -> None:
        with self._lock:
            self._items.pop(key, None)

    def redact(self, text: str) -> str:
        if not text:
            return text
        with self._lock:
            redactors = tuple(self._items.values())
        if not redactors:
            return text
        pairs: list[tuple[str, str]] = []
        for redactor in redactors:
            pairs.extend(redactor.entries)
        if not pairs:
            return text
        return SecretRedactor.from_pairs(pairs).redact(text)


PROCESS_SECRETS = ProcessSecretRegistry()
_LOG_REDACTION_INSTALLED = False


def install_log_redaction() -> None:
    """Wrap logging's LogRecord factory once. Failures keep the original record."""
    global _LOG_REDACTION_INSTALLED
    if _LOG_REDACTION_INSTALLED:
        return
    previous = logging.getLogRecordFactory()

    def factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = previous(*args, **kwargs)
        try:
            message = record.getMessage()
            redacted = PROCESS_SECRETS.redact(message)
            if redacted != message:
                record.msg = redacted
                record.args = ()
            if record.exc_info:
                text = "".join(traceback.format_exception(*record.exc_info))
                record.exc_text = PROCESS_SECRETS.redact(text)
                record.exc_info = None
        except Exception:
            return record
        return record

    logging.setLogRecordFactory(factory)
    _LOG_REDACTION_INSTALLED = True


__all__ = [
    "PROCESS_SECRETS",
    "REDACT_MIN_LEN",
    "ProcessSecretRegistry",
    "SecretRedactor",
    "StreamRedactor",
    "install_log_redaction",
]
