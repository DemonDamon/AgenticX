#!/usr/bin/env python3
"""Tests for AGX generate commands.

Author: Damon Li
"""

from __future__ import annotations

import typer
import pytest

from agenticx.cli.generate_commands import _resolve_description


class _FakeNonTtyStdin:
    """Minimal fake stdin for non-interactive environments."""

    def isatty(self) -> bool:
        return False


def test_resolve_description_raises_on_non_tty_without_description(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("sys.stdin", _FakeNonTtyStdin())
    with pytest.raises(typer.BadParameter) as exc_info:
        _resolve_description(None)
    assert str(exc_info.value) == "当前环境不可交互，请显式传入 DESCRIPTION 参数。"
