#!/usr/bin/env python3
"""web_fetch egress guard and managed command environment overlay.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx

from agenticx.cli import agent_tools
from agenticx.managed.credentials import CredentialBundle, ResolvedCredential
from agenticx.managed.egress_policy import SessionEgressPolicy
from agenticx.runtime.session_boundary import bind_egress_guard, unbind_egress_guard

_BEARER = "bearer-token-value-123"


class _RecordingClient:
    kwargs: dict | None = None

    def __init__(self, **kwargs: object) -> None:
        _RecordingClient.kwargs = dict(kwargs)

    async def __aenter__(self) -> "_RecordingClient":
        return self

    async def __aexit__(self, *args: object) -> bool:
        del args
        return False

    async def get(self, url: str) -> object:
        return SimpleNamespace(
            status_code=200,
            content=b"hello",
            headers={"content-type": "text/plain"},
            url=url,
        )


async def test_no_guard_keeps_client_kwargs(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "AsyncClient", _RecordingClient)
    await agent_tools._fetch_http_bytes("https://example.com/a", timeout=5, max_bytes=1000)
    assert _RecordingClient.kwargs is not None
    assert set(_RecordingClient.kwargs) == {"timeout", "follow_redirects", "transport"}


async def test_guard_blocks_redirect(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "allowed.com":
            return httpx.Response(302, headers={"location": "https://evil.com/b"})
        return httpx.Response(200, text="should-not-arrive")

    monkeypatch.setattr(
        agent_tools,
        "_httpx_transport_for_url",
        lambda url: httpx.MockTransport(handler),
    )
    policy = SessionEgressPolicy(
        allow_domains=("allowed.com",),
        bundle=CredentialBundle(),
        placeholders={},
    )
    token = bind_egress_guard(policy.to_guard())
    try:
        result = await agent_tools._tool_web_fetch({"url": "https://allowed.com/a"})
    finally:
        unbind_egress_guard(token)
    assert result.startswith("ERROR: egress blocked: evil.com")


async def test_guard_injects_bearer_only_same_host(monkeypatch) -> None:
    seen: list[tuple[str, str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.host or "", request.headers.get("authorization")))
        if request.url.host == "allowed.com":
            return httpx.Response(302, headers={"location": "https://other.test/b"})
        return httpx.Response(
            200,
            content=b"plain",
            headers={"content-type": "text/plain"},
        )

    monkeypatch.setattr(
        agent_tools,
        "_httpx_transport_for_url",
        lambda url: httpx.MockTransport(handler),
    )
    bundle = CredentialBundle(
        credentials=(
            ResolvedCredential(
                credential_id="b",
                vault_id="v",
                vault_index=0,
                type="bearer",
                display_name=None,
                secret=_BEARER,
                host="allowed.com",
            ),
        )
    )
    policy = SessionEgressPolicy(allow_domains=(), bundle=bundle, placeholders={})
    token = bind_egress_guard(policy.to_guard())
    try:
        await agent_tools._tool_web_fetch({"url": "https://allowed.com/a"})
    finally:
        unbind_egress_guard(token)
    assert seen[0] == ("allowed.com", f"Bearer {_BEARER}")
    assert seen[1][0] == "other.test"
    assert seen[1][1] is None


def test_managed_command_env_overlay() -> None:
    session = SimpleNamespace(managed_command_env={"EXAMPLE_API_KEY": "agxsec_x"})
    overlay = agent_tools._managed_command_environ(session)
    assert overlay is not None
    assert overlay["EXAMPLE_API_KEY"] == "agxsec_x"
    assert agent_tools._managed_command_environ(SimpleNamespace()) is None
    assert agent_tools._managed_command_network(SimpleNamespace(managed_command_network="deny")) == "deny"
    assert agent_tools._managed_command_network(SimpleNamespace()) == "inherit"
