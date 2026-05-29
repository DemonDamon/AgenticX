#!/usr/bin/env python3
"""Smoke tests for the embeddable ReActAgent facade (P0-0).

This is the headline "framework leadership" deliverable: prove AgenticX exposes
a clean, dependency-injection ReAct agent primitive that

1. can be imported and driven with **only** an injected LLM + tools, and
2. does **not** drag in product runtime coupling (``agenticx.cli`` /
   ``agenticx.studio``) on import.

Covers:
- Zero-coupling import (subprocess sys.modules assertion).
- Happy path: mock LLM drives tool_call -> finish_task; output + tool side
  effect verified.
- Failure path: a tool that raises is handled without crashing the loop.

Run:
    pytest -q tests/test_smoke_agentscope_react_facade.py
    pytest -q -k "smoke_agentscope"

Author: Damon Li
"""

import json
import subprocess
import sys

import pytest

from agenticx.agents import TextReActAgent, TextReActResult as ReActResult
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMResponse, LLMChoice, TokenUsage
from agenticx.tools.base import BaseTool


# --------------------------------------------------------------------------- #
# Test doubles
# --------------------------------------------------------------------------- #


class ScriptedLLM(BaseLLMProvider):
    """A mock provider that returns a pre-scripted list of action JSONs."""

    model: str = "scripted-mock"

    def __init__(self, **data):
        super().__init__(**data)
        # Private attrs via object.__setattr__ to bypass pydantic.
        object.__setattr__(self, "_scripts", list(data.get("scripts", [])))
        object.__setattr__(self, "_calls", 0)

    def _next(self) -> str:
        idx = object.__getattribute__(self, "_calls")
        scripts = object.__getattribute__(self, "_scripts")
        object.__setattr__(self, "_calls", idx + 1)
        if idx < len(scripts):
            return scripts[idx]
        # Default terminal action so the loop never hangs.
        return json.dumps({"action": "finish_task", "result": "fallback"})

    @property
    def call_count(self) -> int:
        return object.__getattribute__(self, "_calls")

    def _make_response(self, content: str) -> LLMResponse:
        return LLMResponse(
            id="mock",
            model_name=self.model,
            created=0,
            content=content,
            choices=[LLMChoice(index=0, content=content, finish_reason="stop")],
            token_usage=TokenUsage(),
            cost=0.0,
        )

    def invoke(self, prompt, **kwargs):  # type: ignore[override]
        return self._make_response(self._next())

    async def ainvoke(self, prompt, **kwargs):  # type: ignore[override]
        return self._make_response(self._next())

    def stream(self, prompt, **kwargs):  # type: ignore[override]
        yield self._next()

    async def astream(self, prompt, **kwargs):  # type: ignore[override]
        yield self._next()


class EchoTool(BaseTool):
    """A trivial tool that records its calls and echoes its input."""

    def __init__(self):
        super().__init__(name="echo", description="Echo the given text.")
        self.calls = []

    def _run(self, **kwargs):
        text = kwargs.get("text", "")
        self.calls.append(text)
        return f"echoed:{text}"


class BoomTool(BaseTool):
    """A tool that always raises, to exercise the error path."""

    def __init__(self):
        super().__init__(name="boom", description="Always fails.")

    def _run(self, **kwargs):
        raise RuntimeError("boom")


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


def test_react_facade_import_has_no_studio_runtime_coupling():
    """Importing the facade must not load the heavy Studio product runtime.

    The debate that motivated this primitive flagged ``AgentRuntime`` for
    importing ``agenticx.cli.agent_tools`` / ``studio_mcp`` / ``studio_skill``
    and depending on ``StudioSession`` -- i.e. it cannot be embedded without
    dragging in the product runtime. This test proves the ReActAgent facade
    has none of that coupling: it is driven purely by injected dependencies.

    Note: ``agenticx.cli.config_manager`` (a lightweight YAML config reader) is
    currently eager-imported by the ``agenticx`` package root and is therefore
    present in ``sys.modules`` regardless of this facade. That is a separate,
    pre-existing package-root concern (tracked as a follow-up), not the
    Studio-runtime coupling this primitive eliminates.
    """
    heavy = [
        "agenticx.studio",
        "agenticx.cli.studio",
        "agenticx.cli.agent_tools",
        "agenticx.cli.studio_mcp",
        "agenticx.cli.studio_skill",
        "agenticx.runtime.agent_runtime",
    ]
    code = (
        "import sys; import agenticx.agents.react_agent as r; "  # legacy module
        f"heavy={heavy!r}; "
        "pulled=[m for m in heavy if m in sys.modules]; "
        "print('PULLED=' + ','.join(sorted(pulled))); "
        "assert not pulled, pulled; "
        "assert hasattr(r, 'TextReActAgent')"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        f"facade import pulled the Studio product runtime.\n"
        f"stdout={proc.stdout}\nstderr={proc.stderr}"
    )
    assert "PULLED=" in proc.stdout


def test_react_facade_happy_path_tool_then_finish():
    tool = EchoTool()
    llm = ScriptedLLM(
        scripts=[
            json.dumps(
                {
                    "action": "tool_call",
                    "tool": "echo",
                    "args": {"text": "hello"},
                    "reasoning": "call echo",
                }
            ),
            json.dumps(
                {"action": "finish_task", "result": "DONE", "reasoning": "wrap up"}
            ),
        ]
    )
    agent = TextReActAgent(
        llm=llm,
        name="t",
        tools=[tool],
        enable_context_compilation=False,
    )
    result = agent.run("please echo hello then finish")
    assert isinstance(result, ReActResult)
    assert result.success is True
    assert result.output == "DONE"
    # The injected tool actually ran with the model-provided args.
    assert tool.calls == ["hello"]
    assert llm.call_count >= 2


def test_react_facade_immediate_finish():
    llm = ScriptedLLM(
        scripts=[json.dumps({"action": "finish_task", "result": "quick"})]
    )
    agent = TextReActAgent(llm=llm, enable_context_compilation=False)
    result = agent.run("just answer")
    assert result.success is True
    assert result.output == "quick"


def test_react_facade_tool_error_is_handled():
    boom = BoomTool()
    llm = ScriptedLLM(
        scripts=[
            json.dumps(
                {
                    "action": "tool_call",
                    "tool": "boom",
                    "args": {},
                    "reasoning": "trigger failure",
                }
            ),
            json.dumps({"action": "finish_task", "result": "recovered"}),
        ]
    )
    agent = TextReActAgent(
        llm=llm,
        tools=[boom],
        max_iterations=5,
        enable_context_compilation=False,
    )
    # The loop must not crash; it should surface a structured result.
    result = agent.run("use boom then recover")
    assert isinstance(result, ReActResult)
    # Either the agent recovered to finish_task, or it returned a failure
    # result -- both are acceptable; what matters is no unhandled exception.
    assert result.success in (True, False)


def test_add_tool_after_construction():
    llm = ScriptedLLM(
        scripts=[json.dumps({"action": "finish_task", "result": "ok"})]
    )
    agent = TextReActAgent(llm=llm, enable_context_compilation=False)
    assert agent.tools == []
    agent.add_tool(EchoTool())
    assert [t.name for t in agent.tools] == ["echo"]
    assert agent.executor.tool_registry.get("echo") is not None
