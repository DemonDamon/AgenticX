#!/usr/bin/env python3
"""Smoke tests for isolated episode delete (SIGSEGV containment).

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.memory.graph.store import MemoryGraphUnavailableError


def test_remove_episode_in_subprocess_surfaces_child_failure(monkeypatch):
    from agenticx.memory.graph import episode_delete as delete_mod

    class _Proc:
        returncode = 1
        stdout = ""
        stderr = "simulated delete failure"

    monkeypatch.setattr(delete_mod.subprocess, "run", lambda *a, **k: _Proc())

    with pytest.raises(MemoryGraphUnavailableError, match="simulated delete failure"):
        delete_mod.remove_episode_in_subprocess("ep-1")


def test_remove_episode_in_subprocess_surfaces_sigsegv(monkeypatch):
    from agenticx.memory.graph import episode_delete as delete_mod

    class _Proc:
        returncode = -11
        stdout = ""
        stderr = ""

    monkeypatch.setattr(delete_mod.subprocess, "run", lambda *a, **k: _Proc())

    with pytest.raises(MemoryGraphUnavailableError, match="SIGSEGV"):
        delete_mod.remove_episode_in_subprocess("ep-bad")


def test_remove_episodes_in_subprocess_collects_partial_failures(monkeypatch):
    from agenticx.memory.graph import episode_delete as delete_mod
    from agenticx.memory.graph.store import MemoryGraphUnavailableError

    def _fake_single(eid: str) -> None:
        if eid == "bad-1":
            raise MemoryGraphUnavailableError("simulated corrupt episode")

    monkeypatch.setattr(delete_mod, "remove_episode_in_subprocess", _fake_single)

    result = delete_mod.remove_episodes_in_subprocess(["good-1", "bad-1"])
    assert result["deleted"] == ["good-1"]
    assert result["failed"][0]["episode_uuid"] == "bad-1"
