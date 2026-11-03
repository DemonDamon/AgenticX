#!/usr/bin/env python3
"""Unified harness control surface (SP1 of the harness-control-surface plan).

One protocol (``HarnessAdapter``: spawn / turn / stream / permission /
stop / capabilities), one registry, and one HTTP API over every coding
agent harness. Additive to the legacy cc/wb bridge apps.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import HarnessRegistry, default_registry
from agenticx.harness.types import (
    CapabilityNotSupported,
    HarnessCapabilities,
    HarnessDescriptor,
    PermissionDecision,
    SessionNotFoundError,
    TurnInProgressError,
    TurnRequest,
    TurnResult,
    UnknownHarnessError,
)

__all__ = [
    "HarnessAdapter",
    "HarnessRegistry",
    "default_registry",
    "HarnessCapabilities",
    "HarnessDescriptor",
    "TurnRequest",
    "TurnResult",
    "PermissionDecision",
    "CapabilityNotSupported",
    "SessionNotFoundError",
    "TurnInProgressError",
    "UnknownHarnessError",
]
