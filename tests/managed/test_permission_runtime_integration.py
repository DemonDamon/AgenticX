#!/usr/bin/env python3
"""Managed permission hook wired through AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from agenticx.managed.actions import CustomToolResolver
from agenticx.managed.builder import ManagedAgentBuilder
from agenticx.managed.events.adapter import RuntimeEventAdapter
from agenticx.managed.llm import LLMCallContext
from agenticx.managed.permissions import (
    ManagedConfirmGate,
    ManagedPermissionHook,
    PermissionEngine,
    ToolAuthorization,
)
from agenticx.managed.protocol import (
    TextBlock,
    Usage,
    UserCustomToolResult,
    UserToolConfirmation,
)
from agenticx.managed.spec import AgentSpec, compile_spec
from agenticx.managed.testing import (
    ScriptStep,
    ScriptedLLM,
    StaticLLMFactory,
    tool_call,
)
from agenticx.runtime.enterprise_agent_policy import EnterpriseAgentPolicy

SID = "01JABCDEFGHJKMNPQRSTVWXYZ0"


class FakeBroker:
    """In-memory ActionBroker. Feeds RuntimeEventAdapter like the host."""

    def __init__(self, adapter: RuntimeEventAdapter, resolutions: list[Any]) -> None:
        self.adapter = adapter
        self.events: list[dict[str, Any]] = []
        self.requests: list[tuple[str, str]] = []
        self._resolutions = list(resolutions)

    async def announce_tool_use(
        self,
        *,
        kind: str,
        name: str,
        input: dict[str, Any],
        evaluated_policy: str | None,
        mcp_server: str | None = None,
    ) -> str:
        evs = self.adapter.build_tool_use(
            kind=kind,
            name=name,
            input=input,
            evaluated_policy=evaluated_policy,
            mcp_server=mcp_server,
        )
        self.events.extend(evs)
        return evs[-1]["id"]

    async def request_action(self, event_id: str, kind: str) -> Any:
        self.requests.append((event_id, kind))
        return self._resolutions.pop(0)

    def custom_tool_use_id(self, name: str) -> str | None:
        return self.adapter.ledger.inflight_custom(name)


def _context() -> LLMCallContext:
    return LLMCallContext(
        tenant_id="tenant-1",
        session_id=SID,
        agent_id="agent-1",
        agent_version=1,
    )


def _spec(tools: list[dict[str, Any]]) -> AgentSpec:
    return compile_spec(
        "agent-1",
        1,
        {"schema": "agx.agent/v1", "model": "fake/scripted", "tools": tools},
    )


def _builtin(configs: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "agx_builtin", "configs": configs}


def _lookup_tool() -> dict[str, Any]:
    return {
        "type": "custom",
        "name": "lookup_order",
        "description": "Look up an order",
        "input_schema": {
            "type": "object",
            "properties": {"order_id": {"type": "string"}},
        },
    }


def _allow(tool_use_id: str = "ignored") -> UserToolConfirmation:
    return UserToolConfirmation(
        type="user.tool_confirmation",
        tool_use_id=tool_use_id,
        result="allow",
    )


@pytest.fixture(autouse=True)
def _disable_effect_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")


def _patch_dispatch(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    import agenticx.runtime.agent_runtime as runtime_module

    calls: list[int] = []

    async def _fake(*_args: Any, **_kwargs: Any) -> str:
        calls.append(1)
        return "tool-ok"

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake)
    return calls


async def _drive(
    tmp_path: Path,
    *,
    spec: AgentSpec,
    steps: list[ScriptStep],
    resolutions: list[Any],
    enterprise: EnterpriseAgentPolicy | None = None,
) -> tuple[FakeBroker, ScriptedLLM, Any]:
    llm = ScriptedLLM(steps)
    adapter = RuntimeEventAdapter(model_ref=spec.model_ref, kind_of=spec.kind_of)
    adapter.begin_turn(Usage())
    broker = FakeBroker(adapter, resolutions)
    auth = ToolAuthorization()
    engine = PermissionEngine(spec, enterprise)
    bundle = ManagedAgentBuilder(
        llm_factory=StaticLLMFactory(llm),
        workdir_root=tmp_path / "ma",
    ).build(
        spec,
        context=_context(),
        confirm_gate=ManagedConfirmGate(auth),
        hooks=[
            ManagedPermissionHook(
                engine=engine,
                broker=broker,
                authorization=auth,
            )
        ],
        custom_tool_resolver=CustomToolResolver(
            broker=broker,
            custom_tool_names=spec.custom_tool_names,
        ),
    )
    async for event in bundle.run_turn("go"):
        broker.events.extend(adapter.convert(event).events)
    return broker, llm, bundle


def _of(events: list[dict[str, Any]], event_type: str) -> list[dict[str, Any]]:
    return [event for event in events if event.get("type") == event_type]


def _result_text(event: dict[str, Any]) -> str:
    content = event.get("content") or []
    if not content:
        return ""
    text = content[0].get("text")
    return text if isinstance(text, str) else ""


async def test_always_ask_allow_executes_tool(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _patch_dispatch(monkeypatch)
    spec = _spec([_builtin([{"name": "bash_exec", "policy": "always_ask"}])])
    broker, _llm, _bundle = await _drive(
        tmp_path,
        spec=spec,
        steps=[
            ScriptStep(
                "",
                tool_calls=[tool_call("bash_exec", {"command": "echo hi"}, "c1")],
            ),
            ScriptStep("done"),
        ],
        resolutions=[_allow()],
    )
    uses = _of(broker.events, "agent.tool_use")
    assert len(uses) == 1
    assert uses[0]["evaluated_policy"] == "always_ask"
    assert broker.requests == [(uses[0]["id"], "tool_confirmation")]
    assert len(calls) == 1
    results = _of(broker.events, "agent.tool_result")
    assert len(results) == 1
    assert results[0]["tool_use_id"] == uses[0]["id"]
    assert results[0]["is_error"] is False


async def test_always_ask_deny_blocks_tool(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _patch_dispatch(monkeypatch)
    spec = _spec([_builtin([{"name": "bash_exec", "policy": "always_ask"}])])
    denied = UserToolConfirmation(
        type="user.tool_confirmation",
        tool_use_id="ignored",
        result="deny",
        deny_message="nope",
    )
    broker, llm, _bundle = await _drive(
        tmp_path,
        spec=spec,
        steps=[
            ScriptStep(
                "",
                tool_calls=[tool_call("bash_exec", {"command": "echo hi"}, "c1")],
            ),
            ScriptStep("done"),
        ],
        resolutions=[denied],
    )
    assert calls == []
    results = _of(broker.events, "agent.tool_result")
    assert results[0]["is_error"] is True
    text = _result_text(results[0])
    assert text.startswith("CANCELLED: tool use denied by user: nope")
    tool_messages = [
        message
        for message in llm.calls[1]["messages"]
        if message.get("role") == "tool"
    ]
    assert any(text in str(message.get("content")) for message in tool_messages)


async def test_interrupt_while_waiting_returns_cancelled(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _patch_dispatch(monkeypatch)
    spec = _spec([_builtin([{"name": "bash_exec", "policy": "always_ask"}])])
    broker, _llm, _bundle = await _drive(
        tmp_path,
        spec=spec,
        steps=[
            ScriptStep(
                "",
                tool_calls=[tool_call("bash_exec", {"command": "echo hi"}, "c1")],
            ),
            ScriptStep("done"),
        ],
        resolutions=[None],
    )
    assert calls == []
    text = _result_text(_of(broker.events, "agent.tool_result")[0])
    assert text.startswith("CANCELLED: interrupted while waiting for confirmation")


async def test_no_sticky_allow_each_call_asks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_dispatch(monkeypatch)
    spec = _spec([_builtin([{"name": "bash_exec", "policy": "always_ask"}])])
    broker, _llm, bundle = await _drive(
        tmp_path,
        spec=spec,
        steps=[
            ScriptStep(
                "",
                tool_calls=[
                    tool_call("bash_exec", {"command": "echo c1"}, "c1"),
                    tool_call("bash_exec", {"command": "echo c2"}, "c2"),
                ],
            ),
            ScriptStep("final"),
        ],
        resolutions=[_allow(), _allow()],
    )
    assert len(broker.requests) == 2
    assert bundle.session.sticky_allowed_tools == set()


async def test_enterprise_deny_blocks_without_request(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _patch_dispatch(monkeypatch)
    spec = _spec([_builtin([{"name": "bash_exec", "policy": "always_allow"}])])
    broker, _llm, _bundle = await _drive(
        tmp_path,
        spec=spec,
        steps=[
            ScriptStep(
                "",
                tool_calls=[tool_call("bash_exec", {"command": "echo hi"}, "c1")],
            ),
            ScriptStep("done"),
        ],
        resolutions=[],
        enterprise=EnterpriseAgentPolicy(denied=("bash_exec",)),
    )
    assert broker.requests == []
    assert calls == []
    result = _of(broker.events, "agent.tool_result")[0]
    assert result["is_error"] is True
    assert _result_text(result).startswith(
        'ERROR: denied by enterprise policy "bash_exec"'
    )


async def test_always_allow_executes_without_request(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _patch_dispatch(monkeypatch)
    spec = _spec([_builtin([{"name": "file_read", "policy": "always_allow"}])])
    broker, _llm, _bundle = await _drive(
        tmp_path,
        spec=spec,
        steps=[
            ScriptStep(
                "",
                tool_calls=[tool_call("file_read", {"path": "README.md"}, "c1")],
            ),
            ScriptStep("done"),
        ],
        resolutions=[],
    )
    assert broker.requests == []
    uses = _of(broker.events, "agent.tool_use")
    assert len(uses) == 1
    assert uses[0]["evaluated_policy"] == "always_allow"
    assert len(calls) == 1


async def test_custom_tool_roundtrip(tmp_path: Path) -> None:
    spec = _spec([_lookup_tool()])
    shipped = UserCustomToolResult(
        type="user.custom_tool_result",
        custom_tool_use_id="x",
        content=[TextBlock(type="text", text="shipped")],
    )
    broker, llm, _bundle = await _drive(
        tmp_path,
        spec=spec,
        steps=[
            ScriptStep(
                "",
                tool_calls=[tool_call("lookup_order", {"order_id": "A-1"}, "c1")],
            ),
            ScriptStep("final"),
        ],
        resolutions=[shipped],
    )
    customs = _of(broker.events, "agent.custom_tool_use")
    assert len(customs) == 1
    assert broker.requests == [(customs[0]["id"], "custom_tool_result")]
    tool_messages = [
        message
        for message in llm.calls[1]["messages"]
        if message.get("role") == "tool"
    ]
    assert tool_messages
    assert tool_messages[0]["content"] == "shipped"
    assert _of(broker.events, "agent.tool_result") == []
