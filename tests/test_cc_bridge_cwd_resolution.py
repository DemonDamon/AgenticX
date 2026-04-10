#!/usr/bin/env python3
"""Regression: default cwd for cc_bridge prefers git repository root."""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.agent_tools import _session_default_cwd_for_cc_bridge
from agenticx.cli.studio import StudioSession


def test_default_cwd_prefers_git_root(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / ".git").mkdir()
    nested = repo / "packages" / "agenticx"
    nested.mkdir(parents=True)
    sess = StudioSession()
    sess.workspace_dir = str(nested)
    assert _session_default_cwd_for_cc_bridge(sess) == str(repo.resolve())


def test_default_cwd_without_git_uses_workspace(tmp_path: Path) -> None:
    w = tmp_path / "work"
    w.mkdir()
    sess = StudioSession()
    sess.workspace_dir = str(w)
    assert _session_default_cwd_for_cc_bridge(sess) == str(w.resolve())
