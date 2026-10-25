#!/usr/bin/env python3
"""Per-session egress checks and placeholder substitution.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.managed.credentials import CredentialBundle, ResolvedCredential
from agenticx.managed.egress_policy import SessionEgressPolicy


def _env(secret: str, hosts: tuple[str, ...], networking: str = "limited") -> ResolvedCredential:
    return ResolvedCredential(
        credential_id="env",
        vault_id="v",
        vault_index=0,
        type="environment_variable",
        display_name=None,
        secret=secret,
        secret_name="EXAMPLE_API_KEY",
        networking=networking,  # type: ignore[arg-type]
        allowed_hosts=hosts,
    )


def _bearer(host: str, secret: str) -> ResolvedCredential:
    return ResolvedCredential(
        credential_id="bearer",
        vault_id="v",
        vault_index=0,
        type="bearer",
        display_name=None,
        secret=secret,
        host=host,
    )


def test_empty_allow_list_does_not_restrict() -> None:
    policy = SessionEgressPolicy(
        allow_domains=(),
        bundle=CredentialBundle(),
        placeholders={},
    )
    assert policy.check("https://evil.com/x") is None
    assert policy.check("not a url") is None
    assert policy.command_network() == "inherit"
    assert policy.blocked == []


def test_allow_list_blocks_and_records() -> None:
    policy = SessionEgressPolicy(
        allow_domains=("example.com",),
        bundle=CredentialBundle(),
        placeholders={},
    )
    assert policy.check("https://api.example.com/x") is None
    denial = policy.check("https://evil.com/y")
    assert denial == "egress blocked: evil.com is not in the allow list"
    assert policy.blocked == [("evil.com", denial)]
    assert policy.command_network() == "deny"


def test_rewrite_headers_and_arguments() -> None:
    placeholder = "agxsec_" + ("a" * 32)
    secret = "env-secret-value-123" # gitleaks:allow
    limited = SessionEgressPolicy(
        allow_domains=(),
        bundle=CredentialBundle(credentials=(_env(secret, ("api.example.com",)),)),
        placeholders={"env": placeholder},
    )
    allowed = f"https://api.example.com/v1?key={placeholder}"
    assert limited.rewrite_url(allowed) == "https://api.example.com/v1?key=" + secret
    denied = f"https://evil.example/v1?key={placeholder}"
    assert limited.rewrite_url(denied) == denied

    open_policy = SessionEgressPolicy(
        allow_domains=(),
        bundle=CredentialBundle(credentials=(_env(secret, (), networking="unrestricted"),)),
        placeholders={"env": placeholder},
    )
    assert secret in open_policy.rewrite_url(f"https://anywhere.test/{placeholder}")

    bearer = SessionEgressPolicy(
        allow_domains=(),
        bundle=CredentialBundle(credentials=(_bearer("docs.example.com", "bearer-token-value"),)),
        placeholders={},
    )
    assert bearer.headers_for("https://docs.example.com/a") == {
        "Authorization": "Bearer bearer-token-value"
    }
    assert bearer.headers_for("https://other.example.com/a") == {}

    replaced = limited.substitute_arguments(
        "https://api.example.com/x",
        {"headers": {"Authorization": f"Bearer {placeholder}"}, "n": 1},
    )
    assert replaced["headers"]["Authorization"] == f"Bearer {secret}"
    assert replaced["n"] == 1
    untouched = limited.substitute_arguments(
        "https://evil.example/x",
        {"q": placeholder},
    )
    assert untouched["q"] == placeholder
    assert limited.command_env() == {"EXAMPLE_API_KEY": placeholder}
