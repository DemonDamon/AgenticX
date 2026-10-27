#!/usr/bin/env python3
"""Per-session outbound allow list and placeholder substitution.

Author: Damon Li
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping
from urllib.parse import urlsplit

from agenticx.managed.credentials import CredentialBundle, ResolvedCredential, host_matches
from agenticx.runtime.session_boundary import EgressGuard

logger = logging.getLogger(__name__)


def _host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".")


@dataclass
class SessionEgressPolicy:
    """Environment allow list plus per-credential host limits for one turn."""

    allow_domains: tuple[str, ...]
    bundle: CredentialBundle
    placeholders: Mapping[str, str]
    enforce: bool = True
    blocked: list[tuple[str, str]] = field(default_factory=list)

    def check(self, url: str) -> str | None:
        """Return a denial string, or None when the request may proceed.

        An empty allow list means no extra restriction. When enforcement is
        off, a would-be denial is logged and the request is allowed.
        """
        if not self.allow_domains:
            return None
        host = _host_of(url)
        if not host:
            reason = "egress blocked: missing host"
        elif any(host_matches(host, domain, include_subdomains=True) for domain in self.allow_domains):
            return None
        else:
            reason = f"egress blocked: {host} is not in the allow list"
        if not self.enforce:
            logger.warning("egress allow list not enforced: %s", reason)
            return None
        self.blocked.append((host, reason))
        return reason

    def rewrite_url(self, url: str) -> str:
        host = _host_of(url)
        for credential in self.bundle.env_credentials():
            placeholder = self.placeholders.get(credential.credential_id)
            if not placeholder or placeholder not in url:
                continue
            if _credential_allows(credential, host):
                url = url.replace(placeholder, credential.secret)
        return url

    def headers_for(self, url: str) -> dict[str, str]:
        credential = self.bundle.bearer_for_host(_host_of(url))
        if credential is None or not credential.secret:
            return {}
        return {"Authorization": f"Bearer {credential.secret}"}

    def substitute_arguments(self, target_url: str, value: Any) -> Any:
        host = _host_of(target_url)
        return _substitute(value, host, self)

    def command_env(self) -> dict[str, str]:
        overlay: dict[str, str] = {}
        for credential in self.bundle.env_credentials():
            if not credential.secret_name:
                continue
            placeholder = self.placeholders.get(credential.credential_id)
            if placeholder:
                overlay[credential.secret_name] = placeholder
        return overlay

    def command_network(self) -> Literal["inherit", "deny"]:
        if self.enforce and self.allow_domains:
            return "deny"
        return "inherit"

    def to_guard(self) -> EgressGuard:
        return EgressGuard(
            check=self.check,
            rewrite_url=self.rewrite_url,
            headers_for=self.headers_for,
        )

    def drain_blocked(self) -> list[tuple[str, str]]:
        found = list(self.blocked)
        self.blocked.clear()
        return found


def _credential_allows(credential: ResolvedCredential, host: str) -> bool:
    if credential.networking == "unrestricted":
        return True
    return any(
        host_matches(host, pattern, include_subdomains=False)
        for pattern in credential.allowed_hosts
    )


def _replace_placeholders(text: str, host: str, policy: SessionEgressPolicy) -> str:
    for credential in policy.bundle.env_credentials():
        placeholder = policy.placeholders.get(credential.credential_id)
        if not placeholder or placeholder not in text:
            continue
        if _credential_allows(credential, host):
            text = text.replace(placeholder, credential.secret)
    return text


def _substitute(value: Any, host: str, policy: SessionEgressPolicy) -> Any:
    if isinstance(value, str):
        return _replace_placeholders(value, host, policy)
    if isinstance(value, list):
        return [_substitute(item, host, policy) for item in value]
    if isinstance(value, tuple):
        return [_substitute(item, host, policy) for item in value]
    if isinstance(value, dict):
        return {key: _substitute(item, host, policy) for key, item in value.items()}
    return value


__all__ = [
    "SessionEgressPolicy",
]
