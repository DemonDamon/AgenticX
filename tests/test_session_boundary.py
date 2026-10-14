#!/usr/bin/env python3
"""Session directory isolation and egress allow list.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.runtime.session_boundary import (
    egress_denial,
    ensure_session_workdir,
    foreign_session_denial,
)


def test_foreign_session_directory_is_rejected(tmp_path: Path) -> None:
    own = ensure_session_workdir("session-a", root=tmp_path)
    other = ensure_session_workdir("session-b", root=tmp_path)
    assert own is not None and other is not None
    secret = other / "secret.txt"
    secret.write_text("nope", encoding="utf-8")
    assert foreign_session_denial(secret, "session-a", root=tmp_path)
    assert foreign_session_denial(own / "notes.txt", "session-a", root=tmp_path) is None


def test_path_outside_session_root_is_not_a_foreign_session(tmp_path: Path) -> None:
    outside = tmp_path / "repo" / "README.md"
    outside.parent.mkdir()
    assert foreign_session_denial(outside, "session-a", root=tmp_path / "sessions") is None


def test_egress_allowlist_blocks_other_hosts() -> None:
    allow = ["example.com"]
    assert egress_denial("https://api.example.com/v1", allow) is None
    assert egress_denial("https://example.com/health", allow) is None
    blocked = egress_denial("https://evil.test/steal", allow)
    assert blocked and "evil.test" in blocked
    assert egress_denial("https://evil.test/steal", []) is None
    assert egress_denial("https://evil.test/steal", None) is None
