#!/usr/bin/env python3
"""Unit tests for Near → Codex config.toml sync."""

from __future__ import annotations

from pathlib import Path

from agenticx.harness.codex_settings import (
    CodexSettingsError,
    apply_named_provider_to_codex_settings,
    maybe_sync_codex_settings,
    codex_gateway_lacks_hosted_web_search,
    merge_provider_into_codex_config,
    normalize_codex_base_url,
    parse_codex_config,
    resolve_codex_gateway_base_url,
    sanitize_codex_provider_id,
    write_codex_config,
)
from agenticx.llms.known_base_urls import default_provider_base_url


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


def test_merge_official_provider_uses_default_base_url() -> None:
    original = (
        'model = "glm-5.3-flash"\n'
        'model_provider = "agenticx-custom-openai-1782269503107"\n'
        "\n"
        "[model_providers.agenticx-custom-openai-1782269503107]\n"
        'name = "彩讯-外网"\n'
        'base_url = "http://aibox.richaibox.com:2026/v1"\n'
        'wire_api = "responses"\n'
    )
    merged = merge_provider_into_codex_config(
        original,
        provider_name="mimo",
        model_id="mimo-v2.6-flash",
        api_key="sk-test",
        base_url=None,
        display_name="小米 MiMo",
    )
    doc = parse_codex_config(merged)
    assert doc["model"] == "mimo-v2.6-flash"
    assert doc["model_provider"] == "agenticx-mimo"
    mimo = doc["model_providers"]["agenticx-mimo"]
    assert mimo["base_url"] == "https://api.xiaomimimo.com/v1"
    assert mimo["wire_api"] == "responses"
    assert mimo["name"] == "小米 MiMo"
    leftover = doc["model_providers"]["agenticx-custom-openai-1782269503107"]
    assert leftover["base_url"] == "http://aibox.richaibox.com:2026/v1"
    assert doc["web_search"] == "disabled"


def test_merge_without_base_url_fails_closed() -> None:
    original = (
        'model = "glm-5.3-flash"\n'
        'model_provider = "agenticx-custom-openai-1782269503107"\n'
    )
    try:
        merge_provider_into_codex_config(
            original,
            provider_name="custom_openai_9",
            model_id="mimo-v2.6-flash",
            api_key="sk-test",
            base_url=None,
        )
        raise AssertionError("expected CodexSettingsError")
    except CodexSettingsError as exc:
        msg = str(exc)
        assert "base_url" in msg
        assert "leftover" in msg


def test_resolve_rejects_official_anthropic() -> None:
    try:
        resolve_codex_gateway_base_url("anthropic")
        raise AssertionError("expected CodexSettingsError")
    except CodexSettingsError as exc:
        assert "Responses" in str(exc)
    assert default_provider_base_url("anthropic") == "https://api.anthropic.com/v1"
    assert default_provider_base_url("mimo") == "https://api.xiaomimimo.com/v1"
    assert (
        resolve_codex_gateway_base_url("mimo")
        == "https://api.xiaomimimo.com/v1"
    )
    assert (
        resolve_codex_gateway_base_url("mimo", "https://gateway.example/v1")
        == "https://gateway.example/v1"
    )


