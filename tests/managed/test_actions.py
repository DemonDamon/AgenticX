#!/usr/bin/env python3
"""Custom tool resolver and action-broker protocol tests.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agenticx.managed.actions import (
    ActionBroker,
    CustomToolResolver,
    render_content_text,
)
from agenticx.managed.protocol import (
    DocumentBlock,
    ImageBlock,
    TextBlock,
    TextDocSource,
    UrlSource,
    UserCustomToolResult,
)


class FakeBroker:
    """Minimal ActionBroker stand-in for the protocol check."""

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        del _args, _kwargs

    async def announce_tool_use(
        self,
        *,
        kind: str,
        name: str,
        input: dict[str, Any],
        evaluated_policy: str | None,
        mcp_server: str | None = None,
    ) -> str:
        del kind, name, input, evaluated_policy, mcp_server
        return "evt"

    async def request_action(self, event_id: str, kind: str) -> Any:
        del event_id, kind
        return None

    def custom_tool_use_id(self, name: str) -> str | None:
        del name
        return None


class _ScriptBroker:
    def __init__(
        self,
        *,
        event_id: str | None = "evt",
        resolution: Any = None,
        explode: bool = False,
    ) -> None:
        self._event_id = event_id
        self._resolution = resolution
        self._explode = explode

    async def announce_tool_use(self, **kwargs: Any) -> str:
        del kwargs
        return "evt"

    async def request_action(self, event_id: str, kind: str) -> Any:
        del event_id, kind
        if self._explode:
            raise RuntimeError("bridge down")
        return self._resolution

    def custom_tool_use_id(self, name: str) -> str | None:
        del name
        if self._explode and self._event_id is None:
            raise RuntimeError("bridge down")
        return self._event_id


def _resolver(broker: _ScriptBroker) -> CustomToolResolver:
    return CustomToolResolver(
        broker=broker,
        custom_tool_names=frozenset({"lookup_order"}),
    )


async def test_custom_resolver_branches() -> None:
    missing = _resolver(_ScriptBroker(event_id=None))
    assert (
        await missing.resolve("lookup_order", order_id="A-1")
        == "ERROR: custom tool use was not announced"
    )

    interrupted = _resolver(_ScriptBroker(resolution=None))
    assert (
        await interrupted.resolve("lookup_order")
        == "CANCELLED: interrupted while waiting for custom tool result"
    )

    failed = UserCustomToolResult(
        type="user.custom_tool_result",
        custom_tool_use_id="x",
        content=[TextBlock(type="text", text="bad")],
        is_error=True,
    )
    errored = _resolver(_ScriptBroker(resolution=failed))
    assert await errored.resolve("lookup_order") == "ERROR: bad"

    empty = UserCustomToolResult(
        type="user.custom_tool_result",
        custom_tool_use_id="x",
        content=[],
    )
    blank = _resolver(_ScriptBroker(resolution=empty))
    assert await blank.resolve("lookup_order") == "(empty result)"

    boom = _resolver(_ScriptBroker(event_id=None, explode=True))
    text = await boom.resolve("lookup_order", __tool_call_id="c1")
    assert text.startswith("ERROR: custom tool bridge failed")
    assert "RuntimeError" in text


def test_render_content_text() -> None:
    blocks = [
        TextBlock(type="text", text="a"),
        DocumentBlock(
            type="document",
            title="spec",
            source=TextDocSource(type="text", text="body"),
        ),
        ImageBlock(
            type="image",
            source=UrlSource(type="url", url="https://example.com/a.png"),
        ),
    ]
    assert render_content_text(blocks) == (
        "a\n[document: spec]\nbody\n[image omitted]"
    )
    untitled = {
        "type": "document",
        "title": None,
        "source": {"type": "text", "text": "body"},
    }
    assert render_content_text([untitled]) == "[document]\nbody"
    filed = {
        "type": "document",
        "source": {"type": "file", "file_id": "f1"},
    }
    assert render_content_text([filed]) == "[document file: f1]"


def test_broker_protocol_runtime_checkable() -> None:
    assert isinstance(FakeBroker(), ActionBroker) is True


def test_no_studio_imports() -> None:
    root = Path(__file__).resolve().parents[2] / "agenticx" / "managed"
    for name in ("permissions.py", "actions.py"):
        text = (root / name).read_text(encoding="utf-8")
        assert "agenticx.studio" not in text, name
