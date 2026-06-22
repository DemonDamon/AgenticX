#!/usr/bin/env python3
"""Per-entry tolerance in MCP config loaders.

Verifies that a single malformed or unsupported MCP server entry in
``mcp.json`` (e.g. a remote ``url`` only entry while Phase 2 is not yet
implemented) does not block other valid stdio entries from loading.

Plan: .cursor/plans/2026-06-22-near-remote-url-mcp-support.plan.md (Task 1.2).

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.tools.remote import load_mcp_config


def _write_mcp_json(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def test_load_mcp_config_skips_bad_entries(tmp_path: Path) -> None:
    cfg_path = _write_mcp_json(
        tmp_path / "mcp.json",
        {
            "mcpServers": {
                "good": {"command": "echo", "args": ["hi"]},
                # Malformed entry: neither `command` nor `url` is provided.
                "bad": {"args": ["lonely"]},
                # Mutually exclusive: both transports set is also invalid.
                "bad_both": {"command": "echo", "url": "https://x/mcp"},
            }
        },
    )

    servers = load_mcp_config(str(cfg_path))

    assert "good" in servers
    assert "bad" not in servers
    assert "bad_both" not in servers
    assert servers["good"].command == "echo"


def test_load_mcp_config_accepts_remote_url_entries(tmp_path: Path) -> None:
    """Phase 2: `url` entries are now valid (streamable-http / sse)."""

    cfg_path = _write_mcp_json(
        tmp_path / "mcp.json",
        {
            "mcpServers": {
                "stdio_one": {"command": "echo"},
                "remote_http": {"url": "https://api.tushare.pro/mcp/?token=x"},
                "remote_sse": {"url": "https://example.com/sse"},
            }
        },
    )

    servers = load_mcp_config(str(cfg_path))

    assert set(servers.keys()) == {"stdio_one", "remote_http", "remote_sse"}
    assert servers["stdio_one"].transport == "stdio"
    assert servers["remote_http"].transport == "streamable_http"
    assert servers["remote_sse"].transport == "sse"


def test_load_mcp_config_all_good_entries(tmp_path: Path) -> None:
    cfg_path = _write_mcp_json(
        tmp_path / "mcp.json",
        {
            "a": {"command": "echo"},
            "b": {"command": "ls", "args": ["-la"]},
        },
    )

    servers = load_mcp_config(str(cfg_path))

    assert set(servers.keys()) == {"a", "b"}


def test_load_mcp_config_all_bad_returns_empty(tmp_path: Path) -> None:
    cfg_path = _write_mcp_json(
        tmp_path / "mcp.json",
        # Both invalid: empty payload and "args only" (no command / url).
        {"only_bad": {}, "also_bad": {"args": ["x"]}},
    )

    # Must NOT raise — empty dict is the contract.
    servers = load_mcp_config(str(cfg_path))
    assert servers == {}


def test_load_mcp_config_missing_file_still_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_mcp_config(str(tmp_path / "does-not-exist.json"))


def test_load_available_servers_tolerates_mixed_entries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End-to-end: load_available_servers must also surface the good entry."""

    from agenticx.cli import studio_mcp

    cfg_path = _write_mcp_json(
        tmp_path / "agenticx_mcp.json",
        {
            "mcpServers": {
                "good_stdio": {"command": "echo"},
                # Empty entry: validator must reject it; loader skips just this row.
                "bad_remote": {},
            }
        },
    )

    # Make studio_mcp look at our temp file as the sole source.
    monkeypatch.setattr(
        studio_mcp,
        "all_mcp_config_search_paths",
        lambda: [cfg_path],
    )
    # ensure_default_agenticx_mcp_json would try to seed defaults into the
    # user's real ~/.agenticx/mcp.json — short-circuit it for the test.
    monkeypatch.setattr(
        studio_mcp, "ensure_default_agenticx_mcp_json", lambda: False
    )

    servers = studio_mcp.load_available_servers()

    assert "good_stdio" in servers
    assert "bad_remote" not in servers
