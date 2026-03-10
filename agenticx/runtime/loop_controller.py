#!/usr/bin/env python3
"""Self-referential loop controller for iterative execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncGenerator, Dict, Optional

from agenticx.runtime.events import EventType, RuntimeEvent


@dataclass
class LoopConfig:
    max_iterations: int = 10
    completion_promise: str = ""


class LoopController:
    """Run repeated turns until completion signal or iteration cap."""

    def __init__(self, *, max_iterations: int = 10, completion_promise: Optional[str] = None) -> None:
        self.config = LoopConfig(
            max_iterations=max(1, int(max_iterations)),
            completion_promise=(completion_promise or "").strip(),
        )

    def _build_iteration_prompt(self, task: str, iteration: int) -> str:
        return (
            f"[Loop Iteration {iteration}] {task}\n"
            "请基于已有上下文继续推进，优先复用 todo/scratchpad，不要重复已完成步骤。"
        )

    def _is_completed(self, final_text: str) -> bool:
        promise = self.config.completion_promise
        if not promise:
            return bool(final_text.strip())
        lower = final_text.lower()
        return promise.lower() in lower or f"<promise>{promise}</promise>".lower() in lower

    async def run_loop(
        self,
        *,
        task: str,
        runtime: Any,
        session: Any,
        agent_id: str = "meta",
        tools: Optional[list[dict]] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[RuntimeEvent, None]:
        final_text = ""
        for iteration in range(1, self.config.max_iterations + 1):
            iteration_prompt = self._build_iteration_prompt(task, iteration)
            async for event in runtime.run_turn(
                iteration_prompt,
                session,
                agent_id=agent_id,
                tools=tools,
                system_prompt=system_prompt,
            ):
                if event.type == EventType.FINAL.value:
                    final_text = str(event.data.get("text", ""))
                    continue
                yield event
            if self._is_completed(final_text):
                yield RuntimeEvent(
                    type=EventType.FINAL.value,
                    data={
                        "text": final_text,
                        "loop": {
                            "completed": True,
                            "iteration": iteration,
                            "max_iterations": self.config.max_iterations,
                        },
                    },
                    agent_id=agent_id,
                )
                return
        yield RuntimeEvent(
            type=EventType.ERROR.value,
            data={
                "text": "已达到循环最大迭代次数，建议调整任务拆解后继续。",
                "loop": {"completed": False, "max_iterations": self.config.max_iterations},
            },
            agent_id=agent_id,
        )
