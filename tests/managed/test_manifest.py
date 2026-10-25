"""Manifest fixture, normalization, and hash tests.

Author: Damon Li
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from agenticx.managed.manifest import (
    AgentManifest,
    normalize_manifest,
    validate_manifest,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "managed_agents" / "manifest_cases.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_manifest_cases(case: dict) -> None:
    result = validate_manifest(case["input"])
    assert result.ok is case["ok"]
    assert result.errors == case["errors"]
    assert result.normalized == case["normalized"]
    if case["ok"]:
        assert result.manifest is not None
        assert result.manifest_hash is not None
    else:
        assert result.manifest is None
        assert result.manifest_hash is None


def test_oversize() -> None:
    raw = {
        "schema": "agx.agent/v1",
        "model": "openai/gpt-4o",
        "system": "a" * 300000,
    }
    result = validate_manifest(raw)
    assert result.ok is False
    assert result.errors == ["manifest: exceeds 262144 bytes"]
    assert result.normalized is None


def test_hash_stable_under_key_order() -> None:
    first = {
        "schema": "agx.agent/v1",
        "model": "openai/gpt-4o",
        "system": "hello",
        "metadata": {"b": 1, "a": 2},
    }
    second = {
        "model": "openai/gpt-4o",
        "metadata": {"a": 2, "b": 1},
        "system": "hello",
        "schema": "agx.agent/v1",
    }
    left = validate_manifest(first)
    right = validate_manifest(second)
    assert left.ok and right.ok
    assert left.manifest_hash == right.manifest_hash


def test_hash_changes_on_content() -> None:
    left = validate_manifest(
        {"schema": "agx.agent/v1", "model": "openai/gpt-4o", "system": "hello"}
    )
    right = validate_manifest(
        {"schema": "agx.agent/v1", "model": "openai/gpt-4o", "system": "hellp"}
    )
    assert left.ok and right.ok
    assert left.manifest_hash != right.manifest_hash


def test_normalize_does_not_mutate_input() -> None:
    raw = {
        "schema": "agx.agent/v1",
        "model": "openai/gpt-4o",
        "metadata": {"model": "x", "welcome_message": "hi"},
        "tools": [{"type": "agx_builtin", "configs": [{"name": "bash_exec"}]}],
        "mcp_servers": [
            {
                "name": "github",
                "url": "https://mcp.example.com/",
                "transport": "streamable-http",
            }
        ],
    }
    before = copy.deepcopy(raw)
    result = validate_manifest(raw)
    assert raw == before
    assert result.ok
    normalized = normalize_manifest(raw)
    assert raw == before
    assert normalized == result.normalized


def test_multiagent_instructions_oversize() -> None:
    raw = {
        "schema": "agx.agent/v1",
        "model": "openai/gpt-4o",
        "multiagent": {
            "type": "coordinator",
            "agents": [
                {"type": "self"},
                {"type": "advisor", "model": "a/b", "instructions": "a" * 8193},
            ],
        },
    }
    result = validate_manifest(raw)
    assert result.ok is False
    assert result.errors == ["manifest.multiagent.agents[1].instructions: exceeds 8192 bytes"]


def test_manifest_model_roundtrip() -> None:
    full = next(case for case in CASES if case["name"] == "full_ok")
    result = validate_manifest(full["input"])
    assert result.ok
    assert result.normalized is not None
    parsed = AgentManifest.model_validate(result.normalized)
    assert parsed.model_dump(by_alias=True) == result.normalized
