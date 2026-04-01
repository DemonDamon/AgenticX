#!/usr/bin/env python3
"""Smoke tests for atomic writer helpers.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from agenticx.utils.atomic_writer import atomic_write_json


def test_atomic_write_json_happy_path(tmp_path: Path) -> None:
    target = tmp_path / "state.json"
    payload = {"hello": "world", "n": 3}
    atomic_write_json(target, payload)
    parsed = json.loads(target.read_text(encoding="utf-8"))
    assert parsed == payload
    assert not list(tmp_path.glob("*.agx.tmp"))


def test_atomic_write_json_cleans_temp_on_replace_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "state.json"
    original = {"stable": True}
    target.write_text(json.dumps(original), encoding="utf-8")

    def _boom(src: str, dst: str | os.PathLike[str]) -> None:
        raise OSError("replace failed")

    monkeypatch.setattr("agenticx.utils.atomic_writer.os.replace", _boom)

    with pytest.raises(OSError):
        atomic_write_json(target, {"stable": False})

    parsed = json.loads(target.read_text(encoding="utf-8"))
    assert parsed == original
    assert not list(tmp_path.glob("*.agx.tmp"))
