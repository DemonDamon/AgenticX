#!/usr/bin/env python3
"""ManagedAgentBuilder assembly tests.

Author: Damon Li
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from agenticx.managed.builder import (
    DEFAULT_SYSTEM_PROMPT,
    ManagedAgentBuilder,
    build_system_prompt,
    rehydrate_agent_messages,
)
from agenticx.managed.llm import LLMCallContext
from agenticx.managed.spec import compile_spec
from agenticx.managed.testing import ScriptStep, ScriptedLLM, StaticLLMFactory, tool_call
from agenticx.runtime.hooks import AgentHook
from agenticx.tools.fallback_chain import ToolResolver

SID = "01JABCDEFGHJKMNPQRSTVWXYZ0"


def _context(session_id: str = SID) -> LLMCallContext:
    return LLMCallContext(
        tenant_id="tenant-1",
        session_id=session_id,
        agent_id="agent-1",
        agent_version=1,
    )


def _spec(tools: list | None = None, **extra: object):
    raw: dict = {"schema": "agx.agent/v1", "model": "fake/scripted"}
    if tools is not None:
        raw["tools"] = tools
    raw.update(extra)
    return compile_spec("agent-1", 1, raw)


def test_build_sets_workdir_and_session(tmp_path: Path) -> None:
    spec = _spec(runtime={"max_tool_rounds": 12})
    bundle = ManagedAgentBuilder(
        llm_factory=StaticLLMFactory(ScriptedLLM([])),
        workdir_root=tmp_path / "ma",
    ).build(spec, context=_context())
    expected = (tmp_path / "ma" / SID / "work").resolve()
    assert bundle.workdir == expected
    assert bundle.workdir.is_dir()
    assert bundle.session.workspace_dir == str(bundle.workdir)
    assert bundle.session.taskspaces[0]["id"] == "default"
    assert bundle.session.provider_name == "fake"
    assert bundle.runtime.max_tool_rounds == spec.max_tool_rounds
    assert bundle.session.sticky_allowed_tools == set()
    assert bundle.session.kb_retrieval_mode == "auto"


def test_personal_hooks_removed(tmp_path: Path) -> None:
    builder = ManagedAgentBuilder(
        llm_factory=StaticLLMFactory(ScriptedLLM([])),
        workdir_root=tmp_path / "ma",
    )
    spec = _spec()
    bare = builder.build(spec, context=_context("sess-bare"))
    assert bare.runtime.hooks.has_hooks() is False

    class _Probe(AgentHook):
        pass

    hooked = builder.build(spec, context=_context("sess-hooked"), hooks=(_Probe(),))
    assert len(hooked.runtime.hooks._entries) == 1


async def test_run_turn_final_with_scripted_llm(tmp_path: Path) -> None:
    llm = ScriptedLLM([ScriptStep("hello from managed")])
    spec = _spec(tools=[{"type": "agx_builtin"}])
    bundle = ManagedAgentBuilder(
        llm_factory=StaticLLMFactory(llm),
        workdir_root=tmp_path / "ma",
    ).build(spec, context=_context())
    events = [event async for event in bundle.run_turn("hi")]
    finals = [event for event in events if event.type == "final"]
    assert finals
    assert finals[-1].data["text"] == "hello from managed"
    assert "bash_exec" in llm.calls[0]["tools"]
    assert "cc_bridge_start" not in llm.calls[0]["tools"]


async def test_custom_tool_routes_to_resolver(tmp_path: Path) -> None:
    class _LookupResolver(ToolResolver):
        def __init__(self) -> None:
            self.received: list[dict[str, Any]] = []

        async def can_handle(self, task_intent: str) -> bool:
            return task_intent == "lookup_order"

        async def resolve(self, task_intent: str, **kwargs: Any) -> str:
            del task_intent
            self.received.append(dict(kwargs))
            return "order shipped"

    resolver = _LookupResolver()
    llm = ScriptedLLM(
        [
            ScriptStep(
                "",
                tool_calls=[tool_call("lookup_order", {"order_id": "A-1"}, "call-1")],
            ),
            ScriptStep("done"),
        ]
    )
    spec = _spec(
        tools=[
            {
                "type": "custom",
                "name": "lookup_order",
                "description": "Look up an order",
                "input_schema": {
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}},
                },
            }
        ]
    )
    bundle = ManagedAgentBuilder(
        llm_factory=StaticLLMFactory(llm),
        workdir_root=tmp_path / "ma",
    ).build(spec, context=_context(), custom_tool_resolver=resolver)
    events = [event async for event in bundle.run_turn("where is A-1")]
    results = [
        event.data.get("result")
        for event in events
        if event.type == "tool_result"
    ]
    assert "order shipped" in results
    assert resolver.received
    business = {
        key: value
        for key, value in resolver.received[0].items()
        if not str(key).startswith("__")
    }
    assert business == {"order_id": "A-1"}


def test_system_prompt_contains_workdir(tmp_path: Path) -> None:
    workdir = tmp_path / "work"
    spec = _spec(system="Be precise.")
    prompt = build_system_prompt(spec, workdir)
    assert prompt.startswith("Be precise.")
    assert "[managed-runtime]" in prompt
    assert f"Working directory: {workdir}" in prompt
    empty = _spec(system="")
    assert build_system_prompt(empty, workdir).startswith(DEFAULT_SYSTEM_PROMPT)


def test_rehydrate_agent_messages() -> None:
    events = [
        {"type": "user.message", "content": [{"type": "text", "text": "q1"}]},
        {"type": "agent.tool_use", "name": "bash_exec", "input": {"command": "ls"}},
        {"type": "agent.message", "content": [{"type": "text", "text": "a1"}]},
    ]
    assert rehydrate_agent_messages(events) == [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
    ]


def test_llm_factory_receives_context(tmp_path: Path) -> None:
    class _RecordingFactory:
        def __init__(self) -> None:
            self.kwargs: list[dict[str, Any]] = []

        def create(self, *, provider: str, model: str, context: LLMCallContext) -> ScriptedLLM:
            self.kwargs.append({"provider": provider, "model": model, "context": context})
            return ScriptedLLM([])

    factory = _RecordingFactory()
    ManagedAgentBuilder(llm_factory=factory, workdir_root=tmp_path / "ma").build(
        _spec(),
        context=_context(),
    )
    assert factory.kwargs[0]["provider"] == "fake"
    assert factory.kwargs[0]["model"] == "scripted"
    assert factory.kwargs[0]["context"].session_id == SID


def test_no_studio_imports_in_source() -> None:
    root = Path(__file__).resolve().parents[2] / "agenticx" / "managed"
    for name in ("spec.py", "llm.py", "builder.py", "testing.py"):
        text = (root / name).read_text(encoding="utf-8")
        assert "agenticx.studio" not in text, name


def test_import_does_not_load_studio_server() -> None:
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys, agenticx.managed.builder; assert 'agenticx.studio.server' not in sys.modules",
        ],
        check=True,
    )
