#!/usr/bin/env python3
"""JWT signing secret resolution for AgenticX server.

Fails closed when AGENTICX_JWT_SECRET is unset. The previous hardcoded
fallback ``agenticx-dev-secret-change-in-production`` is removed so forged
HS256 tokens cannot be minted with a public known key.

Local throwaway only: set AGENTICX_ALLOW_INSECURE_DEV_JWT=1 to use an
ephemeral per-process secret (tokens do not survive restart).

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import secrets
from typing import Optional

logger = logging.getLogger(__name__)

_INSECURE_DEV_FLAG = "AGENTICX_ALLOW_INSECURE_DEV_JWT"
_ENV_SECRET = "AGENTICX_JWT_SECRET"

#: Ephemeral secret for insecure-dev opt-in (process-local, never the old public string).
_ephemeral_dev_secret: Optional[str] = None

_MISSING_SECRET_MSG = (
    f"{_ENV_SECRET} is not set. Set a high-entropy secret before using JWT auth. "
    f"For local throwaway only, set {_INSECURE_DEV_FLAG}=1 "
    "(uses an ephemeral in-process secret; tokens will not verify after restart)."
)


def resolve_jwt_secret(explicit: Optional[str] = None) -> str:
    """Resolve the JWT HS256 signing secret.

    Priority:
    1. Non-empty ``explicit`` argument
    2. Non-empty ``AGENTICX_JWT_SECRET`` environment variable
    3. If ``AGENTICX_ALLOW_INSECURE_DEV_JWT`` is truthy: ephemeral process secret
    4. Otherwise raise ``RuntimeError`` (fail closed)

    Args:
        explicit: Optional secret passed by the caller (e.g. UserManager ctor).

    Returns:
        Signing secret string.

    Raises:
        RuntimeError: When no secret is configured and insecure-dev is not enabled.
    """
    if explicit is not None:
        stripped = str(explicit).strip()
        if stripped:
            return stripped

    env_secret = (os.environ.get(_ENV_SECRET) or "").strip()
    if env_secret:
        return env_secret

    allow_insecure = (os.environ.get(_INSECURE_DEV_FLAG) or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if allow_insecure:
        global _ephemeral_dev_secret
        if _ephemeral_dev_secret is None:
            _ephemeral_dev_secret = secrets.token_urlsafe(48)
            logger.warning(
                "%s is set but %s is unset; using ephemeral JWT secret for this process. "
                "Do not use in production.",
                _INSECURE_DEV_FLAG,
                _ENV_SECRET,
            )
        return _ephemeral_dev_secret

    raise RuntimeError(_MISSING_SECRET_MSG)


def reset_ephemeral_dev_secret_for_tests() -> None:
    """Clear the process-local ephemeral secret (tests only)."""
    global _ephemeral_dev_secret
    _ephemeral_dev_secret = None
