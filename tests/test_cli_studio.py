#!/usr/bin/env python3
"""Tests for AGX Studio command state helpers.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.studio import (
    HistoryRecord,
    StudioSession,
    _handle_image_command,
    _restore_last_snapshot,
    _take_snapshot,
)


def test_restore_last_snapshot_rolls_back_artifacts_and_history() -> None:
    session = StudioSession()
    first_path = Path("first.py")
    second_path = Path("second.py")

    session.artifacts[first_path] = "print('v1')"
    session.history.append(
        HistoryRecord(description="first", file_path=first_path, target="agent")
    )
    session.image_b64.append({"data": "abc", "mime": "image/png"})

    _take_snapshot(session)

    session.artifacts[second_path] = "print('v2')"
    session.history.append(
        HistoryRecord(description="second", file_path=second_path, target="agent")
    )
    session.image_b64.append({"data": "def", "mime": "image/png"})

    assert _restore_last_snapshot(session) is True
    assert list(session.artifacts.keys()) == [first_path]
    assert [record.file_path for record in session.history] == [first_path]
    assert session.image_b64 == [{"data": "abc", "mime": "image/png"}]


def test_image_clear_empties_sticky_image_context() -> None:
    session = StudioSession()
    session.image_b64.extend(
        [
            {"data": "abc", "mime": "image/png"},
            {"data": "def", "mime": "image/jpeg"},
        ]
    )

    _handle_image_command(session, "/image clear")

    assert session.image_b64 == []
