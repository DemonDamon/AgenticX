#!/usr/bin/env python3
"""Smoke tests for the Offloader protocol (AgentScope 2.0 internalization, P0-2).

Covers:
- Happy path: offload context / tool result then retrieve round-trip.
- Threshold: ``should_offload`` keeps small payloads inline.
- Reference serialization + placeholder rendering.
- Failure path: retrieving an unknown handle raises OffloadError.

Run:
    pytest -q tests/test_smoke_agentscope_offloader.py
    pytest -q -k "smoke_agentscope"

Author: Damon Li
"""

import asyncio

import pytest

from agenticx.core.offload import (
    DEFAULT_OFFLOAD_THRESHOLD_BYTES,
    FileOffloader,
    OffloadError,
    Reference,
    should_offload,
)


def test_should_offload_threshold():
    assert should_offload("") is False
    assert should_offload("x" * 10, threshold=100) is False
    assert should_offload("x" * 101, threshold=100) is True
    # Default threshold is 4KB.
    assert should_offload("x" * (DEFAULT_OFFLOAD_THRESHOLD_BYTES + 1)) is True
    assert should_offload("x" * DEFAULT_OFFLOAD_THRESHOLD_BYTES) is False


def test_reference_roundtrip_and_placeholder():
    ref = Reference(
        handle="abc123",
        size=12345,
        kind="tool_result",
        session_id="s1",
        summary="line1\nline2",
        tool_name="web_fetch",
    )
    placeholder = ref.to_placeholder()
    assert "abc123" in placeholder
    assert "web_fetch" in placeholder
    assert "12345" in placeholder
    # newlines flattened
    assert "\n" not in placeholder

    rebuilt = Reference.from_dict(ref.to_dict())
    assert rebuilt.handle == ref.handle
    assert rebuilt.size == ref.size
    assert rebuilt.tool_name == ref.tool_name


def test_offload_tool_result_roundtrip(tmp_path):
    off = FileOffloader(root=tmp_path)
    big = "PDF-CONTENT-" + ("z" * 8000)

    async def _run():
        ref = await off.offload_tool_result("sess-1", big, tool_name="liteparse")
        assert ref.kind == "tool_result"
        assert ref.tool_name == "liteparse"
        assert ref.size == len(big.encode("utf-8"))
        got = await off.retrieve(ref)
        assert got == big
        return ref

    ref = asyncio.run(_run())
    # File actually persisted under <root>/<session>/<handle>.json
    assert (tmp_path / "sess-1" / f"{ref.handle}.json").exists()


def test_offload_context_roundtrip(tmp_path):
    off = FileOffloader(root=tmp_path)
    msgs = [
        {"role": "user", "content": "summarize this huge log"},
        {"role": "assistant", "content": [{"type": "text", "text": "ok " * 100}]},
    ]

    async def _run():
        ref = await off.offload_context("sess-ctx", msgs)
        assert ref.kind == "context"
        got = await off.retrieve(ref)
        assert "[user] summarize this huge log" in got
        assert "ok ok" in got

    asyncio.run(_run())


def test_retrieve_unknown_handle_raises(tmp_path):
    off = FileOffloader(root=tmp_path)
    bogus = Reference(
        handle="deadbeef",
        size=0,
        kind="tool_result",
        session_id="missing",
    )

    async def _run():
        with pytest.raises(OffloadError):
            await off.retrieve(bogus)

    asyncio.run(_run())


def test_session_id_path_traversal_is_sanitized(tmp_path):
    off = FileOffloader(root=tmp_path)

    async def _run():
        ref = await off.offload_tool_result("../../etc", "payload", tool_name="t")
        got = await off.retrieve(ref)
        assert got == "payload"

    asyncio.run(_run())
    # All records stay under the configured root (no traversal escape).
    records = list(tmp_path.rglob("*.json"))
    assert records, "expected at least one persisted record"
    for rec in records:
        assert tmp_path in rec.resolve().parents
