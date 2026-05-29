#!/usr/bin/env python3
"""Legacy text-JSON ReAct agent facade (thin ``AgentExecutor`` wrapper).

.. deprecated::
    Use :class:`agenticx.agents.react_agent_async.ReActAgent` for native
    function-calling, async, and streaming. This module remains for backward
    compatibility only.

A thin, batteries-injectable facade over ``AgentExecutor`` with **zero**
product coupling (no ``agenticx.cli`` / ``studio`` / ``StudioSession`` imports).

    from agenticx.agents import TextReActAgent

    agent = TextReActAgent(
        name="researcher",
        llm=my_openai_compatible_provider,   # any BaseLLMProvider
        tools=[my_tool],                     # any BaseTool list
        role="research assistant",
        goal="answer the user's question with evidence",
    )
    result = agent.run("What is the capital of France?")
    print(result.output)

Design goals (vs. AgentScope ``ReActAgent``):
* One constructor takes the model, tools, and optional memory / knowledge /
  plan / compaction; ``.run()`` / ``.arun()`` is a one-liner.
* No Studio/CLI coupling — importing this module must not drag in product
  runtime dependencies. A smoke test asserts this property.

This module deliberately does **not** modify ``AgentExecutor`` or the core
``Agent`` / ``Task`` models; it only composes existing primitives.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from agenticx.core.agent import Agent
from agenticx.core.agent_executor import AgentExecutor
from agenticx.core.event import CompactionConfig
from agenticx.core.task import Task
from agenticx.llms.base import BaseLLMProvider
from agenticx.tools.base import BaseTool


@dataclass
class ReActResult:
    """Structured result of a ReAct run.

    Attributes:
        success: Whether the run finished without an unrecoverable error.
        output: The final answer / result payload (whatever the agent
            produced via ``finish_task``).
        error: Error message when ``success`` is ``False``.
        steps: Number of recorded events in the run (rough step count).
        stats: Execution statistics dict from the underlying executor.
        event_log: The raw ``EventLog`` for callers that want the full trace.
    """

    success: bool
    output: Any = None
    error: Optional[str] = None
    steps: int = 0
    stats: Dict[str, Any] = field(default_factory=dict)
    event_log: Any = None


class TextReActAgent:
    """Legacy dependency-injection ReAct agent over ``AgentExecutor`` (text JSON actions).

    The facade owns one core :class:`Agent` description and one
    :class:`AgentExecutor`; ``run`` / ``arun`` build a :class:`Task` and drive
    the executor's reasoning -> acting loop.
    """

    def __init__(
        self,
        *,
        llm: BaseLLMProvider,
        name: str = "react-agent",
        role: str = "general assistant",
        goal: str = "complete the user's task using available tools",
        backstory: Optional[str] = None,
        tools: Optional[Sequence[BaseTool]] = None,
        memory: Optional[Any] = None,
        knowledge: Optional[Any] = None,
        plan: Optional[Any] = None,
        max_iterations: int = 25,
        compaction_config: Optional[CompactionConfig] = None,
        enable_context_compilation: bool = True,
        organization_id: str = "default-org",
    ) -> None:
        """Construct an embeddable ReAct agent.

        Args:
            llm: Any :class:`BaseLLMProvider` (the framework ships OpenAI-
                compatible providers; any ``invoke``-capable provider works).
            name: Agent display name.
            role: Short role description injected into the system prompt.
            goal: Primary goal injected into the system prompt.
            backstory: Optional extra persona/context.
            tools: Tool instances available to the agent. These are the main
                injection surface — knowledge retrieval, memory access, etc.
                are typically supplied here as tools.
            memory: Optional working-memory object. Stored on the underlying
                agent's ``memory_config`` so tools / hooks can reach it; the
                facade does not impose a memory schema.
            knowledge: Optional knowledge/RAG object, exposed via the agent's
                ``retrievers`` mapping for tools / hooks.
            plan: Optional plan notebook object, kept as an attribute for
                planner-style tools / hooks.
            max_iterations: Hard cap on reasoning loop iterations.
            compaction_config: Optional context-compaction config. When
                omitted a default is used.
            enable_context_compilation: Toggle the executor's compiled-context
                renderer (long-history compression).
            organization_id: Multi-tenant isolation id.
        """
        self.llm = llm
        self.memory = memory
        self.knowledge = knowledge
        self.plan = plan
        self._tools: List[BaseTool] = list(tools or [])

        self.agent = Agent.fast_construct(
            name=name,
            role=role,
            goal=goal,
            organization_id=organization_id,
            backstory=backstory,
            tools=list(self._tools),
            tool_names=[
                t.name for t in self._tools if getattr(t, "name", None)
            ],
            llm=llm,
            memory_config={"memory": memory} if memory is not None else {},
            retrievers={"knowledge": knowledge} if knowledge is not None else None,
            max_iterations=max_iterations,
        )

        self.executor = AgentExecutor(
            llm_provider=llm,
            tools=list(self._tools),
            max_iterations=max_iterations,
            compaction_config=compaction_config,
            enable_context_compilation=enable_context_compilation,
            auto_load_hooks=False,
        )

    @property
    def tools(self) -> List[BaseTool]:
        """The tools currently registered with the agent."""
        return list(self._tools)

    def add_tool(self, tool: BaseTool) -> None:
        """Register an additional tool after construction."""
        if tool is None:
            return
        self._tools.append(tool)
        self.agent.add_tool(tool)
        self.executor.tool_registry.register(tool)

    def _build_task(
        self,
        prompt: str,
        *,
        expected_output: str,
        context: Optional[Dict[str, Any]],
    ) -> Task:
        return Task(
            description=prompt,
            expected_output=expected_output
            or "A complete, accurate answer to the task.",
            agent_id=self.agent.id,
            context=context or {},
        )

    @staticmethod
    def _to_result(raw: Dict[str, Any]) -> ReActResult:
        event_log = raw.get("event_log")
        steps = 0
        try:
            events = getattr(event_log, "events", None)
            if events is not None:
                steps = len(events)
        except Exception:
            steps = 0
        return ReActResult(
            success=bool(raw.get("success")),
            output=raw.get("result"),
            error=raw.get("error"),
            steps=steps,
            stats=raw.get("stats") or {},
            event_log=event_log,
        )

    def run(
        self,
        prompt: str,
        *,
        expected_output: str = "",
        context: Optional[Dict[str, Any]] = None,
        session_key: Optional[str] = None,
    ) -> ReActResult:
        """Run the agent synchronously on a single prompt.

        Args:
            prompt: The user task / question.
            expected_output: Optional description of the desired output shape.
            context: Optional task context dict.
            session_key: Optional key for execution-lane serialization.

        Returns:
            A :class:`ReActResult`.
        """
        task = self._build_task(
            prompt,
            expected_output=expected_output,
            context=context,
        )
        raw = self.executor.run(self.agent, task, session_key=session_key)
        return self._to_result(raw)

    async def arun(
        self,
        prompt: str,
        *,
        expected_output: str = "",
        context: Optional[Dict[str, Any]] = None,
        session_key: Optional[str] = None,
    ) -> ReActResult:
        """Async wrapper around :meth:`run` (offloaded to a worker thread)."""
        return await asyncio.to_thread(
            self.run,
            prompt,
            expected_output=expected_output,
            context=context,
            session_key=session_key,
        )
