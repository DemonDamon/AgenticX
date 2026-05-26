#!/usr/bin/env python3
"""Tests for web_fetch tool.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession


class _FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        content: bytes = b"",
        content_type: str = "text/html",
        url: str = "https://example.com/page",
    ) -> None:
        self.status_code = status_code
        self.content = content
        self.headers = {"content-type": content_type}
        self.url = url


class _FakeAsyncClient:
    def __init__(self, response: _FakeResponse | None = None, *, exc: Exception | None = None) -> None:
        self._response = response
        self._exc = exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str):
        if self._exc is not None:
            raise self._exc
        assert self._response is not None
        return self._response


@pytest.mark.asyncio
async def test_web_fetch_success(monkeypatch) -> None:
    html = b"<html><head><title>Demo</title></head><body><p>Body</p><img src='/a.png'/></body></html>"

    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            return _FakeResponse(content=html, url="https://example.com/final")

    monkeypatch.setattr("httpx.AsyncClient", _Client)
    result = await agent_tools._tool_web_fetch({"url": "https://example.com/page"}, StudioSession())
    assert "Title: Demo" in result
    assert "URL: https://example.com/final" in result
    assert "[discovered_images]" in result
    assert "https://example.com/a.png" in result


@pytest.mark.asyncio
async def test_web_fetch_rejects_non_http_scheme() -> None:
    result = await agent_tools._tool_web_fetch({"url": "file:///etc/passwd"}, StudioSession())
    assert result == "ERROR: only http(s) URLs are supported"


@pytest.mark.asyncio
async def test_web_fetch_http_error(monkeypatch) -> None:
    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            return _FakeResponse(status_code=404)

    monkeypatch.setattr("httpx.AsyncClient", _Client)
    result = await agent_tools._tool_web_fetch({"url": "https://example.com/missing"}, StudioSession())
    assert result == "ERROR: http 404"


@pytest.mark.asyncio
async def test_web_fetch_unsupported_content_type(monkeypatch) -> None:
    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            return _FakeResponse(content_type="application/pdf", content=b"%PDF")

    monkeypatch.setattr("httpx.AsyncClient", _Client)
    result = await agent_tools._tool_web_fetch({"url": "https://example.com/doc.pdf"}, StudioSession())
    assert result.startswith("ERROR: unsupported content-type")


@pytest.mark.asyncio
async def test_web_fetch_too_large(monkeypatch) -> None:
    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            return _FakeResponse(content=b"x" * (agent_tools._WEB_FETCH_MAX_BYTES + 1))

    monkeypatch.setattr("httpx.AsyncClient", _Client)
    result = await agent_tools._tool_web_fetch({"url": "https://example.com/huge"}, StudioSession())
    assert result == "ERROR: page exceeds 2MB limit"


@pytest.mark.asyncio
async def test_web_fetch_timeout(monkeypatch) -> None:
    import httpx

    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            raise httpx.TimeoutException("timeout")

    monkeypatch.setattr("httpx.AsyncClient", _Client)
    result = await agent_tools._tool_web_fetch({"url": "https://example.com/slow"}, StudioSession())
    assert result == "ERROR: network"
