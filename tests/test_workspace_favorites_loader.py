#!/usr/bin/env python3
"""Unit tests for workspace favorites.json helpers."""

from __future__ import annotations

from pathlib import Path

from agenticx.workspace.loader import (
    delete_favorite,
    load_favorites,
    remove_favorite_memory_note,
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


def test_upsert_same_message_id_different_content_allowed(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    assert upsert_favorite(
        ws,
        {"message_id": "same", "session_id": "s", "content": " excerpt one ", "saved_at": "t1", "role": "assistant"},
    )
    assert upsert_favorite(
        ws,
        {"message_id": "same", "session_id": "s", "content": "excerpt two", "saved_at": "t2", "role": "assistant"},
    )
    rows = load_favorites(ws)
    assert len(rows) == 2


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


def test_upsert_dedupes_by_content(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    assert upsert_favorite(
        ws,
        {"message_id": "m3", "session_id": "s1", "content": "same content", "saved_at": "t1", "role": "user"},
    )
    assert not upsert_favorite(
        ws,
        {"message_id": "m4", "session_id": "s2", "content": "same content", "saved_at": "t2", "role": "assistant"},
    )


def test_remove_favorite_memory_note(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    mem = ws / "MEMORY.md"
    mem.write_text("- [用户收藏] keep this\n- [用户收藏] delete this\n- other\n", encoding="utf-8")
    assert remove_favorite_memory_note(ws, "delete this") is True
    body = mem.read_text(encoding="utf-8")
    assert "[用户收藏] delete this" not in body
    assert "[用户收藏] keep this" in body
    assert remove_favorite_memory_note(ws, "missing") is False
