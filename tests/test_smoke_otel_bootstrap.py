"""Smoke tests for Studio OTel bootstrap helper.

Author: Damon Li
"""

from __future__ import annotations


def test_maybe_enable_studio_otel_default_false(monkeypatch):
    monkeypatch.delenv("AGENTICX_OTEL_ENABLED", raising=False)
    from agenticx.ops.otel_bootstrap import maybe_enable_studio_otel

    assert maybe_enable_studio_otel() is False
