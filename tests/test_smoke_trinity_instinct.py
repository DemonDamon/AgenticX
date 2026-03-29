#!/usr/bin/env python3
"""Smoke tests for trinity instinct learning components.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.learning.instinct import Instinct
from agenticx.learning.instinct_store import InstinctStore
from agenticx.learning.observer import ObservationHook


def test_instinct_roundtrip_markdown() -> None:
    instinct = Instinct(
        id="prefer-smoke-tests",
        trigger="when adding new behavior",
        action="add smoke test first",
        confidence=0.7,
        domain="testing",
        scope="project",
        project_id="abc12345",
        evidence=["added three smoke tests"],
    )
    parsed = Instinct.from_markdown(instinct.to_markdown())
    assert parsed.id == instinct.id
    assert parsed.trigger == instinct.trigger
    assert parsed.scope == "project"
    assert parsed.evidence == instinct.evidence


def test_instinct_store_persists_and_loads(tmp_path: Path) -> None:
    store = InstinctStore(root_dir=tmp_path / "instincts")
    instinct = Instinct(
        id="keep-diffs-small",
        trigger="when patching core runtime",
        action="split into isolated commits",
        confidence=0.6,
        domain="workflow",
        scope="global",
        project_id=None,
    )
    path = store.save(instinct)
    assert path.exists()
    loaded = store.list_instincts(scope="global")
    assert len(loaded) == 1
    assert loaded[0].id == "keep-diffs-small"


def test_observation_hook_writes_jsonl(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_LEARNING_ENABLED", "true")
    monkeypatch.setattr("agenticx.learning.observer.Path.home", lambda: tmp_path)
    session = StudioSession()
    session.workspace_dir = str(tmp_path / "workspace")
    session.session_id = "sess-1"
    hook = ObservationHook()

    async def _run() -> None:
        await hook.after_tool_call("file_read", "ok-result", session)
        await asyncio.sleep(0.05)

    asyncio.run(_run())
    project_id = hook._project_id(session)  # noqa: SLF001
    output_file = tmp_path / ".agenticx" / "instincts" / "projects" / project_id / "observations.jsonl"
    assert output_file.exists()
    content = output_file.read_text(encoding="utf-8")
    assert "file_read" in content
