#!/usr/bin/env python3
"""Outbox writer for desktop agent actions.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.action_audit import audit_enabled, emit_action_audit, redact_summary


def _install(monkeypatch: pytest.MonkeyPatch, values: dict[str, object] | None, *, explode: bool = False) -> None:
    def get_value(cls: object, key: str) -> object:
        del cls
        if explode:
            raise RuntimeError("config unreadable")
        assert values is not None
        return values.get(key)

    monkeypatch.setattr(ConfigManager, "get_value", classmethod(get_value))


def _outbox() -> Path:
    return Path.home() / ".agenticx" / "action_audit" / "outbox.jsonl"


def _read_events() -> list[dict[str, object]]:
    path = _outbox()
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_unsigned_enterprise_does_not_create_the_outbox(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, {"enterprise.enabled": False, "enterprise.token": "agx-pat-x"})
    assert audit_enabled() is False
    emit_action_audit({"kind": "policy_denied", "summary": "git:push"})
    assert not (Path.home() / ".agenticx" / "action_audit").exists()

    _install(monkeypatch, {"enterprise.enabled": True, "enterprise.token": "   "})
    emit_action_audit({"kind": "policy_denied"})
    assert not (Path.home() / ".agenticx" / "action_audit").exists()

    _install(monkeypatch, None, explode=True)
    emit_action_audit({"kind": "policy_denied"})
    assert not (Path.home() / ".agenticx" / "action_audit").exists()


def test_signed_in_enterprise_writes_one_complete_line(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, {"enterprise.enabled": True, "enterprise.token": "agx-pat-test"})
    emit_action_audit(
        {
            "kind": "confirm_resolved",
            "session_id": "sess-1",
            "agent_id": "meta",
            "tool_name": "bash_exec",
            "subject": "git:push",
            "outcome": "approved",
            "decision_source": "human",
            "risk": "high",
            "args_digest": "ab" * 32,
            "summary": "push origin?",
        }
    )
    events = _read_events()
    assert len(events) == 1
    event = events[0]
    assert event["v"] == 1
    assert isinstance(event["event_id"], str)
    assert len(event["event_id"]) == 32
    assert str(event["event_id"]).islower()
    int(str(event["event_id"]), 16)
    assert str(event["ts"]).endswith("Z")
    assert event["kind"] == "confirm_resolved"
    assert event["session_id"] == "sess-1"
    assert event["agent_id"] == "meta"
    assert event["tool_name"] == "bash_exec"
    assert event["subject"] == "git:push"
    assert event["outcome"] == "approved"
    assert event["decision_source"] == "human"
    assert event["risk"] == "high"
    assert event["args_digest"] == "ab" * 32
    assert event["summary"] == "push origin?"


@pytest.mark.parametrize(
    ("raw", "secret", "masked"),
    [
        ("use agx-pat-abcDEF_123-zz now", "agx-pat-abcDEF_123-zz", "agx-pat-***"),
        ("key sk-abcd1234WXYZ99 leaked", "sk-abcd1234WXYZ99", "sk-***"),
        ("token ghp_" + ("a" * 20) + " end", "ghp_" + ("a" * 20), "gh*_***"),
        ("Authorization: Bearer ya29.secret-token_1", "ya29.secret-token_1", "Bearer ***"),
        ("api_key=supersecretvalue", "supersecretvalue", "api_key=***"),
    ],
)
def test_redact_summary_masks_each_rule(raw: str, secret: str, masked: str) -> None:
    cleaned = redact_summary(raw)
    assert secret not in cleaned
    assert masked in cleaned
    assert len(cleaned) <= 200


def test_redact_summary_caps_length() -> None:
    cleaned = redact_summary("x" * 500)
    assert cleaned == "x" * 200
    assert len(cleaned) <= 200


def test_full_outbox_does_not_grow(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, {"enterprise.enabled": True, "enterprise.token": "agx-pat-test"})
    path = _outbox()
    path.parent.mkdir(parents=True)
    with path.open("wb") as handle:
        handle.seek(20 * 1024 * 1024 - 1)
        handle.write(b"\n")
    before = path.stat().st_size
    assert before >= 20 * 1024 * 1024
    emit_action_audit({"kind": "external_effect", "outcome": "completed", "summary": "ignored"})
    assert path.stat().st_size == before
    text = path.read_text(encoding="utf-8", errors="ignore")
    assert "external_effect" not in text
