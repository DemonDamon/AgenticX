"""Shared types for Data Suite agent templates."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class WebhookEvent:
    kind: str
    payload: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GovernanceTodo:
    field: str
    reason: str
    detail: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class WriteGuardPolicy:
    deny_tool_names: frozenset[str] = frozenset({"bash_exec", "file_write", "shell"})
    allow_prefixes: frozenset[str] = frozenset({"data_suite_"})
