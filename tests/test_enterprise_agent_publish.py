#!/usr/bin/env python3
"""Unit tests for exporting a local avatar as an enterprise draft manifest.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from agenticx.avatar.registry import AvatarConfig
from agenticx.managed.manifest import validate_manifest
from agenticx.managed.spec import MANAGED_BUILTIN_TOOLS, compile_spec
from agenticx.runtime.enterprise_agent_publish import (
    ERR_NO_MODEL,
    EnterprisePublishError,
    build_publish_manifest,
    publish_avatar_draft,
    resolve_manifest_model,
    sanitize_system_prompt,
)


def test_sanitize_system_prompt(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    text = (
        "token ${cred:GITHUB_TOKEN} agx-pat-abc123def "
        "sk-ABCDEFGHIJKLMNOPQRS Bearer abcdefghijklmnop "
        "/Users/alice/work/a.md C:\\Users\\bob\\x"
    )
    cleaned, refs, secrets, paths = sanitize_system_prompt(text)
    for original in (
        "${cred:GITHUB_TOKEN}",
        "agx-pat-abc123def",
        "sk-ABCDEFGHIJKLMNOPQRS",
        "Bearer abcdefghijklmnop",
        "/Users/alice",
        "C:\\Users\\bob",
    ):
        assert original not in cleaned
    assert refs == ["GITHUB_TOKEN"]
    assert secrets == 3
    assert paths == 2
    assert "[凭证引用已移除:GITHUB_TOKEN]" in cleaned
    assert "~/work/a.md" in cleaned


def test_sanitize_uses_redact_text(monkeypatch: pytest.MonkeyPatch) -> None:
    def _redact(text: str) -> str:
        return text.replace("s3cr3t", "[REDACTED:X]")

    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_publish.redact_text",
        _redact,
    )
    cleaned, _refs, secrets, _paths = sanitize_system_prompt("keep s3cr3t hidden")
    assert "s3cr3t" not in cleaned
    assert secrets == 1


def test_resolve_manifest_model() -> None:
    assert resolve_manifest_model("deepseek", "deepseek-chat") == "deepseek/deepseek-chat"
    assert resolve_manifest_model("enterprise", "openai/gpt-4o") == "openai/gpt-4o"
    assert resolve_manifest_model("", "x") is None
    assert resolve_manifest_model("p", "") is None


def test_tool_mapping() -> None:
    avatar = AvatarConfig(
        id="av-tools",
        name="周报助手",
        default_provider="deepseek",
        default_model="deepseek-chat",
        tools_enabled={"web_search": False, "knowledge_search": True},
        workspace_dir="/var/tmp/not-in-manifest",
    )
    manifest, report = build_publish_manifest(
        avatar,
        global_tools_enabled={"liteparse": False},
    )
    assert report.disabled_tools == ["web_search", "liteparse"]
    configs = {item["name"]: item for item in manifest["tools"][0]["configs"]}
    for name in ("bash_exec", "file_write", "file_edit"):
        assert configs[name] == {"name": name, "policy": "always_ask"}
    assert report.excluded_tools == [
        {"name": "knowledge_search", "reason": "托管模式不支持该工具"},
    ]
    result = validate_manifest(manifest)
    assert result.ok, result.errors
    spec = compile_spec("draft", 1, manifest)
    assert {entry.name for entry in spec.tools} == set(MANAGED_BUILTIN_TOOLS) - {
        "web_search",
        "liteparse",
    }


def test_build_reports_errors() -> None:
    missing = AvatarConfig(id="av-none", name="未设模型")
    _manifest, report = build_publish_manifest(missing, global_tools_enabled={})
    assert report.errors[0] == ERR_NO_MODEL

    huge = AvatarConfig(
        id="av-huge",
        name="超长",
        default_provider="deepseek",
        default_model="deepseek-chat",
        system_prompt="a" * 70_000,
    )
    _huge_manifest, huge_report = build_publish_manifest(huge, global_tools_enabled={})
    assert any("64 KiB" in error for error in huge_report.errors)


def test_manifest_has_no_secret_fields() -> None:
    workspace = "/var/tmp/avatar-workspace-should-stay-local"
    avatar = AvatarConfig(
        id="av-clean",
        name="周报助手",
        description="整理周报",
        default_provider="deepseek",
        default_model="deepseek-chat",
        workspace_dir=workspace,
        system_prompt="只谈工作",
    )
    manifest, report = build_publish_manifest(avatar, global_tools_enabled={})
    assert report.errors == []
    assert manifest["mcp_servers"] == []
    assert manifest["skills"] == []
    assert [item["type"] for item in manifest["tools"]] == ["agx_builtin"]
    assert set(manifest["metadata"]) == {"welcome_message", "suggested_questions"}
    assert workspace not in __import__("json").dumps(manifest)


def test_publish_avatar_draft_posts_expected_body() -> None:
    avatar = AvatarConfig(
        id="av1",
        name=" 周报助手 ",
        description=" 帮团队整理周报 ",
        default_provider="deepseek",
        default_model="deepseek-chat",
    )
    manifest = {"schema": "agx.agent/v1", "model": "deepseek/deepseek-chat"}
    calls: list[tuple[str, dict]] = []

    class _Response:
        status_code = 409
        headers = {"content-type": "application/json"}

        def json(self) -> dict[str, str]:
            return {"message": "该智能体已被管理员回收，无法再次提交"}

    def http_post(url: str, **kwargs: object) -> _Response:
        calls.append((url, kwargs))
        return _Response()

    with pytest.raises(EnterprisePublishError) as raised:
        publish_avatar_draft(
            avatar,
            manifest,
            None,
            settings=("agx-pat-x", "https://portal.example"),
            http_post=http_post,
        )
    assert raised.value.status == 409
    assert raised.value.message == "该智能体已被管理员回收，无法再次提交"
    url, kwargs = calls[0]
    assert url == "https://portal.example/api/desktop/agents/publish"
    assert kwargs["headers"]["Authorization"] == "Bearer agx-pat-x"
    assert kwargs["trust_env"] is False
    assert set(kwargs["json"]) == {
        "local_avatar_id",
        "display_name",
        "description",
        "manifest",
    }

    def _connect(url: str, **kwargs: object) -> None:
        raise httpx.ConnectError("refused")

    with pytest.raises(EnterprisePublishError) as offline:
        publish_avatar_draft(
            avatar,
            manifest,
            None,
            settings=("agx-pat-x", "https://portal.example"),
            http_post=_connect,
        )
    assert offline.value.status == 0
