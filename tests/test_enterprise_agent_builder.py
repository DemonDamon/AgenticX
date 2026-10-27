#!/usr/bin/env python3
"""Unit tests for the enterprise agent draft builder.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import re

import httpx
import pytest

from agenticx.runtime.enterprise_agent_builder import (
    EnterprisePublishError,
    get_my_agent,
    list_my_agents,
    preview_manifest,
    submit_draft,
    summarize_diff,
    synth_local_id,
    unified_manifest_diff,
)

_LOCAL_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def _hash_id(name: str) -> str:
    digest = hashlib.sha256(name.strip().encode("utf-8")).hexdigest()[:16]
    return "nl-" + digest


def test_synth_local_id() -> None:
    assert synth_local_id("Sales Weekly!") == "nl-sales-weekly"
    assert synth_local_id("销售 周报") == _hash_id("销售 周报")
    assert synth_local_id("销售 周报") != synth_local_id("财务 月报")
    assert synth_local_id("销售 周报") == synth_local_id("销售 周报")
    for name in ("Sales Weekly!", "销售 周报", "财务 月报"):
        assert _LOCAL_ID_RE.fullmatch(synth_local_id(name))


def _builtin(configs: list[dict] | None = None, system: str = "keep") -> dict:
    toolset: dict = {"type": "agx_builtin", "default_policy": "always_allow"}
    if configs is not None:
        toolset["configs"] = configs
    return {
        "schema": "agx.agent/v1",
        "model": "openai/gpt-4o",
        "system": system,
        "tools": [toolset],
    }


def test_preview_rejects_invalid_and_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    def _redact(text: str) -> str:
        return text.replace("sk-live-abcdefghijklmnop1234", "[REDACTED:X]")

    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.redact_text",
        _redact,
    )
    unknown = _builtin([{"name": "knowledge_search"}])
    rejected = preview_manifest(unknown, base_manifest=None, base_version=None)
    assert rejected.ok is False
    assert any("unknown builtin tool" in item for item in rejected.errors)

    secret = _builtin(system="key sk-live-abcdefghijklmnop1234")
    secret_report = preview_manifest(secret, base_manifest=None, base_version=None)
    assert any(item.startswith("检测到疑似密钥") for item in secret_report.errors)

    cred = _builtin(system="use ${cred:GH}")
    cred_report = preview_manifest(cred, base_manifest=None, base_version=None)
    assert any("不能使用本机凭证引用" in item for item in cred_report.errors)

    path = _builtin(system="read /Users/alice/x")
    path_report = preview_manifest(path, base_manifest=None, base_version=None)
    assert any("本机路径" in item for item in path_report.errors)

    legal = preview_manifest(
        {"schema": "agx.agent/v1", "model": "openai/gpt-4o"},
        base_manifest=None,
        base_version=None,
    )
    assert legal.ok is True
    assert legal.manifest_hash is not None
    assert legal.manifest_hash.startswith("sha256:")


def test_summarize_diff(monkeypatch: pytest.MonkeyPatch) -> None:
    base = _builtin(
        [
            {"name": "web_search", "enabled": False},
            {"name": "bash_exec", "policy": "always_allow"},
        ],
        system="keep",
    )
    updated = _builtin(
        [{"name": "bash_exec", "policy": "always_ask"}],
        system="keep\nadded one\nadded two",
    )
    lines = summarize_diff(base, updated)
    assert "内置工具：新增 web_search" in lines
    assert "工具策略：bash_exec always_allow → always_ask" in lines
    assert "系统提示：+2 行 / -0 行" in lines
    system_at = lines.index("系统提示：+2 行 / -0 行")
    added_at = lines.index("内置工具：新增 web_search")
    policy_at = lines.index("工具策略：bash_exec always_allow → always_ask")
    assert system_at < added_at < policy_at

    assert summarize_diff(base, base) == ["与基线版本内容相同（提交不会产生新版本）"]

    full = unified_manifest_diff(base, updated)
    assert len(full) > 30
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.MAX_DIFF_CHARS",
        30,
    )
    short = unified_manifest_diff(base, updated)
    assert "（差异过长已截断）" in short
    assert short.startswith(full[:30])
    assert short.endswith("…（差异过长已截断）")


class _Response:
    def __init__(self, status: int, payload: dict) -> None:
        self.status_code = status
        self._payload = payload
        self.headers = {"content-type": "application/json"}

    def json(self) -> dict:
        return self._payload


def test_list_and_get_use_device_token() -> None:
    calls: list[dict] = []

    def http_get(url: str, **kwargs: object) -> _Response:
        calls.append({"url": url, **kwargs})
        if url.endswith("/api/desktop/agents/drafts"):
            return _Response(
                200,
                {
                    "agents": [
                        {
                            "agent_id": "01JB",
                            "display_name": "销售周报",
                            "description": None,
                            "local_avatar_id": "nl-sales",
                            "lifecycle": "draft",
                            "latest_version": 2,
                            "effective_version": 2,
                            "routing_mode": "follow_latest",
                            "updated_at": "2026-11-02T08:00:00.000Z",
                        }
                    ]
                },
            )
        return _Response(200, {"agent": {}, "version": {}, "versions": []})

    settings = ("agx-pat-x", "https://portal.example")
    rows = list_my_agents(settings=settings, http_get=http_get)
    assert calls[0]["url"] == "https://portal.example/api/desktop/agents/drafts"
    assert calls[0]["headers"] == {"Authorization": "Bearer agx-pat-x"}
    assert calls[0]["trust_env"] is False
    assert rows[0].display_name == "销售周报"
    assert rows[0].description is None

    def http_get_404(url: str, **kwargs: object) -> _Response:
        return _Response(404, {"message": "智能体不存在"})

    with pytest.raises(EnterprisePublishError) as caught:
        get_my_agent("missing", None, settings=settings, http_get=http_get_404)
    assert caught.value.status == 404

    def http_get_down(url: str, **kwargs: object) -> _Response:
        raise httpx.ConnectError("down")

    with pytest.raises(EnterprisePublishError) as down:
        list_my_agents(settings=settings, http_get=http_get_down)
    assert down.value.status == 0
    assert down.value.message == "无法连接企业服务"


def test_submit_draft_body() -> None:
    seen: dict = {}

    def http_post(url: str, **kwargs: object) -> _Response:
        seen["url"] = url
        seen["json"] = kwargs.get("json")
        seen["trust_env"] = kwargs.get("trust_env")
        seen["headers"] = kwargs.get("headers")
        return _Response(
            201,
            {
                "agent_id": "ag-1",
                "version": 1,
                "created": True,
                "lifecycle": "draft",
                "routing_mode": "follow_latest",
                "effective_version": 1,
            },
        )

    settings = ("agx-pat-x", "https://portal.example")
    submit_draft(
        manifest={"schema": "agx.agent/v1"},
        display_name="N" * 80,
        description="  hi  ",
        note=None,
        local_avatar_id="nl-x",
        settings=settings,
        http_post=http_post,
    )
    body = seen["json"]
    assert set(body) == {"local_avatar_id", "display_name", "description", "manifest"}
    assert body["display_name"] == "N" * 64
    assert body["description"] == "hi"
    assert seen["url"] == "https://portal.example/api/desktop/agents/publish"
    assert seen["trust_env"] is False
    assert seen["headers"]["Authorization"] == "Bearer agx-pat-x"
    assert "agx-pat-x" not in str(body)

    submit_draft(
        manifest={"schema": "agx.agent/v1"},
        display_name="周报",
        description=None,
        note="  hello  ",
        local_avatar_id="nl-x",
        settings=settings,
        http_post=http_post,
    )
    noted = seen["json"]
    assert set(noted) == {
        "local_avatar_id",
        "display_name",
        "description",
        "manifest",
        "note",
    }
    assert noted["note"] == "hello"
    assert noted["description"] is None
