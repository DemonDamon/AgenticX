#!/usr/bin/env python3
"""Capability-declaration vs implementation consistency tests (04).

AC-3 of the runtime-invariants master plan: a harness whose declared
capabilities are not backed by real implementations must fail here.

Author: Damon Li
"""

from __future__ import annotations

import stat
from typing import Any, Dict, List, Optional

import pytest

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import capability_mismatches, default_registry
from agenticx.harness.types import (
    CapabilityNotSupported,
    HARNESS_EVENT_TYPES,
    HarnessCapabilities,
)


class _LyingAdapter(HarnessAdapter):
    """Declares capabilities it does not implement at all."""

    harness_id = "lying"
    display_name = "Lying"
    description = "declares everything, implements nothing"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=True,
            pty=True,
            streaming=True,
            turn_snapshots=True,
            idempotency=True,
            resume=True,
        )

    def spawn(self, cwd, *, options: Optional[Dict[str, Any]] = None):
        return {}

    def turn(self, session_id, request):
        raise NotImplementedError

    def stop(self, session_id) -> bool:
        return False

    def available(self) -> bool:
        return True

    def describe(self, session_id):
        return None

    def list_sessions(self) -> List[Dict[str, Any]]:
        return []


def test_builtin_adapters_have_no_capability_mismatch() -> None:
    for adapter in default_registry().adapters():
        assert capability_mismatches(adapter) == [], (
            f"capability mismatch on {adapter.harness_id}"
        )


def test_mismatched_adapter_is_reported() -> None:
    mismatches = capability_mismatches(_LyingAdapter())
    joined = "\n".join(mismatches)
    assert "streaming=True" in joined
    assert "pty=True" in joined
    assert "permission=True" in joined
    assert "resume=True" in joined
    assert len(mismatches) == 4


def test_harness_event_types_vocabulary_is_pinned() -> None:
    assert HARNESS_EVENT_TYPES == frozenset({"turn_started", "turn_finished"})


def test_spawned_session_probe_matches_declared_capabilities(
    tmp_path, monkeypatch
) -> None:
    # Behavior-level probe on a real spawned session (fake executable):
    # declared-off capabilities must raise CapabilityNotSupported, and a
    # declared resume implementation must exist (ValueError on an empty
    # thread id is the engine's own contract).
    from agenticx.harness.adapters.opencode import OpenCodeAdapter

    exe = tmp_path / "fake-opencode"
    exe.write_text("#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("AGX_OPENCODE_EXECUTABLE", str(exe))

    adapter = OpenCodeAdapter()
    view = adapter.spawn(str(tmp_path))
    sid = view["session_id"]

    with pytest.raises(CapabilityNotSupported):
        adapter.iter_stream_chunks(sid)
    with pytest.raises(CapabilityNotSupported):
        adapter.permission(sid, None)
    with pytest.raises(ValueError):
        adapter.adopt_thread(sid, "")
