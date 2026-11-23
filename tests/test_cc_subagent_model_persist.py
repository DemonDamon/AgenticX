#!/usr/bin/env python3
"""CC subagent model picker persistence via SubAgentRunStore.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.runtime.subagent_runs import SubAgentRunStore


def test_update_model_persists_catalog_provider_for_cc_run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    sid = "sess-cc-model-1"
    store = SubAgentRunStore(sid)
    store.open_run(
        run_id="cc-subagent-f17b0265ac-1",
        kind="claude-code",
        name="claude-code-1-美国党派",
        role="Claude Code CLI subagent",
        task="research",
        status="completed",
        provider="claude-code",
        model="glm-5.3-flash",
    )

    updated = store.update_model(
        "cc-subagent-f17b0265ac-1",
        provider="彩讯",
        model="glm-5.3-flash",
    )
    assert updated is not None
    assert updated.provider == "彩讯"
    assert updated.model == "glm-5.3-flash"

    reloaded = SubAgentRunStore(sid).get_run("cc-subagent-f17b0265ac-1")
    assert reloaded is not None
    assert reloaded.provider == "彩讯"
    assert reloaded.model == "glm-5.3-flash"

    # index mirrors provider/model for status poll / clusters
    index = store._load_index()
    row = index["runs"]["cc-subagent-f17b0265ac-1"]
    assert row["provider"] == "彩讯"
    assert row["model"] == "glm-5.3-flash"


def test_update_model_missing_run_returns_none(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = SubAgentRunStore("sess-missing")
    assert (
        store.update_model("cc-subagent-nope", provider="彩讯", model="glm-5.3-flash")
        is None
    )
