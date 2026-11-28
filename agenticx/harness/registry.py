#!/usr/bin/env python3
"""Harness adapter registry.

Author: Damon Li
"""

from __future__ import annotations

import threading
from typing import Dict, List, Optional

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.types import HarnessDescriptor, UnknownHarnessError


class HarnessRegistry:
    """Thread-safe id -> adapter registry.

    SP2 (Codex / OpenCode) and SP3 (python-agent) plug in here via
    ``register``; nothing else in the codebase needs to know the set of
    harnesses ahead of time.
    """

    def __init__(self) -> None:
        self._adapters: Dict[str, HarnessAdapter] = {}
        self._lock = threading.Lock()

    def register(self, adapter: HarnessAdapter, *, replace: bool = False) -> None:
        if not adapter.harness_id:
            raise ValueError("adapter.harness_id must be a non-empty string")
        with self._lock:
            existing = self._adapters.get(adapter.harness_id)
            if existing is not None and existing is not adapter and not replace:
                raise ValueError(
                    f"harness already registered: {adapter.harness_id}"
                )
            self._adapters[adapter.harness_id] = adapter

    def unregister(self, harness_id: str) -> bool:
        with self._lock:
            return self._adapters.pop(harness_id, None) is not None

    def get(self, harness_id: str) -> Optional[HarnessAdapter]:
        with self._lock:
            return self._adapters.get(harness_id)

    def require(self, harness_id: str) -> HarnessAdapter:
        """Get or raise :class:`UnknownHarnessError`."""
        adapter = self.get(harness_id)
        if adapter is None:
            raise UnknownHarnessError(harness_id, self.list_ids())
        return adapter

    def list_ids(self) -> List[str]:
        with self._lock:
            return list(self._adapters.keys())

    def adapters(self) -> List[HarnessAdapter]:
        with self._lock:
            return list(self._adapters.values())

    def descriptors(self) -> List[HarnessDescriptor]:
        """Registry view for /v1/harnesses (id, capabilities, availability)."""
        out: List[HarnessDescriptor] = []
        for adapter in self.adapters():
            try:
                is_available = bool(adapter.available())
            except Exception:
                is_available = False
            out.append(
                HarnessDescriptor(
                    harness_id=adapter.harness_id,
                    display_name=adapter.display_name,
                    description=adapter.description,
                    capabilities=adapter.capabilities(),
                    available=is_available,
                )
            )
        return out


def capability_mismatches(adapter: HarnessAdapter) -> List[str]:
    """Report declared capabilities that the adapter does not implement.

    Static reflection over the adapter class (including inherited
    overrides): each mismatch is one human-readable sentence. The
    consistency tests assert the builtin adapters produce none of these
    and that a deliberately lying adapter does.

    ``streaming`` accepts either an ``iter_stream_chunks`` override or a
    callable ``drain_midturn_stream_items`` (the Codex app-server pump
    is a real streaming implementation that does not use the chunk
    iterator). ``idempotency`` / ``turn_snapshots`` / ``handoff_injection``
    have no dedicated method to reflect on, so they are not judged here;
    their behavior is pinned by the existing turn tests instead.
    """
    caps = adapter.capabilities()
    cls = type(adapter)

    def _overridden(name: str) -> bool:
        return getattr(cls, name, None) is not getattr(HarnessAdapter, name, None)

    out: List[str] = []
    if caps.streaming and not (
        _overridden("iter_stream_chunks")
        or callable(getattr(adapter, "drain_midturn_stream_items", None))
    ):
        out.append(
            f"{adapter.harness_id}: declares streaming=True but implements "
            "neither iter_stream_chunks nor drain_midturn_stream_items"
        )
    if caps.pty and not (_overridden("write_pty") and _overridden("resize_pty")):
        out.append(
            f"{adapter.harness_id}: declares pty=True without both write_pty "
            "and resize_pty overrides"
        )
    if caps.permission and not _overridden("permission"):
        out.append(
            f"{adapter.harness_id}: declares permission=True without a "
            "permission override"
        )
    if caps.resume and not _overridden("adopt_thread"):
        out.append(
            f"{adapter.harness_id}: declares resume=True without an "
            "adopt_thread override"
        )
    return out


_default_registry: Optional[HarnessRegistry] = None
_default_registry_lock = threading.Lock()


def default_registry() -> HarnessRegistry:
    """Process-wide registry with the builtin SP1 adapters registered.

    Lazily imports the adapter implementations so importing this module
    stays cheap and cycle-free.
    """
    global _default_registry
    with _default_registry_lock:
        if _default_registry is None:
            registry = HarnessRegistry()
            from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter
            from agenticx.harness.adapters.codebuddy import CodeBuddyAdapter
            from agenticx.harness.adapters.codex import CodexAdapter
            from agenticx.harness.adapters.opencode import OpenCodeAdapter

            registry.register(ClaudeCodeAdapter())
            registry.register(CodeBuddyAdapter())
            registry.register(CodexAdapter())
            registry.register(OpenCodeAdapter())
            _default_registry = registry
        return _default_registry
