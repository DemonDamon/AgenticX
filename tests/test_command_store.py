#!/usr/bin/env python3
"""Tests for composer command JSON storage.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.studio.command_store import (
    CommandNameExists,
    CommandNameReserved,
    CommandStore,
    CommandValidationError,
)


def test_rejects_reserved_and_duplicate_name(tmp_path: Path) -> None:
    store = CommandStore(tmp_path / "commands", tmp_path / "sessions")
    with pytest.raises(CommandNameReserved):
        store.add_command(scope="global", name="perf", instructions="nope")
    store.add_command(scope="global", name="summarize-pr", instructions="summarize")
    with pytest.raises(CommandNameExists):
        store.add_command(scope="global", name="summarize-pr", instructions="again")
    with pytest.raises(CommandValidationError):
        store.add_command(scope="global", name="Bad Name", instructions="nope")


def test_subject_id_cannot_escape_root(tmp_path: Path) -> None:
    store = CommandStore(tmp_path / "commands", tmp_path / "sessions")
    with pytest.raises(CommandValidationError):
        store.add_command(scope="avatar", subject_id="../escape", name="note", instructions="text")
    with pytest.raises(CommandValidationError):
        store.add_command(scope="group", subject_id="a/b", name="note", instructions="text")
    with pytest.raises(CommandValidationError):
        store.add_command(scope="avatar", subject_id="", name="note", instructions="text")
    outside = list((tmp_path).rglob("*.json"))
    assert outside == []
