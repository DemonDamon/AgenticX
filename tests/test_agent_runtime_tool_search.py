"""SP2: AgentRuntime ToolSearch projection and tool_search dispatch."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.tool_search import (
    BUILTIN_DEFER_ALLOWLIST,
    CORE_ALWAYS_LOAD_TOOLS,
    TOOL_NOT_YET_LOADED_TEMPLATE,
    TOOL_SEARCH_STATE_KEY,
    TOOL_SEARCH_TOOL_NAME,
    ToolSearchConfig,
    dump_state_to_scratchpad,
    project_tools_for_round,
)
from agenticx.runtime.tool_search_runtime import build_runtime_context


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


def _tool_names(tools: list) -> set[str]:
    out: set[str] = set()
    for t in tools:
        if not isinstance(t, dict):
            continue
        fn = t.get("function")
        if isinstance(fn, dict):
            n = str(fn.get("name") or "").strip()
            if n:
                out.add(n)
    return out


def _make_pool() -> list[dict]:
    names = sorted(CORE_ALWAYS_LOAD_TOOLS | BUILTIN_DEFER_ALLOWLIST | {TOOL_SEARCH_TOOL_NAME})
    # Ensure deferred target exists
    assert "web_fetch" in BUILTIN_DEFER_ALLOWLIST
    pool = []
    for name in names:
        pool.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": f"tool {name}",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        )
    return pool


class _CaptureToolsLLM:
    """Capture tools= kwargs each invoke; scripted tool_calls per round."""

    def __init__(self, script: list) -> None:
        self.script = list(script)
        self.calls = 0
        self.tools_seen: list[set[str]] = []

    def invoke(self, *_args, **kwargs):
        tools = kwargs.get("tools") or []
        self.tools_seen.append(_tool_names(list(tools)))
        self.calls += 1
        if self.script:
            item = self.script.pop(0)
            return _FakeResponse(item.get("content", ""), item.get("tool_calls", []))
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield ""


class _StreamCaptureToolsLLM(_CaptureToolsLLM):
    """Prefer stream_with_tools path; still capture tools."""

    def stream_with_tools(self, *_args, **kwargs):
        tools = kwargs.get("tools") or []
        self.tools_seen.append(_tool_names(list(tools)))
        self.calls += 1
        if self.script:
            item = self.script.pop(0)
            content = item.get("content", "")
            tool_calls = item.get("tool_calls", [])
            if content:
                yield {"type": "content", "text": content}
            for tc in tool_calls:
                yield {"type": "tool_call", "tool_call": tc}
            return
        yield {"type": "content", "text": "done"}

    def invoke(self, *_args, **kwargs):
        # Fallback if stream path fails
        return super().invoke(*_args, **kwargs)


async def _collect(runtime: AgentRuntime, session: StudioSession, text: str, **kwargs):
    items = []
    async for event in runtime.run_turn(text, session, **kwargs):
        items.append({"type": event.type, "data": event.data})
    return items


def test_studio_tools_registers_tool_search():
    from agenticx.cli.agent_tools import STUDIO_TOOLS
    from agenticx.runtime.meta_tools import META_AGENT_TOOLS

    assert TOOL_SEARCH_TOOL_NAME in _tool_names(STUDIO_TOOLS)
    assert TOOL_SEARCH_TOOL_NAME in _tool_names(META_AGENT_TOOLS)


def test_mode_off_parity(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="off"),
    )
    pool = _make_pool()
    session = StudioSession()
    ctx = build_runtime_context(session=session, full_openai_tools=pool)
    out = project_tools_for_round(ctx, full_openai_tools=pool)
    assert _tool_names(out) == _tool_names(pool)


def test_first_round_projected(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="always"),
    )
    pool = _make_pool()
    llm = _CaptureToolsLLM([{"content": "ok", "tool_calls": []}])
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    asyncio.run(_collect(runtime, session, "hi", tools=pool))
    assert llm.tools_seen
    names0 = llm.tools_seen[0]
    assert TOOL_SEARCH_TOOL_NAME in names0
    assert "bash_exec" in names0
    assert "web_fetch" not in names0


def test_load_builtin_next_round(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="always"),
    )
    pool = _make_pool()
    script = [
        {
            "content": "search",
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {
                        "name": "tool_search",
                        "arguments": {"query": "select:web_fetch"},
                    },
                }
            ],
        },
        {"content": "done", "tool_calls": []},
    ]
    llm = _CaptureToolsLLM(script)
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "fetch docs", tools=pool))
    assert len(llm.tools_seen) >= 2
    assert "web_fetch" not in llm.tools_seen[0]
    assert "web_fetch" in llm.tools_seen[1]
    tool_results = [e for e in events if e["type"] == EventType.TOOL_RESULT.value]
    assert tool_results
    payload = tool_results[0]["data"].get("result", "")
    assert "web_fetch" in str(payload)
    assert "input_schema" not in str(payload)
    assert TOOL_SEARCH_STATE_KEY in (session.scratchpad or {})


def test_same_batch_not_yet_loaded(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="always"),
    )
    pool = _make_pool()
    script = [
        {
            "content": "both",
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {
                        "name": "tool_search",
                        "arguments": {"query": "select:web_fetch"},
                    },
                },
                {
                    "id": "c2",
                    "type": "function",
                    "function": {
                        "name": "web_fetch",
                        "arguments": {"url": "https://example.com"},
                    },
                },
            ],
        },
        {"content": "done", "tool_calls": []},
    ]
    llm = _CaptureToolsLLM(script)
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    events = asyncio.run(_collect(runtime, session, "both", tools=pool))
    results = [
        str(e["data"].get("result", ""))
        for e in events
        if e["type"] == EventType.TOOL_RESULT.value
        and e["data"].get("name") == "web_fetch"
    ]
    assert results
    assert "not loaded yet" in results[0]
    assert TOOL_NOT_YET_LOADED_TEMPLATE.format(name="web_fetch") == results[0] or (
        "tool_search" in results[0].lower()
    )


def test_scratchpad_restore(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="always"),
    )
    pool = _make_pool()
    session = StudioSession()
    ctx = build_runtime_context(session=session, full_openai_tools=pool)
    # Preload web_fetch
    from agenticx.runtime.tool_search import apply_search

    ctx2, _ = apply_search(ctx, "select:web_fetch")
    dump_state_to_scratchpad(session.scratchpad, ctx2.state)

    llm = _CaptureToolsLLM([{"content": "ok", "tool_calls": []}])
    runtime = AgentRuntime(llm, _ApproveGate())
    asyncio.run(_collect(runtime, session, "hi", tools=pool))
    assert "web_fetch" in llm.tools_seen[0]


def test_streaming_path_projects(monkeypatch):
    monkeypatch.setattr(
        "agenticx.runtime.tool_search_runtime.read_tool_search_config",
        lambda: ToolSearchConfig(mode="always"),
    )
    pool = _make_pool()
    llm = _StreamCaptureToolsLLM([{"content": "ok", "tool_calls": []}])
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    asyncio.run(_collect(runtime, session, "hi", tools=pool))
    assert llm.tools_seen
    assert "web_fetch" not in llm.tools_seen[0]
    assert TOOL_SEARCH_TOOL_NAME in llm.tools_seen[0]


def test_dispatch_tool_search_compact_result():
    from agenticx.cli.agent_tools import dispatch_tool_async

    pool = _make_pool()
    session = StudioSession()
    ctx = build_runtime_context(
        session=session,
        full_openai_tools=pool,
        config=ToolSearchConfig(mode="always"),
    )

    async def _run():
        return await dispatch_tool_async(
            "tool_search",
            {"query": "select:web_fetch"},
            session,
            runtime_tool_context=ctx,
        )

    raw = asyncio.run(_run())
    data = json.loads(raw)
    assert data["matches"][0]["name"] == "web_fetch"
    blob = json.dumps(data)
    assert "properties" not in blob
    assert "builtin:web_fetch" in ctx.state.loaded_ids


def test_meta_prompt_mentions_tool_search():
    from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt

    session = StudioSession()
    prompt = build_meta_agent_system_prompt(session)
    assert "tool_search" in prompt
