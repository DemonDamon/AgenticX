#!/usr/bin/env python3
"""Tests for the workspace MEMORY.md entry API children round-trip.

Covers GET/PATCH /api/memory/workspace/entry handling of nested child bullets,
guarding against the "frontend sends children, backend drops them" regression.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from agenticx.studio import server as server_module
from agenticx.studio.server import create_studio_app

NESTED_MEMORY = """# MEMORY.md

## Agent Identity Anchors
- Name: Near
- Capability profile:
  - math strong
  - systems strong
- Position: CEO
"""


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    (tmp_path / "MEMORY.md").write_text(NESTED_MEMORY, encoding="utf-8")
    monkeypatch.setattr(server_module, "resolve_workspace_dir", lambda: tmp_path)
    monkeypatch.setattr(
        server_module, "WorkspaceMemoryStore", MagicMock(return_value=MagicMock())
    )
    app = create_studio_app()
    return TestClient(app)


def test_get_workspace_entries_exposes_children(client: TestClient) -> None:
    r = client.get("/api/memory/workspace")
    assert r.status_code == 200
    sections = r.json()["sections"]
    entries = next(s for s in sections if s["section"] == "Agent Identity Anchors")["entries"]
    profile = next(e for e in entries if e["text"] == "Capability profile:")
    assert profile["children"] == ["math strong", "systems strong"]


def test_patch_workspace_entry_persists_children(
    client: TestClient, tmp_path: Path
) -> None:
    r = client.patch(
        "/api/memory/workspace/entry",
        json={
            "section": "Agent Identity Anchors",
            "index": 1,
            "text": "Capability profile:",
            "children": ["theory", "engineering"],
        },
    )
    assert r.status_code == 200
    raw = (tmp_path / "MEMORY.md").read_text(encoding="utf-8")
    assert "  - theory" in raw
    assert "  - engineering" in raw
    assert "math strong" not in raw


def test_patch_workspace_entry_rejects_non_list_children(client: TestClient) -> None:
    r = client.patch(
        "/api/memory/workspace/entry",
        json={
            "section": "Agent Identity Anchors",
            "index": 1,
            "text": "Capability profile:",
            "children": "oops",
        },
    )
    assert r.status_code == 400


def test_patch_workspace_entry_without_children_keeps_existing(
    client: TestClient, tmp_path: Path
) -> None:
    r = client.patch(
        "/api/memory/workspace/entry",
        json={
            "section": "Agent Identity Anchors",
            "index": 1,
            "text": "Capability profile (renamed):",
        },
    )
    assert r.status_code == 200
    raw = (tmp_path / "MEMORY.md").read_text(encoding="utf-8")
    assert "- Capability profile (renamed):" in raw
    assert "  - math strong" in raw
    assert "  - systems strong" in raw
