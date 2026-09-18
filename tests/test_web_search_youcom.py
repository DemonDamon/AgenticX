"""Tests for the You.com web search provider (keyless free profile by default)."""

from __future__ import annotations

import json
from types import SimpleNamespace

from agenticx.studio.web_search import providers
from agenticx.studio.web_search.contracts import WebSearchRuntimeConfig
from agenticx.studio.web_search.service import WebSearchService


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, headers: dict | None = None, text: str = "", body: dict | None = None):
        self.status_code = status_code
        self.headers = headers or {}
        self.text = text
        self._body = body or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")

    def json(self) -> dict:
        return self._body


def _sse(payload: dict) -> str:
    return 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info"}}\n' + (
        "data: " + json.dumps(payload) + "\n"
    )


def _install(monkeypatch, replies):
    """Fake httpx.Client that records posts and returns canned replies."""
    calls: list[dict] = []

    class _Client:
        def __init__(self, **kwargs):
            self._kwargs = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def post(self, url, headers=None, json=None):
            calls.append({"url": url, "headers": dict(headers or {}), "json": json})
            return replies.pop(0)

    monkeypatch.setattr(providers.httpx, "Client", _Client)
    return calls


def test_search_youcom_keyless_uses_free_profile_and_parses_sse(monkeypatch) -> None:
    payload = {
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "results": {
                                "web": [
                                    {
                                        "url": "https://example.com/a",
                                        "title": "Result A",
                                        "description": "<b>Snippet</b> A",
                                    },
                                    {"url": "https://example.com/b", "title": "Result B", "description": "Snippet B"},
                                ]
                            }
                        }
                    ),
                }
            ]
        }
    }
    calls = _install(monkeypatch, [_FakeResponse(headers={"Content-Type": "text/event-stream"}, text=_sse(payload))])

    hits = providers.search_youcom("", "agenticx test", 5, 600)

    assert len(calls) == 1
    assert calls[0]["url"] == providers.YOUCOM_MCP_FREE_URL
    assert "Authorization" not in calls[0]["headers"]
    assert calls[0]["json"]["params"]["name"] == "you-search"
    assert calls[0]["json"]["params"]["arguments"]["query"] == "agenticx test"
    assert [h.url for h in hits] == ["https://example.com/a", "https://example.com/b"]
    assert hits[0].title == "Result A"
    assert hits[0].snippet == "Snippet A"  # html stripped


def test_search_youcom_with_key_uses_authenticated_endpoint(monkeypatch) -> None:
    payload = {"result": {"content": [{"type": "text", "text": json.dumps({"results": {"web": []}})}]}}
    calls = _install(monkeypatch, [_FakeResponse(headers={"Content-Type": "application/json"}, body=payload)])

    hits = providers.search_youcom("secret-key", "q", 5, 600)

    assert calls[0]["url"] == providers.YOUCOM_MCP_URL
    assert calls[0]["headers"]["Authorization"] == "Bearer secret-key"
    assert hits == []


def test_search_youcom_error_payload_returns_empty(monkeypatch) -> None:
    payload = {"error": {"message": "boom"}}
    calls = _install(monkeypatch, [_FakeResponse(headers={"Content-Type": "application/json"}, body=payload)])
    assert providers.search_youcom("", "q", 5, 600) == []
    assert len(calls) == 1


def test_search_youcom_http_failure_returns_empty(monkeypatch) -> None:
    class _Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def post(self, url, headers=None, json=None):
            return _FakeResponse(status_code=500)

    monkeypatch.setattr(providers.httpx, "Client", _Client)
    assert providers.search_youcom("", "q", 5, 600) == []


def test_youcom_is_an_allowed_default_provider() -> None:
    cfg = WebSearchRuntimeConfig.from_merged_yaml({"default_provider": "youcom"})
    assert cfg.default_provider == "youcom"


def test_service_routes_youcom_provider(monkeypatch) -> None:
    svc = WebSearchService(
        WebSearchRuntimeConfig(default_provider="duckduckgo", providers={"youcom": {"api_key": ""}})
    )
    recorded: list[tuple] = []

    def fake_youcom(api_key, query, max_results, snippet_chars):
        recorded.append((api_key, query, max_results))
        return []

    monkeypatch.setattr(providers, "search_youcom", fake_youcom, raising=False)
    import agenticx.studio.web_search.service as service_mod

    monkeypatch.setattr(service_mod.providers, "search_youcom", fake_youcom)

    svc.search("hello world", provider_override="youcom")

    assert recorded == [("", "hello world", 5)]


def test_service_youcom_falls_back_to_duckduckgo_on_empty(monkeypatch) -> None:
    cfg = WebSearchRuntimeConfig(default_provider="youcom", providers={"youcom": {}})
    svc = WebSearchService(cfg)
    calls: list[str] = []

    def fake_youcom(api_key, query, max_results, snippet_chars):
        calls.append("youcom")
        return []

    def fake_ddg(query, max_results, snippet_chars):
        calls.append("duckduckgo")
        return [SimpleNamespace(title="T", url="https://ddg.example", snippet="s")]

    import agenticx.studio.web_search.service as service_mod

    monkeypatch.setattr(service_mod.providers, "search_youcom", fake_youcom)
    monkeypatch.setattr(service_mod.providers, "search_duckduckgo_html", fake_ddg)

    hits = svc.search("hello")

    assert calls == ["youcom", "duckduckgo"]
    assert hits[0].url == "https://ddg.example"
