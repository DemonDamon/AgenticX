#!/usr/bin/env python3
"""Smoke tests for trinity skill protocol integration.

Author: Damon Li
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from agenticx.skills.meta_skill import MetaSkillInjector
from agenticx.skills.registry import SkillRegistryClient


def test_meta_skill_injector_adds_protocol_and_skill_type() -> None:
    injector = MetaSkillInjector(enabled=True)
    prompt = injector.inject(
        "base prompt",
        [{"name": "brainstorming", "description": "Use when exploring.", "skill_type": "rigid"}],
    )
    assert "Skill-First Protocol (AgenticX)" in prompt
    assert "brainstorming [rigid]" in prompt


def test_meta_skill_injector_respects_disable_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SKILL_PROTOCOL", "false")
    injector = MetaSkillInjector()
    prompt = injector.inject("base prompt", [])
    assert prompt == "base prompt"


def test_registry_publish_reads_skill_type(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class _DummyClient:
        def __init__(self, *args, **kwargs):  # noqa: ANN002, ANN003
            _ = args, kwargs
            self.payload: dict = {}

        def __enter__(self) -> "_DummyClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
            _ = exc_type, exc, tb
            return False

        def post(self, _url: str, json: dict, headers: dict | None = None) -> "_DummyResponse":
            _ = headers
            self.payload = json
            return _DummyResponse({"entry": json})

    class _DummyResponse:
        def __init__(self, payload: dict) -> None:
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._payload

    monkeypatch.setattr("agenticx.skills.registry.httpx.Client", _DummyClient)
    skill_dir = tmp_path / "skill"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        (
            "---\n"
            "name: trinity-demo\n"
            "description: Use when validating protocol.\n"
            "version: 1.0.0\n"
            "skill_type: rigid\n"
            "author: test\n"
            "---\n\n"
            "# Trinity Skill\n"
        ),
        encoding="utf-8",
    )
    client = SkillRegistryClient(registry_url="http://localhost:8321")
    entry = client.publish(skill_dir)
    assert entry.skill_type == "rigid"
    assert os.path.exists(skill_dir / "SKILL.md")
