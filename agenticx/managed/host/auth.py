#!/usr/bin/env python3
"""Bearer-token authentication for the Managed Agents host.

Author: Damon Li
"""

from __future__ import annotations

import hmac
from collections.abc import Mapping
from typing import Protocol

from agenticx.managed.errors import FORBIDDEN_SCOPE, MAError
from agenticx.managed.host.config import Principal


class TokenAuthenticator(Protocol):
    """Resolve a raw bearer token to a principal."""

    async def authenticate(self, token: str) -> Principal | None:
        """Return the principal, or None when the token is not accepted."""
        ...


def _constant_match(candidate: str, token: str) -> bool:
    left = candidate.encode("utf-8")
    right = token.encode("utf-8")
    if len(left) != len(right):
        hmac.compare_digest(left, left)
        return False
    return hmac.compare_digest(left, right)


class StaticTokenAuthenticator:
    """Compare every configured token with ``hmac.compare_digest``."""

    def __init__(self, tokens: Mapping[str, Principal]) -> None:
        self._tokens = dict(tokens)

    async def authenticate(self, token: str) -> Principal | None:
        """Walk the whole table. A match does not skip the remaining compares."""
        matched: Principal | None = None
        for candidate, principal in self._tokens.items():
            if _constant_match(candidate, token) and matched is None:
                matched = principal
        return matched


def bearer_token(authorization_header: str | None) -> str | None:
    """Return the token from ``Bearer <token>``. Any other shape returns None."""
    if not authorization_header:
        return None
    scheme, separator, rest = authorization_header.partition(" ")
    if not separator or scheme.lower() != "bearer":
        return None
    token = rest.strip()
    if not token:
        return None
    return token


def require_scope(principal: Principal, scope: str) -> None:
    """Allow ``scope`` or ``ma:admin``. Otherwise raise ``forbidden_scope``."""
    if scope in principal.scopes or "ma:admin" in principal.scopes:
        return
    raise MAError(
        FORBIDDEN_SCOPE,
        f"missing scope {scope}",
        details={"scope": scope},
    )


__all__ = [
    "StaticTokenAuthenticator",
    "TokenAuthenticator",
    "bearer_token",
    "require_scope",
]
