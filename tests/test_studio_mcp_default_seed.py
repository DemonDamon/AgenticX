"""First-run ~/.agenticx/mcp.json seed with browser-use."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def fake_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return tmp_path


def test_ensure_default_creates_browser_use_once(fake_home: Path) -> None:
    from agenticx.cli.studio_mcp import (
        agenticx_home_mcp_path,
        ensure_default_agenticx_mcp_json,
        load_available_servers,
    )

    target = agenticx_home_mcp_path()
    assert not target.exists()
    assert ensure_default_agenticx_mcp_json() is True
    assert target.exists()
    data = json.loads(target.read_text(encoding="utf-8"))
    assert "browser-use" in data
    bu = data["browser-use"]
    assert bu["command"] == "uvx"
    assert bu["args"] == ["browser-use[cli]", "--mcp"]
    assert bu["timeout"] == 600.0
    assert "env" not in bu

    assert ensure_default_agenticx_mcp_json() is False
    # Existing file without browser-use: merge in default entry, keep other servers
    target.write_text('{"other": {"command": "x", "args": []}}\n', encoding="utf-8")
    assert ensure_default_agenticx_mcp_json() is True
    merged = json.loads(target.read_text(encoding="utf-8"))
    assert "other" in merged
    assert "browser-use" in merged

    assert ensure_default_agenticx_mcp_json() is False


def test_ensure_default_merges_into_mcp_servers_wrapper(fake_home: Path) -> None:
    from agenticx.cli.studio_mcp import agenticx_home_mcp_path, ensure_default_agenticx_mcp_json

    target = agenticx_home_mcp_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        '{"mcpServers": {"bocha": {"command": "python", "args": ["-m", "x"]}}}\n',
        encoding="utf-8",
    )
    assert ensure_default_agenticx_mcp_json() is True
    data = json.loads(target.read_text(encoding="utf-8"))
    assert "browser-use" in data["mcpServers"]
    assert "bocha" in data["mcpServers"]


def test_load_available_servers_triggers_seed(fake_home: Path) -> None:
    from agenticx.cli.studio_mcp import agenticx_home_mcp_path, load_available_servers

    assert not agenticx_home_mcp_path().exists()
    configs = load_available_servers()
    assert agenticx_home_mcp_path().exists()
    assert "browser-use" in configs


def test_ensure_default_skips_entries_from_config(fake_home: Path) -> None:
    from agenticx.cli.studio_mcp import (
        agenticx_home_mcp_path,
        ensure_default_agenticx_mcp_json,
        set_mcp_skip_default_names_config,
    )

    set_mcp_skip_default_names_config(["browser-use"])
    target = agenticx_home_mcp_path()
    assert ensure_default_agenticx_mcp_json() is True
    data = json.loads(target.read_text(encoding="utf-8"))
    assert "browser-use" not in data
    assert "firecrawl" in data


def test_ensure_default_migrates_legacy_skip_key(fake_home: Path) -> None:
    from agenticx.cli.studio_mcp import (
        agenticx_home_mcp_path,
        ensure_default_agenticx_mcp_json,
        get_mcp_skip_default_names_config,
    )

    target = agenticx_home_mcp_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        '{"__agenticx_skip_default_mcp__": ["browser-use"], "other": {"command": "x", "args": []}}\n',
        encoding="utf-8",
    )
    assert ensure_default_agenticx_mcp_json() is True
    data = json.loads(target.read_text(encoding="utf-8"))
    assert "__agenticx_skip_default_mcp__" not in data
    assert "browser-use" not in data
    assert "firecrawl" in data
    assert "other" in data
    assert "browser-use" in get_mcp_skip_default_names_config()
