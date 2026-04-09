#!/usr/bin/env python3
"""Tests for CC bridge Studio client URL policy.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.cc_bridge.settings import validate_bridge_url_for_studio


@pytest.mark.parametrize(
    ("url", "expect_err"),
    [
        ("http://127.0.0.1:9742", False),
        ("http://localhost:9/x", False),
        ("http://[::1]:9742", False),
        ("http://example.com:9742", True),
    ],
)
def test_validate_loopback(url: str, expect_err: bool, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_CC_BRIDGE_ALLOW_NONLOCAL", raising=False)
    err = validate_bridge_url_for_studio(url)
    if expect_err:
        assert err is not None
    else:
        assert err is None


def test_validate_nonlocal_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_CC_BRIDGE_ALLOW_NONLOCAL", "1")
    assert validate_bridge_url_for_studio("http://10.0.0.5:9742") is None
