#!/usr/bin/env python3
"""Credential URL normalization and vault providers.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from agenticx.managed.credentials import (
    CredentialResolutionError,
    EnterpriseVaultProvider,
    LocalCredentialProvider,
    LocalCredentialSpec,
    host_matches,
    normalize_mcp_url,
)
from agenticx.runtime.credential_store import CredentialStore

_SECRET = "ghp_local_123456" # gitleaks:allow
_BODY_SECRET = "super-secret-body-value" # gitleaks:allow
_TOKEN = "internal-token-value" # gitleaks:allow


def test_normalize_mcp_url_table() -> None:
    # Same successes and non-query rejections as the vault control plane.
    # Query is kept (normalizeMcpServerUrlKeepingQuery), and the length cap is 512.
    assert normalize_mcp_url("https://MCP.Example.com:443/mcp/") == "https://mcp.example.com/mcp"
    assert normalize_mcp_url("https://x.com/") == "https://x.com"
    assert normalize_mcp_url("https://x.com:8443/a") == "https://x.com:8443/a"
    assert normalize_mcp_url("https://x.com/mcp?a=1") == "https://x.com/mcp?a=1"
    assert normalize_mcp_url("https://x.com/?a=1") == "https://x.com?a=1"
    assert normalize_mcp_url("http://x.com") is None
    assert normalize_mcp_url("https://u:p@x.com") is None # gitleaks:allow
    assert normalize_mcp_url("https://x.com/#f") is None
    assert normalize_mcp_url("https://例子.com") is None
    assert normalize_mcp_url("https://x.com/" + ("a" * 500)) is None


def test_host_matches() -> None:
    assert host_matches("a.example.com", "*.example.com", include_subdomains=False) is True
    assert host_matches("example.com", "*.example.com", include_subdomains=False) is False
    assert host_matches("a.example.com", "example.com", include_subdomains=True) is True
    assert host_matches("a.example.com", "example.com", include_subdomains=False) is False
    assert host_matches("EXAMPLE.com.", "example.com", include_subdomains=False) is True


def _spec(vault_url: str, credential_id: str, ref: str) -> LocalCredentialSpec:
    return LocalCredentialSpec(
        credential_id=credential_id,
        type="static_bearer",
        secret_ref=ref,
        mcp_server_url=vault_url,
    )


async def test_local_provider_resolves_refs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    store = CredentialStore()
    store.set("GITHUB_MCP_TOKEN", _SECRET)
    url = "https://mcp.example.com/mcp"
    provider = LocalCredentialProvider(
        {
            "vault-b": (_spec(url, "second", "${cred:GITHUB_MCP_TOKEN}"),),
            "vault-a": (_spec(url, "first", "${cred:GITHUB_MCP_TOKEN}"),),
        },
        store=store,
    )
    bundle = await provider.resolve("dev", "sess", ["vault-a", "vault-b"])
    assert [item.credential_id for item in bundle.credentials] == ["first", "second"]
    assert bundle.credentials[0].secret == _SECRET
    assert bundle.credentials[0].vault_index == 0
    assert bundle.credentials[1].vault_index == 1

    missing = LocalCredentialProvider(
        {"vault-a": (_spec(url, "first", "${cred:GITHUB_MCP_TOKEN}"),)},
        store=CredentialStore(tmp_path / "empty-credentials.yaml"),
    )
    with pytest.raises(CredentialResolutionError) as caught:
        await missing.resolve("dev", "sess", ["vault-a"])
    text = str(caught.value)
    assert "GITHUB_MCP_TOKEN" in text
    assert _SECRET not in text


def _sample() -> dict:
    return {
        "session_id": "01JSESSION",
        "resolved_at": "2026-10-25T08:00:00.000Z",
        "credentials": [
            {
                "credential_id": "c-static",
                "vault_id": "vault-a",
                "vault_index": 0,
                "type": "static_bearer",
                "display_name": "GitHub MCP token",
                "mcp_server_url": "https://MCP.Example.com:443/mcp/",
                "token": "static-token-value-123",
            },
            {
                "credential_id": "c-oauth",
                "vault_id": "vault-a",
                "vault_index": 0,
                "type": "mcp_oauth",
                "display_name": None,
                "mcp_server_url": "https://mcp.example.com",
                "access_token": "oauth-access-token-123",
                "expires_at": "2026-10-25T09:00:00.000Z",
                "refresh_error": "failed",
            },
            {
                "credential_id": "c-bearer",
                "vault_id": "vault-b",
                "vault_index": 1,
                "type": "bearer",
                "display_name": None,
                "host": "Docs.Example.com",
                "token": "bearer-token-value-123",
            },
            {
                "credential_id": "c-env",
                "vault_id": "vault-b",
                "vault_index": 1,
                "type": "environment_variable",
                "display_name": None,
                "secret_name": "EXAMPLE_API_KEY",
                "secret_value": "env-secret-value-12345",
                "networking": {"type": "limited", "allowed_hosts": ["api.example.com", "*.example.org"]},
            },
        ],
        "skipped": [{"vault_id": "vault-c", "reason": "not_found"}],
    }


async def test_enterprise_provider_maps_response() -> None:
    sample = _sample()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/vault-resolve"):
            return httpx.Response(200, json=sample)
        if request.url.path.endswith("/vaults/validate"):
            return httpx.Response(
                200,
                json={"vaults": [{"id": "vault-a", "status": "active"}]},
            )
        return httpx.Response(404, json={"error": "missing"})

    provider = EnterpriseVaultProvider(
        "http://admin.test",
        _TOKEN,
        transport=httpx.MockTransport(handler),
    )
    try:
        bundle = await provider.resolve("T", "sess", ["vault-a", "vault-b"])
        assert provider._client.headers["authorization"] == f"Bearer {_TOKEN}"
        assert [item.type for item in bundle.credentials] == [
            "static_bearer",
            "mcp_oauth",
            "bearer",
            "environment_variable",
        ]
        static, oauth, bearer, env = bundle.credentials
        assert static.secret == "static-token-value-123"
        assert static.mcp_server_url == "https://mcp.example.com/mcp"
        assert oauth.secret == "oauth-access-token-123"
        assert oauth.refresh_error is True
        assert bearer.secret == "bearer-token-value-123"
        assert bearer.host == "docs.example.com"
        assert env.secret == "env-secret-value-12345"
        assert env.secret_name == "EXAMPLE_API_KEY"
        assert env.networking == "limited"
        assert env.allowed_hosts == ("api.example.com", "*.example.org")
        assert bundle.skipped == (("vault-c", "not_found"),)
        statuses = await provider.validate_vault_ids("T", ["vault-a"])
        assert statuses == [("vault-a", "active")]
    finally:
        await provider.aclose()

    assert _TOKEN not in repr(provider)

    def fail(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(500, text=_BODY_SECRET)

    failing = EnterpriseVaultProvider(
        "http://admin.test",
        _TOKEN,
        transport=httpx.MockTransport(fail),
    )
    try:
        with pytest.raises(CredentialResolutionError) as caught:
            await failing.resolve("T", "sess", ["vault-a"])
    finally:
        await failing.aclose()
    text = str(caught.value)
    assert text == "vault service returned 500"
    assert _TOKEN not in text
    assert _BODY_SECRET not in text
    assert _TOKEN not in repr(failing)
