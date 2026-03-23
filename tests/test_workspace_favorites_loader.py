#!/usr/bin/env python3
"""Unit tests for workspace favorites.json helpers."""

from __future__ import annotations

from pathlib import Path

from agenticx.workspace.loader import (
    delete_favorite,
    load_favorites,
    update_favorite_tags,
    upsert_favorite,
)


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


def test_delete_favorite(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    upsert_favorite(
        ws,
        {"message_id": "m1", "session_id": "s", "content": "x", "saved_at": "t", "role": "user"},
    )
    assert delete_favorite(ws, "m1") is True
    assert load_favorites(ws) == []
    assert delete_favorite(ws, "m1") is False


def test_update_favorite_tags(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    upsert_favorite(
        ws,
        {"message_id": "m2", "session_id": "s", "content": "y", "saved_at": "t", "role": "assistant"},
    )
    assert update_favorite_tags(ws, "m2", ["a", "b", "a", ""]) is True
    rows = load_favorites(ws)
    assert len(rows) == 1
    assert rows[0].get("tags") == ["a", "b"]
    assert update_favorite_tags(ws, "missing", ["x"]) is False
