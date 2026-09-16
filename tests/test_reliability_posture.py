#!/usr/bin/env python3
"""Tests for reliability.posture and fail-closed checkpoint visibility.

Author: Damon Li
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import pytest

from agenticx.runtime.checkpoint import AgentCheckpoint, CheckpointStore
from agenticx.runtime.harden_flags import (
    cancelled_prefix_finalize_enabled,
    fresh_round_loop_enabled,
    interrupted_closers_enabled,
    max_overflow_retries,
    overflow_retry_enabled,
    persist_fail_closed_enabled,
    reliability_posture,
)
from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.local_file import LocalFileBackend


@pytest.fixture
def isolated_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "AGX_RELIABILITY_POSTURE",
        "AGX_PERSIST_FAIL_CLOSED",
        "AGX_OVERFLOW_RETRY",
        "AGX_MAX_OVERFLOW_RETRIES",
        "AGX_INTERRUPTED_CLOSERS",
        "AGX_CANCELLED_PREFIX_FINALIZE",
        "AGX_FRESH_ROUND_LOOP",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr("agenticx.runtime.harden_flags._config_bool", lambda _key: None)
    monkeypatch.setattr("agenticx.runtime.harden_flags._config_int", lambda _key: None)
    monkeypatch.setattr("agenticx.runtime.harden_flags._config_str", lambda _key: None)


def test_default_posture_is_strict(isolated_flags: None) -> None:
    assert reliability_posture() == "strict"


def test_env_selects_legacy(isolated_flags: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "legacy")
    assert reliability_posture() == "legacy"


def test_env_case_insensitive(isolated_flags: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "STRICT")
    assert reliability_posture() == "strict"


def test_typo_falls_back_to_strict(isolated_flags: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "struct")
    assert reliability_posture() == "strict"


def test_persist_default_follows_posture(
    isolated_flags: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert persist_fail_closed_enabled() is True
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "legacy")
    assert persist_fail_closed_enabled() is False


def test_explicit_flag_overrides_posture(
    isolated_flags: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "strict")
    monkeypatch.setenv("AGX_PERSIST_FAIL_CLOSED", "0")
    assert persist_fail_closed_enabled() is False
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "legacy")
    monkeypatch.setenv("AGX_PERSIST_FAIL_CLOSED", "1")
    assert persist_fail_closed_enabled() is True


def test_other_flags_unchanged(isolated_flags: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "strict")
    strict_vals = (
        overflow_retry_enabled(),
        interrupted_closers_enabled(),
        cancelled_prefix_finalize_enabled(),
        fresh_round_loop_enabled(),
        max_overflow_retries(),
    )
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "legacy")
    legacy_vals = (
        overflow_retry_enabled(),
        interrupted_closers_enabled(),
        cancelled_prefix_finalize_enabled(),
        fresh_round_loop_enabled(),
        max_overflow_retries(),
    )
    assert strict_vals == legacy_vals


def test_checkpoint_save_returns_true_on_success(tmp_path: Path) -> None:
    store = CheckpointStore(
        SyncStorageFacade(
            LocalFileBackend(
                sessions_root=tmp_path / "sessions",
                config_dir=tmp_path / "cfg",
            )
        )
    )
    ok = store.save(AgentCheckpoint(session_id="s1", turn_id="t1"))
    assert ok is True
    assert store.save_failures == 0


def test_checkpoint_save_returns_false_on_failure() -> None:
    class _Boom:
        def save_agent_state(self, *_args, **_kwargs):
            raise OSError("disk full")

    store = CheckpointStore(storage=_Boom())  # type: ignore[arg-type]
    ok = store.save(AgentCheckpoint(session_id="s-fail", turn_id="t1"))
    assert ok is False
    assert store.save_failures == 1


def test_checkpoint_first_failure_logs_error(caplog: pytest.LogCaptureFixture) -> None:
    class _Boom:
        def save_agent_state(self, *_args, **_kwargs):
            raise OSError("disk full")

    store = CheckpointStore(storage=_Boom())  # type: ignore[arg-type]
    caplog.set_level(logging.WARNING, logger="agenticx.runtime.checkpoint")
    store.save(AgentCheckpoint(session_id="sess-log", turn_id="t1"))
    store.save(AgentCheckpoint(session_id="sess-log", turn_id="t1"))
    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    warn_records = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert error_records
    assert warn_records
    assert "sess-log" in error_records[0].getMessage()
    assert "sess-log" in warn_records[0].getMessage()


def test_reliability_import_stays_clean() -> None:
    for name in list(sys.modules):
        if name.startswith("agenticx.studio"):
            del sys.modules[name]
    import importlib

    import agenticx.reliability as reliability

    importlib.reload(reliability)
    bad = sorted(m for m in sys.modules if m.startswith("agenticx.studio"))
    assert not bad
