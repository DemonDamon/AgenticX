"""Tests for mcp_state.json quarantine bookkeeping."""

from __future__ import annotations

import json

import pytest


@pytest.fixture
def state_file(tmp_path, monkeypatch):
    path = tmp_path / "mcp_state.json"
    monkeypatch.setattr(
        "agenticx.runtime.global_mcp_state._state_path",
        lambda: path,
    )
    return path


def test_record_restore_failure_increments_and_clear(state_file):
    from agenticx.runtime.global_mcp_state import (
        clear_quarantine,
        read_quarantined,
        record_restore_failure,
    )

    assert record_restore_failure("chrome-devtools") == 1
    assert read_quarantined() == {"chrome-devtools": 1}
    assert record_restore_failure("chrome-devtools") == 2
    assert read_quarantined() == {"chrome-devtools": 2}

    clear_quarantine("chrome-devtools")
    assert read_quarantined() == {}


def test_write_last_connected_preserves_quarantined(state_file):
    from agenticx.runtime.global_mcp_state import (
        read_quarantined,
        record_restore_failure,
        write_last_connected,
    )

    record_restore_failure("bad-mcp")
    write_last_connected(["feishu-mcp", "baidu-maps"])

    raw = json.loads(state_file.read_text(encoding="utf-8"))
    assert raw["last_connected"] == ["baidu-maps", "feishu-mcp"]
    assert raw["quarantined"] == {"bad-mcp": 1}
    assert read_quarantined() == {"bad-mcp": 1}


def test_read_quarantined_missing_or_corrupt(state_file):
    from agenticx.runtime.global_mcp_state import read_quarantined

    assert read_quarantined() == {}

    state_file.write_text("{not json", encoding="utf-8")
    assert read_quarantined() == {}

    state_file.write_text(json.dumps({"quarantined": "oops"}), encoding="utf-8")
    assert read_quarantined() == {}
