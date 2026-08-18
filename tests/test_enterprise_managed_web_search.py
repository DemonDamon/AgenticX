from __future__ import annotations

import json

import httpx
import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.prompts.meta_agent import _build_web_search_capability_block
from agenticx.studio.web_search import providers
from agenticx.studio.web_search.contracts import WebSearchResult, WebSearchRuntimeConfig
from agenticx.studio.web_search.enterprise import (
    EnterpriseManagedSearchBatch,
    EnterpriseManagedSearchError,
    EnterpriseManagedWebSearchClient,
    enterprise_managed_search_active,
)
from agenticx.studio.web_search.service import WebSearchService


ENTERPRISE_CONFIG = {
    "enabled": True,
    "base_url": "https://portal.example.invalid",
    "token": "agx-pat-desktop-secret",
}


def test_enterprise_client_sends_pat_and_parses_sanitized_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://portal.example.invalid/api/desktop/v1/web-search"
        assert request.headers["authorization"] == "Bearer agx-pat-desktop-secret"
        assert json.loads(request.content) == {"query": "latest news", "max_results": 4}
        return httpx.Response(
            200,
            json={
                "ok": True,
                "provider": "tenant-fallback",
                "hits": [
                    {
                        "title": "Result",
                        "url": "https://source.example.invalid/article",
                        "snippet": "Summary",
                    },
                    {
                        "title": "Unsafe",
                        "url": "javascript:alert(1)",
                        "snippet": "ignored",
                    },
                ],
            },
        )

    client = EnterpriseManagedWebSearchClient.from_config(
        ENTERPRISE_CONFIG,
        transport=httpx.MockTransport(handler),
    )
    assert client is not None
    batch = client.search("latest news", 4)
    assert batch.provider == "tenant-fallback"
    assert batch.hits == [
        WebSearchResult(
            title="Result",
            url="https://source.example.invalid/article",
            snippet="Summary",
        )
    ]


def test_enterprise_client_does_not_follow_redirects_with_pat() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(302, headers={"location": "https://other.example.invalid/search"})

    client = EnterpriseManagedWebSearchClient.from_config(
        ENTERPRISE_CONFIG,
        transport=httpx.MockTransport(handler),
    )
    assert client is not None
    with pytest.raises(EnterpriseManagedSearchError):
        client.search("latest news", 4)
    assert calls == 1


def test_enterprise_client_rejects_plain_http_except_loopback() -> None:
    with pytest.raises(EnterpriseManagedSearchError, match="必须使用 HTTPS"):
        EnterpriseManagedWebSearchClient(
            portal_origin="http://portal.example.invalid",
            token="agx-pat-desktop-secret",
        )

    client = EnterpriseManagedWebSearchClient(
        portal_origin="http://127.0.0.1:3000",
        token="agx-pat-desktop-secret",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"ok": True, "hits": []})
        ),
    )
    assert client.search("local test", 1).hits == []


def test_managed_service_uses_actual_server_provider() -> None:
    class ManagedClient:
        def search(self, query: str, max_results: int) -> EnterpriseManagedSearchBatch:
            assert query == "latest news"
            assert max_results == 3
            return EnterpriseManagedSearchBatch(
                hits=[WebSearchResult("Result", "https://example.invalid", "Summary")],
                provider="tenant-fallback",
            )

    service = WebSearchService(
        WebSearchRuntimeConfig(default_provider="duckduckgo", max_results=3),
        enterprise_client=ManagedClient(),  # type: ignore[arg-type]
    )
    assert service.search("latest news") == [
        WebSearchResult("Result", "https://example.invalid", "Summary")
    ]
    assert service.last_provider == "tenant-fallback"


def test_managed_failure_never_falls_back_to_local_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    class ManagedClient:
        def search(self, _query: str, _max_results: int) -> EnterpriseManagedSearchBatch:
            raise EnterpriseManagedSearchError("企业联网搜索暂时不可用")

    local_calls = 0

    def local_search(*_args: object, **_kwargs: object) -> list[WebSearchResult]:
        nonlocal local_calls
        local_calls += 1
        return []

    monkeypatch.setattr(providers, "search_duckduckgo_html", local_search)
    service = WebSearchService(
        WebSearchRuntimeConfig(default_provider="duckduckgo"),
        enterprise_client=ManagedClient(),  # type: ignore[arg-type]
    )
    with pytest.raises(EnterpriseManagedSearchError, match="企业联网搜索暂时不可用"):
        service.search("latest news")
    assert local_calls == 0


def test_enterprise_mode_ignores_legacy_local_disabled_toggle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    global_values = {
        "enterprise": ENTERPRISE_CONFIG,
        "web_search": {"enabled": False, "default_provider": "duckduckgo"},
    }
    monkeypatch.setattr(
        ConfigManager,
        "_load_yaml",
        lambda path: global_values if path == ConfigManager.GLOBAL_CONFIG_PATH else {},
    )

    assert enterprise_managed_search_active() is True
    service = WebSearchService.from_config()
    assert service._enterprise_client is not None
    prompt = _build_web_search_capability_block()
    assert "由企业管理员托管" in prompt
    assert "不要要求用户在本机填写搜索 API Key" in prompt
    assert "已由用户在设置中关闭" not in prompt


def test_personal_mode_keeps_existing_local_provider_behavior(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    global_values = {
        "enterprise": {},
        "web_search": {"default_provider": "duckduckgo", "max_results": 2},
    }
    monkeypatch.setattr(
        ConfigManager,
        "_load_yaml",
        lambda path: global_values if path == ConfigManager.GLOBAL_CONFIG_PATH else {},
    )
    monkeypatch.setattr(
        providers,
        "search_duckduckgo_html",
        lambda *_args: [WebSearchResult("Local", "https://example.invalid", "Summary")],
    )

    service = WebSearchService.from_config()
    assert service.search("latest news") == [
        WebSearchResult("Local", "https://example.invalid", "Summary")
    ]
    assert service.last_provider == "duckduckgo"


def test_project_config_cannot_override_enterprise_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_values = {
        "enterprise": {
            "enabled": True,
            "base_url": "https://attacker.example.invalid",
            "token": "project-controlled-token",
        }
    }

    def load_yaml(path: object) -> dict[str, object]:
        if path == ConfigManager.GLOBAL_CONFIG_PATH:
            return {"enterprise": ENTERPRISE_CONFIG}
        if path == ConfigManager.PROJECT_CONFIG_PATH:
            return project_values
        return {}

    monkeypatch.setattr(ConfigManager, "_load_yaml", load_yaml)
    client = EnterpriseManagedWebSearchClient.from_config()

    assert client is not None
    assert client._portal_origin == "https://portal.example.invalid"
    assert client._token == "agx-pat-desktop-secret"
