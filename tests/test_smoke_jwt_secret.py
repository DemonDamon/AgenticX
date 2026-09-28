#!/usr/bin/env python3
"""Smoke tests for JWT secret resolution (Issue #64).

Author: Damon Li
"""

from __future__ import annotations

import os

import pytest

from agenticx.server.jwt_secret import (
    reset_ephemeral_dev_secret_for_tests,
    resolve_jwt_secret,
)


@pytest.fixture(autouse=True)
def _clean_jwt_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("AGENTICX_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENTICX_ALLOW_INSECURE_DEV_JWT", raising=False)
    reset_ephemeral_dev_secret_for_tests()
    yield
    reset_ephemeral_dev_secret_for_tests()


def test_resolve_jwt_secret_fails_closed_when_unset():
    with pytest.raises(RuntimeError, match="AGENTICX_JWT_SECRET"):
        resolve_jwt_secret()


def test_resolve_jwt_secret_never_returns_legacy_public_string(monkeypatch: pytest.MonkeyPatch):
    """Issue #64: the old public fallback must not be usable as a default."""
    with pytest.raises(RuntimeError, match="AGENTICX_JWT_SECRET"):
        resolve_jwt_secret()
    monkeypatch.setenv("AGENTICX_ALLOW_INSECURE_DEV_JWT", "1")
    assert resolve_jwt_secret() != "agenticx-dev-secret-change-in-production"


def test_resolve_jwt_secret_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AGENTICX_JWT_SECRET", "deployment-specific-high-entropy-key")
    assert resolve_jwt_secret() == "deployment-specific-high-entropy-key"


def test_resolve_jwt_secret_explicit_overrides_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AGENTICX_JWT_SECRET", "env-key")
    assert resolve_jwt_secret("explicit-key") == "explicit-key"


def test_resolve_jwt_secret_insecure_dev_ephemeral(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AGENTICX_ALLOW_INSECURE_DEV_JWT", "1")
    a = resolve_jwt_secret()
    b = resolve_jwt_secret()
    assert a == b
    assert len(a) >= 32
    assert a != "agenticx-dev-secret-change-in-production"


def test_user_manager_rejects_forged_legacy_token(tmp_path, monkeypatch: pytest.MonkeyPatch):
    pytest.importorskip("jwt")
    import jwt
    import time

    from agenticx.server.user_manager import UserManager

    monkeypatch.setenv("AGENTICX_JWT_SECRET", "real-deployment-secret")
    um = UserManager(db_path=str(tmp_path / "users.db"))

    forged = jwt.encode(
        {
            "user_id": "1",
            "sub": "1",
            "roles": ["admin"],
            "permissions": ["*"],
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        },
        "agenticx-dev-secret-change-in-production",
        algorithm="HS256",
    )
    assert um.verify_jwt(forged) is None

    good = um.generate_jwt(1, "a@b.c", "u", ["user"])
    assert good
    payload = um.verify_jwt(good)
    assert payload is not None
    assert payload.get("username") == "u"


def test_auth_middleware_uses_resolve_not_hardcoded(monkeypatch: pytest.MonkeyPatch):
    from agenticx.server import auth as auth_mod

    monkeypatch.setenv("AGENTICX_JWT_SECRET", "mw-secret")
    assert auth_mod._get_jwt_secret() == "mw-secret"
    monkeypatch.delenv("AGENTICX_JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="AGENTICX_JWT_SECRET"):
        auth_mod._get_jwt_secret()
