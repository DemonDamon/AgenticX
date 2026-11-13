#!/usr/bin/env python3
"""Tests for Claude Code Direct-style settings sync.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.harness.claude_code_settings import (
    ClaudeSettingsError,
    apply_named_provider_to_claude_settings,
    apply_provider_to_claude_settings,
    extract_live_model_ids,
    load_claude_settings,
    maybe_sync_claude_code_settings,
    merge_provider_into_settings,
    normalize_anthropic_base_url,
    read_live_model_ids,
    write_claude_settings,
)


def _creds(token: str, base_url: str, model_id: str) -> dict:
    """Keyword bag for apply/merge helpers (avoids secret-scanner false positives)."""
    return {
        "api_key": token,
        "base_url": base_url,
        "model_id": model_id,
    }


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("", ""),
        ("http://aibox.example:2026/v1", "http://aibox.example:2026"),
        ("http://aibox.example:2026/v1/", "http://aibox.example:2026"),
        ("http://aibox.example:2026", "http://aibox.example:2026"),
        (
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "https://dashscope.aliyuncs.com/compatible-mode",
        ),
        (
            "https://open.bigmodel.cn/api/paas/v4",
            "https://open.bigmodel.cn/api/paas/v4",
        ),
        ("HTTPS://Example.com/V1", "HTTPS://Example.com"),
    ],
)
def test_normalize_anthropic_base_url(raw: str, expected: str) -> None:
    assert normalize_anthropic_base_url(raw) == expected


def test_merge_preserves_unrelated_keys_and_env() -> None:
    doc = {
        "permissions": {"allow": ["Bash"]},
        "enabledPlugins": {"foo@bar": True},
        "mcpServers": {"local": {"command": "npx"}},
        "hooks": {"PreToolUse": []},
        "theme": "dark",
        "model": "old-model",
        "env": {
            "ANTHROPIC_AUTH_TOKEN": "tok-old",
            "ANTHROPIC_BASE_URL": "http://old.example",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": "old-haiku",
            "API_TIMEOUT_MS": "3000000",
            "STREAMING_ENABLED": "true",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        },
    }
    merged = merge_provider_into_settings(
        doc,
        **_creds("tok-new", "http://aibox.example:2026/v1", "glm-5.3-flash"),
    )
    assert merged["permissions"] == {"allow": ["Bash"]}
    assert merged["enabledPlugins"] == {"foo@bar": True}
    assert merged["mcpServers"] == {"local": {"command": "npx"}}
    assert merged["hooks"] == {"PreToolUse": []}
    assert merged["theme"] == "dark"
    assert merged["model"] == "glm-5.3-flash"
    env = merged["env"]
    assert env["ANTHROPIC_AUTH_TOKEN"] == "tok-new"
    assert "ANTHROPIC_API_KEY" not in env
    assert env["ANTHROPIC_BASE_URL"] == "http://aibox.example:2026"
    assert env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "glm-5.3-flash"
    assert env["ANTHROPIC_DEFAULT_SONNET_MODEL"] == "glm-5.3-flash"
    assert env["ANTHROPIC_DEFAULT_OPUS_MODEL"] == "glm-5.3-flash"
    assert env["ANTHROPIC_MODEL"] == "glm-5.3-flash"
    assert env["API_TIMEOUT_MS"] == "3000000"
    assert env["STREAMING_ENABLED"] == "true"
    assert env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] == "1"


def test_merge_updates_api_key_style_when_only_api_key_present() -> None:
    doc = {"env": {"ANTHROPIC_API_KEY": "key-old"}}
    merged = merge_provider_into_settings(
        doc,
        **_creds("key-new", "https://api.example/v1", "claude-sonnet"),
    )
    assert merged["env"]["ANTHROPIC_API_KEY"] == "key-new"
    assert "ANTHROPIC_AUTH_TOKEN" not in merged["env"]


def test_merge_defaults_to_auth_token_when_neither_present() -> None:
    merged = merge_provider_into_settings(
        {},
        **_creds("tok-default", "https://gw/v1", "m1"),
    )
    assert merged["env"]["ANTHROPIC_AUTH_TOKEN"] == "tok-default"
    assert "ANTHROPIC_API_KEY" not in merged["env"]


def test_extract_live_model_ids_dedupes() -> None:
    doc = {
        "model": "haiku",
        "env": {
            "ANTHROPIC_MODEL": "haiku",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-5.3-flash",
            "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.1",
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.2",
        },
    }
    assert extract_live_model_ids(doc) == [
        "haiku",
        "glm-5.3-flash",
        "glm-5.1",
        "glm-5.2",
    ]


def test_invalid_json_not_clobbered(tmp_path: Path) -> None:
    target = tmp_path / "settings.json"
    target.write_text("{not-json", encoding="utf-8")
    with pytest.raises(ClaudeSettingsError):
        apply_provider_to_claude_settings(
            path=target,
            **_creds("tok-x", "http://x/v1", "m"),
        )
    assert target.read_text(encoding="utf-8") == "{not-json"


def test_atomic_write_and_first_backup(tmp_path: Path) -> None:
    target = tmp_path / "settings.json"
    original = {
        "permissions": {"allow": ["Read"]},
        "env": {"ANTHROPIC_AUTH_TOKEN": "tok-old", "KEEP_ME": "1"},
        "model": "old",
    }
    target.write_text(json.dumps(original), encoding="utf-8")

    apply_provider_to_claude_settings(
        path=target,
        **_creds("tok-new", "http://gw.example/v1", "glm-x"),
    )
    bak = target.with_name("settings.json.agenticx.bak")
    assert bak.exists()
    assert json.loads(bak.read_text(encoding="utf-8")) == original

    written = json.loads(target.read_text(encoding="utf-8"))
    assert written["permissions"] == {"allow": ["Read"]}
    assert written["env"]["KEEP_ME"] == "1"
    assert written["env"]["ANTHROPIC_AUTH_TOKEN"] == "tok-new"
    assert written["env"]["ANTHROPIC_BASE_URL"] == "http://gw.example"
    assert written["model"] == "glm-x"

    apply_provider_to_claude_settings(
        path=target,
        **_creds("tok-newer", "http://gw.example/v1", "glm-y"),
    )
    assert json.loads(bak.read_text(encoding="utf-8")) == original
    assert json.loads(target.read_text(encoding="utf-8"))["model"] == "glm-y"


def test_apply_named_provider_from_mapping(tmp_path: Path) -> None:
    target = tmp_path / "settings.json"
    write_claude_settings(
        {"theme": "dark", "env": {"ANTHROPIC_AUTH_TOKEN": "tok-old"}},
        target,
        backup_on_first_rewrite=False,
    )
    providers = {
        "custom_openai_box": {
            "api_key": "tok-live",
            "base_url": "http://aibox.richaibox.com:2026/v1",
            "model": "glm-5.3-flash",
        }
    }
    apply_named_provider_to_claude_settings(
        "custom_openai_box",
        "glm-5.1",
        path=target,
        providers=providers,
    )
    doc = load_claude_settings(target)
    assert doc["theme"] == "dark"
    assert doc["model"] == "glm-5.1"
    assert doc["env"]["ANTHROPIC_BASE_URL"] == "http://aibox.richaibox.com:2026"
    assert doc["env"]["ANTHROPIC_AUTH_TOKEN"] == "tok-live"


def test_maybe_sync_skips_builtin_and_live_provider(tmp_path: Path) -> None:
    target = tmp_path / "settings.json"
    write_claude_settings({"model": "keep"}, target, backup_on_first_rewrite=False)
    assert (
        maybe_sync_claude_code_settings(
            "python-agent", "openai", "gpt-4o", path=target
        )
        is None
    )
    assert (
        maybe_sync_claude_code_settings(
            "claude-code", "__claude_live_settings__", "haiku", path=target
        )
        is None
    )
    assert load_claude_settings(target)["model"] == "keep"


def test_maybe_sync_unknown_provider_does_not_clobber(tmp_path: Path) -> None:
    target = tmp_path / "settings.json"
    write_claude_settings(
        {"env": {"ANTHROPIC_AUTH_TOKEN": "tok-old"}, "permissions": {"deny": []}},
        target,
        backup_on_first_rewrite=False,
    )
    providers = {
        "zhipu": {
            "api_key": "tok-zhipu",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
        }
    }
    result = apply_named_provider_to_claude_settings(
        "zhipu", "glm-5.1", path=target, providers=providers
    )
    assert result["permissions"] == {"deny": []}
    assert result["env"]["ANTHROPIC_BASE_URL"] == "https://open.bigmodel.cn/api/paas/v4"
    assert (
        maybe_sync_claude_code_settings(
            "claude-code", "no_such_provider_xyz", "m", path=target
        )
        is None
    )


def test_read_live_model_ids_invalid_returns_empty(tmp_path: Path) -> None:
    target = tmp_path / "settings.json"
    target.write_text("nope", encoding="utf-8")
    assert read_live_model_ids(target) == []