def test_apply_named_official_mimo_does_not_reuse_leftover_gateway(
    tmp_path: Path,
) -> None:
    target = tmp_path / "config.toml"
    write_codex_config(
        (
            'model = "glm-5.3-flash"\n'
            'model_provider = "agenticx-custom-openai-1782269503107"\n'
            "\n"
            "[model_providers.agenticx-custom-openai-1782269503107]\n"
            'name = "彩讯-外网"\n'
            'base_url = "http://aibox.richaibox.com:2026/v1"\n'
            'wire_api = "responses"\n'
        ),
        target,
        backup_on_first_rewrite=False,
    )
    before = target.read_text(encoding="utf-8")
    providers = {
        "mimo": {
            "api_key": "sk-test",
            "display_name": "小米 MiMo",
        }
    }
    doc = apply_named_provider_to_codex_settings(
        "mimo",
        "mimo-v2.6-flash",
        path=target,
        providers=providers,
    )
    assert doc["model"] == "mimo-v2.6-flash"
    assert doc["model_provider"] == "agenticx-mimo"
    assert (
        doc["model_providers"]["agenticx-mimo"]["base_url"]
        == "https://api.xiaomimimo.com/v1"
    )
    token_path = target.parent / ".agenticx" / "agenticx-mimo.token"
    assert token_path.exists()
    assert token_path.read_text(encoding="utf-8") == "sk-test"
    assert doc["model_providers"]["agenticx-mimo"]["auth"]["args"] == [
        str(token_path)
    ]
    assert doc["web_search"] == "disabled"

    unknown = {"custom_openai_9": {"api_key": "sk-fail"}}
    try:
        apply_named_provider_to_codex_settings(
            "custom_openai_9",
            "should-not-write",
            path=target,
            providers=unknown,
        )
        raise AssertionError("expected CodexSettingsError")
    except CodexSettingsError:
        pass
    after_fail = target.read_text(encoding="utf-8")
    failed_doc = parse_codex_config(after_fail)
    assert failed_doc["model"] == "mimo-v2.6-flash"
    assert failed_doc["model_provider"] == "agenticx-mimo"

    assert (
        maybe_sync_codex_settings(
            "codex",
            "custom_openai_9",
            "should-not-write",
            path=target,
            providers=unknown,
        )
        is None
    )
    assert target.read_text(encoding="utf-8") == after_fail
    # leftover file from the successful mimo apply is still a consistent pair
    assert "should-not-write" not in after_fail
    assert before != after_fail


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
    assert "web_search" not in doc
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


def test_codex_gateway_lacks_hosted_web_search_is_mimo_specific() -> None:
    assert codex_gateway_lacks_hosted_web_search("https://api.xiaomimimo.com/v1")
    assert codex_gateway_lacks_hosted_web_search("https://api.xiaomimimo.com/v1/")
    assert not codex_gateway_lacks_hosted_web_search("http://aibox.richaibox.com:2026/v1")
    assert not codex_gateway_lacks_hosted_web_search(
        "https://llm-d178jdr4rwpo9pmz.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    )
    assert not codex_gateway_lacks_hosted_web_search("https://api.minimaxi.com/v1")
    assert not codex_gateway_lacks_hosted_web_search("https://api.moonshot.cn/v1")
    assert not codex_gateway_lacks_hosted_web_search("https://api.deepseek.com/v1")
    assert not codex_gateway_lacks_hosted_web_search("https://api.openai.com/v1")
    assert not codex_gateway_lacks_hosted_web_search("")


def test_merge_disables_web_search_for_official_mimo_only() -> None:
    disabled = merge_provider_into_codex_config(
        'model = "glm-5.3-flash"\n',
        provider_name="mimo",
        model_id="mimo-v2.6-flash",
        api_key=None,
        base_url=None,
        display_name="小米 MiMo",
    )
    doc = parse_codex_config(disabled)
    assert doc["web_search"] == "disabled"
    assert doc["model_providers"]["agenticx-mimo"]["wire_api"] == "responses"
    assert doc["model_providers"]["agenticx-mimo"]["base_url"] == (
        "https://api.xiaomimimo.com/v1"
    )

    restored = merge_provider_into_codex_config(
        disabled,
        provider_name="custom_openai_1782269503107",
        model_id="glm-5.3-flash",
        api_key=None,
        base_url="http://aibox.richaibox.com:2026/v1",
        display_name="彩讯-外网",
    )
    restored_doc = parse_codex_config(restored)
    assert "web_search" not in restored_doc
    assert restored_doc["model_provider"] == "agenticx-custom-openai-1782269503107"
    # leftover mimo block stays; 彩讯 is not rewritten onto aibox leftovers
    assert (
        restored_doc["model_providers"]["agenticx-mimo"]["base_url"]
        == "https://api.xiaomimimo.com/v1"
    )


def test_merge_preserves_explicit_live_web_search_on_non_mimo() -> None:
    original = 'model = "keep"\nweb_search = "live"\n'
    merged = merge_provider_into_codex_config(
        original,
        provider_name="deepseek",
        model_id="deepseek-v4-flash",
        api_key=None,
        base_url="https://api.deepseek.com/v1",
    )
    doc = parse_codex_config(merged)
    assert doc["web_search"] == "live"
    assert doc["model_provider"] == "agenticx-deepseek"
