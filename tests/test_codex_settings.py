#!/usr/bin/env python3
"""Unit tests for Near → Codex config.toml sync."""

from __future__ import annotations

from pathlib import Path

from agenticx.harness.codex_settings import (
    apply_named_provider_to_codex_settings,
    maybe_sync_codex_settings,
    merge_provider_into_codex_config,
    normalize_codex_base_url,
    parse_codex_config,
    sanitize_codex_provider_id,
    write_codex_config,
)


def test_normalize_codex_base_url_strips_responses_and_chat() -> None:
    assert (
        normalize_codex_base_url("https://gw.example/v1/responses/")
        == "https://gw.example/v1"
    )
    assert (
        normalize_codex_base_url("https://gw.example/v1/chat/completions")
        == "https://gw.example/v1"
    )
    assert normalize_codex_base_url("https://gw.example/v1/") == "https://gw.example/v1"


def test_sanitize_provider_id_avoids_reserved() -> None:
    assert sanitize_codex_provider_id("custom_openai_1") == "agenticx-custom-openai-1"
    assert sanitize_codex_provider_id("OpenAI") == "agenticx-openai"
    pid = sanitize_codex_provider_id("彩讯-外网")
    assert pid.startswith("agenticx-")
    assert pid not in {"openai", "ollama", "lmstudio"}


def test_merge_preserves_mcp_and_features(tmp_path: Path) -> None:
    original = """model = "gpt-5.2-codex"
personality = "friendly"

[mcp_servers.pencil]
command = "/usr/bin/true"

[features]
steer = true
"""
    token = tmp_path / ".agenticx" / "agenticx-custom-openai-178.token"
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text("sk-test", encoding="utf-8")
    merged = merge_provider_into_codex_config(
        original,
        provider_name="custom_openai_178",
        model_id="glm-5.3-flash",
        api_key="sk-test",
        base_url="http://aibox.example:2026/v1",
        display_name="彩讯-外网",
        token_file=token,
    )
    doc = parse_codex_config(merged)
    assert doc["model"] == "glm-5.3-flash"
    assert doc["model_provider"] == "agenticx-custom-openai-178"
    providers = doc["model_providers"]["agenticx-custom-openai-178"]
    assert providers["base_url"] == "http://aibox.example:2026/v1"
    assert providers["wire_api"] == "responses"
    assert providers["auth"]["command"] == "/bin/cat"
    assert providers["auth"]["args"] == [str(token)]
    assert doc["mcp_servers"]["pencil"]["command"] == "/usr/bin/true"
    assert doc["features"]["steer"] is True
    assert "personality" in merged


def test_merge_without_base_url_only_sets_model() -> None:
    original = 'model = "old"\nmodel_provider = "openai"\n'
    merged = merge_provider_into_codex_config(
        original,
        provider_name="openai",
        model_id="gpt-5.3-codex",
        api_key="sk",
        base_url=None,
    )
    doc = parse_codex_config(merged)
    assert doc["model"] == "gpt-5.3-codex"
    assert doc["model_provider"] == "openai"
    assert "model_providers" not in doc


def test_apply_named_and_maybe_sync(tmp_path: Path) -> None:
    target = tmp_path / "config.toml"
    write_codex_config(
        'model = "keep"\n\n[features]\napps = false\n',
        target,
        backup_on_first_rewrite=False,
    )
    providers = {
        "bailian": {
            "api_key": "sk-bailian",
            "base_url": "https://dashscope.example/compatible-mode/v1",
            "display_name": "阿里云百炼",
        }
    }
    doc = apply_named_provider_to_codex_settings(
        "bailian",
        "qwen3.7-plus",
        path=target,
        providers=providers,
    )
    assert doc["model"] == "qwen3.7-plus"
    assert doc["model_provider"] == "agenticx-bailian"
    assert doc["features"]["apps"] is False
    token_path = target.parent / ".agenticx" / "agenticx-bailian.token"
    assert token_path.exists()
    assert token_path.read_text(encoding="utf-8") == "sk-bailian"
    assert doc["model_providers"]["agenticx-bailian"]["auth"]["args"] == [
        str(token_path)
    ]

    assert (
        maybe_sync_codex_settings(
            "python-agent", "bailian", "qwen3.7-plus", path=target, providers=providers
        )
        is None
    )
    assert (
        maybe_sync_codex_settings(
            "codex", "bailian", "qwen3.7-plus", path=target, providers=providers
        )
        is not None
    )


def test_corrupt_toml_not_clobbered(tmp_path: Path) -> None:
    target = tmp_path / "config.toml"
    target.write_text("not = [toml", encoding="utf-8")
    providers = {"x": {"api_key": "k", "base_url": "https://x/v1"}}
    try:
        apply_named_provider_to_codex_settings(
            "x", "m", path=target, providers=providers
        )
        assert False, "expected error"
    except Exception as exc:
        assert "invalid TOML" in str(exc) or "TOML" in str(exc)
    assert target.read_text(encoding="utf-8") == "not = [toml"
