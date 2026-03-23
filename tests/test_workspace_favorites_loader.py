#!/usr/bin/env python3
"""Unit tests for workspace favorites.json helpers."""

from __future__ import annotations

from pathlib import Path

from agenticx.workspace.loader import load_favorites, upsert_favorite


def test_upsert_dedupes_by_message_id(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    e1 = {"message_id": "a", "session_id": "s", "content": "x", "saved_at": "t1", "role": "user"}
    assert upsert_favorite(ws, e1) is True
    assert upsert_favorite(ws, dict(e1)) is False
    rows = load_favorites(ws)
    assert len(rows) == 1


def test_load_favorites_empty_and_corrupt(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    assert load_favorites(ws) == []
    (ws / "favorites.json").write_text("not-json", encoding="utf-8")
    assert load_favorites(ws) == []
