#!/usr/bin/env python3
"""Build a headless AgentRuntime bundle from an AgentSpec.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator, Awaitable, Callable, Sequence

from agenticx.cli.studio import StudioSession
from agenticx.managed.llm import LLMCallContext, LLMFactory
from agenticx.managed.spec import AgentSpec
from agenticx.runtime.agent_runtime import AgentRuntime
from agenticx.runtime.confirm import ConfirmGate, RiskAwareAutoConfirmGate
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.hooks import AgentHook, HookRegistry
from agenticx.runtime.session_boundary import ensure_session_workdir
from agenticx.tools.fallback_chain import FallbackLevel, ToolFallbackChain, ToolResolver

MANAGED_AGENT_ID = "meta"
DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant."
MANAGED_HOOK_PRIORITY = 100


@dataclass
class ManagedRuntimeBundle:
    runtime: AgentRuntime
    session: StudioSession
    tools: list[dict[str, Any]]
    system_prompt: str
    spec: AgentSpec
    workdir: Path
    context: LLMCallContext

    def run_turn(
        self,
        user_input: str,
        should_stop: Callable[[], bool | Awaitable[bool]] | None = None,
    ) -> AsyncGenerator[RuntimeEvent, None]:
        """Single place that fixes run_turn kwargs for managed sessions."""
        return self.runtime.run_turn(
            user_input,
            self.session,
            should_stop,
            agent_id=MANAGED_AGENT_ID,
            tools=self.tools,
            system_prompt=self.system_prompt,
            usage_session_id=self.context.session_id,
        )


def build_system_prompt(spec: AgentSpec, workdir: Path) -> str:
    """Compose the managed session system prompt, including the private workdir."""
    base = spec.system.strip() or DEFAULT_SYSTEM_PROMPT
    return (
        f"{base}\n\n[managed-runtime]\n"
        f"Working directory: {workdir}\n"
        "Only use the tools provided in this session.\n"
    )


def _join_text_blocks(content: Any) -> str:
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        text = block.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts)


def rehydrate_agent_messages(wire_events: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rebuild user/assistant text turns from seq-ordered wire events.

    Tool rounds are ignored. After a host restart the model only sees the
    question and answer text.
    """
    messages: list[dict[str, Any]] = []
    for event in wire_events:
        event_type = event.get("type")
        if event_type == "user.message":
            role = "user"
        elif event_type == "agent.message":
            role = "assistant"
        else:
            continue
        text = _join_text_blocks(event.get("content"))
        if text:
            messages.append({"role": role, "content": text})
    return messages


class ManagedAgentBuilder:
    """Assemble a Studio-free AgentRuntime plus session for one managed turn."""

    def __init__(self, *, llm_factory: LLMFactory, workdir_root: Path) -> None:
        self._llm_factory = llm_factory
        self._workdir_root = Path(workdir_root).expanduser().resolve()

    @property
    def llm_factory(self) -> LLMFactory:
        return self._llm_factory

    def build(
        self,
        spec: AgentSpec,
        *,
        context: LLMCallContext,
        confirm_gate: ConfirmGate | None = None,
        hooks: Sequence[AgentHook] = (),
        custom_tool_resolver: ToolResolver | None = None,
        history: Sequence[dict[str, Any]] = (),
    ) -> ManagedRuntimeBundle:
        """Construct a runtime bundle bound to ``context.session_id``."""
        workdir = ensure_session_workdir(context.session_id, root=self._workdir_root)
        if workdir is None:
            raise ValueError("invalid session id for workdir")
        session = StudioSession(provider_name=spec.provider, model_name=spec.model)
        session.session_id = context.session_id
        session.workspace_dir = str(workdir)
        session.taskspaces = [{"id": "default", "label": "workspace", "path": str(workdir)}]
        session.kb_retrieval_mode = "auto"
        session.agent_messages = [dict(message) for message in history]
        if custom_tool_resolver is not None:
            chain = ToolFallbackChain()
            chain.register(FallbackLevel.API_CONNECTOR, custom_tool_resolver)
            session._fallback_chain = chain
        llm = self._llm_factory.create(
            provider=spec.provider,
            model=spec.model,
            context=context,
        )
        gate = confirm_gate if confirm_gate is not None else RiskAwareAutoConfirmGate(unattended=True)
        runtime = AgentRuntime(
            llm,
            gate,
            max_tool_rounds=spec.max_tool_rounds,
            is_unattended=False,
            llm_factory=lambda: self._llm_factory.create(
                provider=spec.provider,
                model=spec.model,
                context=context,
            ),
        )
        runtime.hooks = HookRegistry()
        for hook in hooks:
            runtime.hooks.register(hook, priority=MANAGED_HOOK_PRIORITY)
        return ManagedRuntimeBundle(
            runtime=runtime,
            session=session,
            tools=spec.tool_schemas(),
            system_prompt=build_system_prompt(spec, workdir),
            spec=spec,
            workdir=workdir,
            context=context,
        )


__all__ = [
    "MANAGED_AGENT_ID",
    "DEFAULT_SYSTEM_PROMPT",
    "ManagedRuntimeBundle",
    "ManagedAgentBuilder",
    "build_system_prompt",
    "rehydrate_agent_messages",
]
