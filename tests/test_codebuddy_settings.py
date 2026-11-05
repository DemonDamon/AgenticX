#!/usr/bin/env python3
"""Unit tests for Near → CodeBuddy models/settings sync."""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.harness.codebuddy_settings import (
    apply_named_provider_to_codebuddy_settings,
    custom_local_model_ref,
    maybe_sync_codebuddy_settings,
    merge_provider_into_models_doc,
    normalize_codebuddy_chat_url,
    write_json_with_backup,
)


def test_normalize_chat_url() -> None:
    assert (
        normalize_codebuddy_chat_url("http://gw/v1")
        == "http://gw/v1/chat/completions"
    )
    assert (
        normalize_codebuddy_chat_url("http://gw/v1/chat/completions/")
        == "http://gw/v1/chat/completions"
    )
    assert (
        normalize_codebuddy_chat_url("https://dashscope/compatible-mode/v1")
        == "https://dashscope/compatible-mode/v1/chat/completions"
    )


def test_custom_local_ref() -> None:
    assert custom_local_model_ref("glm-5.3-flash") == "custom-local:glm-5.3-flash"
    assert custom_local_model_ref("custom-local:glm") == "custom-local:glm"


def test_merge_upserts_model_entry() -> None:
    doc = {
        "models": [
            {
                "id": "other",
                "name": "Other",
                "vendor": "x",
                "url": "http://x/v1/chat/completions",
                "apiKey": "old",
            }
        ]
    }
    merged = merge_provider_into_models_doc(
        doc,
        model_id="glm-5.3-flash",
        api_key="sk-new",
        base_url="http://aibox:2026/v1",
        display_name="彩讯 GLM",
        vendor="彩讯",
    )
    ids = [m["id"] for m in merged["models"]]
    assert ids == ["other", "glm-5.3-flash"]
    entry = merged["models"][1]
    assert entry["url"] == "http://aibox:2026/v1/chat/completions"
    assert entry["apiKey"] == "sk-new"
    assert entry["name"] == "彩讯 GLM"


def test_apply_named_writes_models_and_settings(tmp_path: Path) -> None:
    home = tmp_path / "cb"
    home.mkdir()
    write_json_with_backup(
        home / "models.json",
        {"models": []},
        backup_on_first_rewrite=False,
    )
    write_json_with_backup(
        home / "settings.json",
        {"trustedDirectories": ["/tmp"], "model": "hy4std"},
        backup_on_first_rewrite=False,
    )
    providers = {
        "custom_openai_178": {
            "api_key": "sk-cb",
            "base_url": "http://aibox:2026/v1",
            "display_name": "彩讯-外网",
        }
    }
    result = apply_named_provider_to_codebuddy_settings(
        "custom_openai_178",
        "glm-5.3-flash",
        home=home,
        providers=providers,
    )
    assert result["model"] == "custom-local:glm-5.3-flash"
    settings = json.loads((home / "settings.json").read_text(encoding="utf-8"))
    assert settings["model"] == "custom-local:glm-5.3-flash"
    assert settings["trustedDirectories"] == ["/tmp"]
    models = json.loads((home / "models.json").read_text(encoding="utf-8"))
    assert models["models"][0]["id"] == "glm-5.3-flash"
    assert models["models"][0]["apiKey"] == "sk-cb"

    assert (
        maybe_sync_codebuddy_settings(
            "claude-code",
            "custom_openai_178",
            "glm-5.3-flash",
            home=home,
            providers=providers,
        )
        is None
    )
    assert (
        maybe_sync_codebuddy_settings(
            "codebuddy",
            "custom_openai_178",
            "glm-5.3-flash",
            home=home,
            providers=providers,
        )
        is not None
    )


def test_missing_base_url_raises(tmp_path: Path) -> None:
    home = tmp_path / "cb"
    home.mkdir()
    providers = {"deepseek": {"api_key": "sk", "base_url": ""}}
    try:
        apply_named_provider_to_codebuddy_settings(
            "deepseek", "deepseek-v4-flash", home=home, providers=providers
        )
        assert False, "expected error"
    except Exception as exc:
        assert "base_url" in str(exc)
