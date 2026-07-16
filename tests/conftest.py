#!/usr/bin/env python3
"""Repository-wide pytest isolation for the AgenticX home directory.

Root cause fix: ``agenticx/studio/session_manager.py`` (``SessionManager.__init__``)
and dozens of other runtime modules resolve their on-disk state via
``Path.home()`` / ``os.path.expanduser("~")`` with no override hook. Tests such
as ``tests/test_studio_server.py`` instantiate real ``SessionManager`` objects
through ``create_studio_app()`` (55+ call sites across 17 files) without any
HOME isolation, so every test run wrote real session artifacts (fixed test
strings like "hello", "总结简历", "看看附件", "执行一次并发任务", "创建一个子
智能体", "retry me") directly into the developer's live
``~/.agenticx/sessions``. Near Desktop's history panel then displayed these
pytest fixtures as if they were genuine past conversations.

This autouse fixture redirects ``$HOME`` (and ``%USERPROFILE%`` on Windows) to
a throwaway per-test directory before any test body runs, so ``Path.home()``
resolves to a sandbox instead of the real user home for the entire suite.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest


@pytest.fixture(autouse=True)
def _isolated_agenticx_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Prevent tests from writing into the real ``~/.agenticx`` directory.

    ``posixpath.expanduser`` only consults ``$HOME``; ``ntpath.expanduser``
    checks ``%USERPROFILE%`` first and only falls back to
    ``%HOMEDRIVE%``/``%HOMEPATH%`` when ``USERPROFILE`` is unset. Setting both
    env vars here is therefore sufficient to isolate ``Path.home()`` on every
    platform this suite runs on.
    """
    fake_home = tmp_path / "agx_home"
    fake_home.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("HOME", str(fake_home))
    monkeypatch.setenv("USERPROFILE", str(fake_home))
    yield
